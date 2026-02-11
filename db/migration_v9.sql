-- ============================================================
-- Migration V9: Venue follows + Friends on event cards
-- ============================================================

-- ============================================================
-- 1A. venue_follows table + RLS + indexes
-- ============================================================

CREATE TABLE IF NOT EXISTS venue_follows (
    id          SERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    venue_id    INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, venue_id)
);

CREATE INDEX IF NOT EXISTS idx_venue_follows_user ON venue_follows(user_id);
CREATE INDEX IF NOT EXISTS idx_venue_follows_venue ON venue_follows(venue_id);

ALTER TABLE venue_follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can see their own venue follows" ON venue_follows;
CREATE POLICY "Users can see their own venue follows" ON venue_follows
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can follow venues" ON venue_follows;
CREATE POLICY "Users can follow venues" ON venue_follows
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can unfollow venues" ON venue_follows;
CREATE POLICY "Users can unfollow venues" ON venue_follows
    FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- 1B. toggle_venue_follow RPC
-- ============================================================

CREATE OR REPLACE FUNCTION toggle_venue_follow(p_venue_id INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_uid UUID;
    existing_id INTEGER;
BEGIN
    current_uid := auth.uid();
    IF current_uid IS NULL THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'not_authenticated');
    END IF;

    SELECT id INTO existing_id FROM venue_follows WHERE user_id = current_uid AND venue_id = p_venue_id;

    IF existing_id IS NOT NULL THEN
        DELETE FROM venue_follows WHERE id = existing_id;
        RETURN jsonb_build_object('status', 'ok', 'action', 'unfollowed');
    ELSE
        INSERT INTO venue_follows (user_id, venue_id) VALUES (current_uid, p_venue_id);
        RETURN jsonb_build_object('status', 'ok', 'action', 'followed');
    END IF;
END;
$$;

-- ============================================================
-- 1C. Notification trigger: notify venue followers on new timeslot
-- ============================================================

CREATE OR REPLACE FUNCTION notify_venue_followers_on_timeslot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_name TEXT;
    follower RECORD;
BEGIN
    -- Only notify for future dates
    IF NEW.date < CURRENT_DATE THEN
        RETURN NEW;
    END IF;

    SELECT name INTO v_name FROM venues WHERE id = NEW.venue_id;

    FOR follower IN
        SELECT user_id FROM venue_follows WHERE venue_id = NEW.venue_id
    LOOP
        INSERT INTO notifications (user_id, type, venue_id, message)
        VALUES (follower.user_id, 'venue_new_timeslot', NEW.venue_id, v_name);
    END LOOP;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_venue_followers_on_timeslot ON timeslots;
CREATE TRIGGER trg_notify_venue_followers_on_timeslot
    AFTER INSERT ON timeslots
    FOR EACH ROW
    EXECUTE FUNCTION notify_venue_followers_on_timeslot();

-- ============================================================
-- 1D. Update notifications type constraint
-- ============================================================

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
    CHECK (type IN ('rsvp','comment','access_request','invitation','reminder',
                    'waitlist_promoted','kicked','follow_request','follow_accepted',
                    'booking_confirmed','booking_cancelled','venue_new_timeslot'));

-- ============================================================
-- 1E. Update get_venue_detail — add is_following + follower_count
-- ============================================================

CREATE OR REPLACE FUNCTION get_venue_detail(p_venue_id INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_uid UUID;
    v RECORD;
    staff_role TEXT;
    upcoming_timeslots JSONB;
    v_is_following BOOLEAN;
    v_follower_count INTEGER;
BEGIN
    current_uid := auth.uid();

    SELECT * INTO v FROM venues WHERE id = p_venue_id;
    IF v.id IS NULL THEN RETURN NULL; END IF;

    SELECT role INTO staff_role FROM venue_staff WHERE venue_id = p_venue_id AND user_id = current_uid;

    -- Check if current user follows this venue
    IF current_uid IS NOT NULL THEN
        SELECT EXISTS(SELECT 1 FROM venue_follows WHERE user_id = current_uid AND venue_id = p_venue_id) INTO v_is_following;
    ELSE
        v_is_following := false;
    END IF;

    SELECT COUNT(*) INTO v_follower_count FROM venue_follows WHERE venue_id = p_venue_id;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', ts.id, 'date', ts.date, 'start_time', ts.start_time, 'end_time', ts.end_time,
            'price', ts.price, 'capacity', ts.capacity, 'description', ts.description, 'event_id', ts.event_id,
            'type', ts.type, 'label', ts.label,
            'booked_count', (SELECT COUNT(*) FROM bookings b WHERE b.timeslot_id = ts.id AND b.status IN ('confirmed', 'checked_in')),
            'my_booking', (SELECT jsonb_build_object('id', b.id, 'status', b.status, 'qr_token', b.qr_token)
                          FROM bookings b WHERE b.timeslot_id = ts.id AND b.user_id = current_uid AND b.status != 'cancelled' LIMIT 1)
        ) ORDER BY ts.date, ts.start_time
    ), '[]'::jsonb)
    INTO upcoming_timeslots
    FROM timeslots ts
    WHERE ts.venue_id = p_venue_id AND ts.active = true AND ts.date >= CURRENT_DATE;

    RETURN jsonb_build_object(
        'id', v.id, 'name', v.name, 'description', v.description, 'address', v.address,
        'latitude', v.latitude, 'longitude', v.longitude, 'image_url', v.image_url,
        'opening_hours', v.opening_hours, 'contact_email', v.contact_email, 'contact_phone', v.contact_phone,
        'owner_id', v.owner_id, 'verified', v.verified, 'created_at', v.created_at,
        'is_staff', (staff_role IS NOT NULL), 'staff_role', staff_role,
        'is_following', v_is_following,
        'follower_count', v_follower_count,
        'timeslots', upcoming_timeslots
    );
END;
$$;

-- ============================================================
-- 1F. Update get_discover_events — add friend_count + friend_preview
-- ============================================================

CREATE OR REPLACE FUNCTION get_discover_events(
    p_lat DOUBLE PRECISION,
    p_lng DOUBLE PRECISION,
    p_radius_km INTEGER DEFAULT 25,
    p_date_from DATE DEFAULT CURRENT_DATE,
    p_date_to DATE DEFAULT NULL,
    p_category TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_uid UUID;
    result JSONB;
BEGIN
    current_uid := auth.uid();

    SELECT COALESCE(jsonb_agg(row_data), '[]'::jsonb)
    INTO result
    FROM (
        SELECT jsonb_build_object(
            'id', e.id,
            'title', e.title,
            'date', e.date,
            'time', e.time,
            'category', e.category,
            'image_url', e.image_url,
            'join_mode', e.join_mode,
            'area_name', CASE
                WHEN e.join_mode = 'approval_required' THEN
                    CASE
                        WHEN POSITION(',' IN e.location) > 0 THEN
                            TRIM(SUBSTRING(e.location FROM POSITION(',' IN e.location) + 1))
                        ELSE e.location
                    END
                ELSE e.location
            END,
            'distance_km', ROUND((
                6371 * ACOS(
                    LEAST(1.0, GREATEST(-1.0,
                        COS(RADIANS(p_lat)) * COS(RADIANS(e.latitude)) *
                        COS(RADIANS(e.longitude) - RADIANS(p_lng)) +
                        SIN(RADIANS(p_lat)) * SIN(RADIANS(e.latitude))
                    ))
                )
            )::numeric, 1),
            'going_count', (
                SELECT COUNT(*) FROM rsvps r
                WHERE r.event_id = e.id AND r.status = 'going' AND r.kicked_at IS NULL
            ),
            'friend_count', CASE WHEN current_uid IS NOT NULL THEN (
                SELECT COUNT(*) FROM rsvps r
                WHERE r.event_id = e.id AND r.status IN ('going', 'interested') AND r.kicked_at IS NULL
                  AND r.user_id IN (SELECT following_id FROM follows WHERE follower_id = current_uid AND status = 'active')
            ) ELSE 0 END,
            'friend_preview', CASE WHEN current_uid IS NOT NULL THEN COALESCE((
                SELECT jsonb_agg(jsonb_build_object('name', p.name, 'avatar_url', p.avatar_url))
                FROM (
                    SELECT pr.name, pr.avatar_url
                    FROM rsvps r2
                    JOIN profiles pr ON pr.id = r2.user_id
                    WHERE r2.event_id = e.id AND r2.status IN ('going', 'interested') AND r2.kicked_at IS NULL
                      AND r2.user_id IN (SELECT following_id FROM follows WHERE follower_id = current_uid AND status = 'active')
                    LIMIT 3
                ) p
            ), '[]'::jsonb) ELSE '[]'::jsonb END,
            'attendee_preview', COALESCE((
                SELECT jsonb_agg(jsonb_build_object('name', p.name, 'avatar_url', p.avatar_url))
                FROM (
                    -- Friends first, then others
                    SELECT pr.name, pr.avatar_url,
                        CASE WHEN current_uid IS NOT NULL AND r2.user_id IN (SELECT following_id FROM follows WHERE follower_id = current_uid AND status = 'active')
                            THEN 0 ELSE 1 END AS sort_order
                    FROM rsvps r2
                    JOIN profiles pr ON pr.id = r2.user_id
                    WHERE r2.event_id = e.id AND r2.status IN ('going', 'interested') AND r2.kicked_at IS NULL
                    ORDER BY sort_order, r2.created_at
                    LIMIT 5
                ) p
            ), '[]'::jsonb)
        ) AS row_data
        FROM events e
        WHERE e.visibility = 'public'
          AND e.date >= p_date_from
          AND (p_date_to IS NULL OR e.date <= p_date_to)
          AND (p_category IS NULL OR e.category = p_category)
          AND e.latitude IS NOT NULL
          AND e.longitude IS NOT NULL
          AND (current_uid IS NULL OR e.creator_id != current_uid)
          AND (current_uid IS NULL OR NOT EXISTS (
              SELECT 1 FROM event_swipes es
              WHERE es.user_id = current_uid AND es.event_id = e.id
          ))
          AND (
              6371 * ACOS(
                  LEAST(1.0, GREATEST(-1.0,
                      COS(RADIANS(p_lat)) * COS(RADIANS(e.latitude)) *
                      COS(RADIANS(e.longitude) - RADIANS(p_lng)) +
                      SIN(RADIANS(p_lat)) * SIN(RADIANS(e.latitude))
                  ))
              )
          ) <= p_radius_km
        ORDER BY e.date ASC
        LIMIT p_limit
    ) sub;

    RETURN result;
END;
$$;

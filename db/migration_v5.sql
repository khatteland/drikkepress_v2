-- ============================================================
-- Migration V5: Discover (Swipe) Feature
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1a. New table: event_swipes
CREATE TABLE event_swipes (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    direction TEXT NOT NULL CHECK (direction IN ('right', 'left')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, event_id)
);

CREATE INDEX idx_event_swipes_user ON event_swipes(user_id);
CREATE INDEX idx_event_swipes_event ON event_swipes(event_id);

ALTER TABLE event_swipes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own swipes"
    ON event_swipes FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can create own swipes"
    ON event_swipes FOR INSERT WITH CHECK (user_id = auth.uid());

-- 1b. New column on events: join_mode
ALTER TABLE events ADD COLUMN join_mode TEXT NOT NULL DEFAULT 'open'
    CHECK (join_mode IN ('open', 'approval_required'));

-- 1c. New column on profiles: is_plus
ALTER TABLE profiles ADD COLUMN is_plus BOOLEAN NOT NULL DEFAULT FALSE;

-- 1d. RPC: get_discover_events
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
                    -- Strip street info, keep city-level from location
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
            'attendee_preview', COALESCE((
                SELECT jsonb_agg(jsonb_build_object('name', p.name, 'avatar_url', p.avatar_url))
                FROM (
                    SELECT pr.name, pr.avatar_url
                    FROM rsvps r2
                    JOIN profiles pr ON pr.id = r2.user_id
                    WHERE r2.event_id = e.id AND r2.status IN ('going', 'interested') AND r2.kicked_at IS NULL
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

-- 1e. RPC: handle_swipe
CREATE OR REPLACE FUNCTION handle_swipe(p_event_id INTEGER, p_direction TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_uid UUID;
    ev events%ROWTYPE;
BEGIN
    current_uid := auth.uid();
    IF current_uid IS NULL THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'not_authenticated');
    END IF;

    -- Record the swipe
    INSERT INTO event_swipes (user_id, event_id, direction)
    VALUES (current_uid, p_event_id, p_direction)
    ON CONFLICT (user_id, event_id) DO UPDATE SET direction = p_direction;

    -- On right swipe: create RSVP + optional access request
    IF p_direction = 'right' THEN
        SELECT * INTO ev FROM events WHERE id = p_event_id;
        IF ev.id IS NULL THEN
            RETURN jsonb_build_object('status', 'error', 'code', 'event_not_found');
        END IF;

        -- Create RSVP as interested
        INSERT INTO rsvps (user_id, event_id, status)
        VALUES (current_uid, p_event_id, 'interested')
        ON CONFLICT (user_id, event_id) DO NOTHING;

        -- If approval required, create access request
        IF ev.join_mode = 'approval_required' THEN
            INSERT INTO access_requests (event_id, user_id, status)
            VALUES (p_event_id, current_uid, 'pending')
            ON CONFLICT (event_id, user_id) DO NOTHING;
        END IF;
    END IF;

    RETURN jsonb_build_object('status', 'success');
END;
$$;

-- 1f. Update get_event_detail to include join_mode and location hiding
CREATE OR REPLACE FUNCTION get_event_detail(p_event_id INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    ev events%ROWTYPE;
    current_uid UUID;
    has_access BOOLEAN;
    ar_status TEXT;
    is_approved BOOLEAN;
    show_location BOOLEAN;
BEGIN
    SELECT * INTO ev FROM events WHERE id = p_event_id;
    IF NOT FOUND THEN RETURN NULL; END IF;

    current_uid := auth.uid();
    has_access := check_event_access(p_event_id, current_uid);

    IF NOT has_access THEN
        SELECT ar.status INTO ar_status
        FROM access_requests ar
        WHERE ar.event_id = p_event_id AND ar.user_id = current_uid;

        RETURN jsonb_build_object(
            'id', ev.id,
            'title', ev.title,
            'category', ev.category,
            'visibility', ev.visibility,
            'join_mode', ev.join_mode,
            'has_access', false,
            'access_request_status', ar_status
        );
    END IF;

    -- Determine if location should be shown
    -- Show location if: join_mode is open, OR user is admin/creator, OR user has approved access request
    show_location := TRUE;
    IF ev.join_mode = 'approval_required' THEN
        IF is_event_admin(p_event_id, current_uid) THEN
            show_location := TRUE;
        ELSIF EXISTS (
            SELECT 1 FROM access_requests
            WHERE event_id = p_event_id AND user_id = current_uid AND status = 'approved'
        ) THEN
            show_location := TRUE;
        ELSIF EXISTS (
            SELECT 1 FROM rsvps
            WHERE event_id = p_event_id AND user_id = current_uid AND status = 'going'
        ) THEN
            show_location := TRUE;
        ELSE
            show_location := FALSE;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'id', ev.id,
        'title', ev.title,
        'description', ev.description,
        'date', ev.date,
        'time', ev.time,
        'end_time', ev.end_time,
        'location', CASE WHEN show_location THEN ev.location ELSE NULL END,
        'location_hidden', NOT show_location,
        'area_name', CASE
            WHEN NOT show_location THEN
                CASE
                    WHEN POSITION(',' IN ev.location) > 0 THEN
                        TRIM(SUBSTRING(ev.location FROM POSITION(',' IN ev.location) + 1))
                    ELSE ev.location
                END
            ELSE NULL
        END,
        'image_url', ev.image_url,
        'category', ev.category,
        'visibility', ev.visibility,
        'join_mode', ev.join_mode,
        'latitude', CASE WHEN show_location THEN ev.latitude ELSE NULL END,
        'longitude', CASE WHEN show_location THEN ev.longitude ELSE NULL END,
        'creator_id', ev.creator_id,
        'created_at', ev.created_at,
        'max_attendees', ev.max_attendees,
        'has_access', true,
        'qr_enabled', ev.qr_enabled,
        'is_admin', is_event_admin(p_event_id, current_uid),
        'creator_name', (SELECT name FROM profiles WHERE id = ev.creator_id),
        'going_count', (SELECT COUNT(*) FROM rsvps WHERE event_id = p_event_id AND status = 'going' AND kicked_at IS NULL),
        'interested_count', (SELECT COUNT(*) FROM rsvps WHERE event_id = p_event_id AND status = 'interested' AND kicked_at IS NULL),
        'waitlisted_count', (SELECT COUNT(*) FROM rsvps WHERE event_id = p_event_id AND status = 'waitlisted' AND kicked_at IS NULL),
        'checked_in_count', (SELECT COUNT(*) FROM rsvps WHERE event_id = p_event_id AND status = 'going' AND kicked_at IS NULL AND checked_in_at IS NOT NULL),
        'going_users', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'avatar_url', p.avatar_url, 'checked_in_at', r.checked_in_at))
            FROM rsvps r JOIN profiles p ON p.id = r.user_id
            WHERE r.event_id = p_event_id AND r.status = 'going' AND r.kicked_at IS NULL
        ), '[]'::jsonb),
        'interested_users', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'avatar_url', p.avatar_url))
            FROM rsvps r JOIN profiles p ON p.id = r.user_id
            WHERE r.event_id = p_event_id AND r.status = 'interested' AND r.kicked_at IS NULL
        ), '[]'::jsonb),
        'waitlisted_users', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'avatar_url', p.avatar_url) ORDER BY r.created_at ASC)
            FROM rsvps r JOIN profiles p ON p.id = r.user_id
            WHERE r.event_id = p_event_id AND r.status = 'waitlisted' AND r.kicked_at IS NULL
        ), '[]'::jsonb),
        'my_rsvp', (SELECT r.status FROM rsvps r WHERE r.event_id = p_event_id AND r.user_id = current_uid),
        'my_qr_token', (SELECT r.qr_token FROM rsvps r WHERE r.event_id = p_event_id AND r.user_id = current_uid AND r.status = 'going' AND r.kicked_at IS NULL),
        'my_checked_in_at', (SELECT r.checked_in_at FROM rsvps r WHERE r.event_id = p_event_id AND r.user_id = current_uid AND r.status = 'going' AND r.kicked_at IS NULL),
        'my_kicked', COALESCE((SELECT r.kicked_at IS NOT NULL FROM rsvps r WHERE r.event_id = p_event_id AND r.user_id = current_uid), false),
        'images', COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', ei.id,
                    'image_url', ei.image_url,
                    'position', ei.position
                ) ORDER BY ei.position
            )
            FROM event_images ei
            WHERE ei.event_id = p_event_id
        ), '[]'::jsonb),
        'comments', COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', c.id,
                    'text', c.text,
                    'image_url', c.image_url,
                    'user_id', c.user_id,
                    'user_name', p.name,
                    'user_avatar_url', p.avatar_url,
                    'created_at', c.created_at
                ) ORDER BY c.created_at
            )
            FROM comments c JOIN profiles p ON p.id = c.user_id
            WHERE c.event_id = p_event_id
        ), '[]'::jsonb)
    );
END;
$$;

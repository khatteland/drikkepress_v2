-- ============================================================
-- Migration V11: Performance & Scalability Optimizations
-- Run this in Supabase SQL Editor
-- ============================================================

-- ============================================================
-- 1A. Missing composite indexes for hot queries
-- ============================================================

-- RSVPs: used in every event detail, capacity check, attendee list
CREATE INDEX IF NOT EXISTS idx_rsvps_event_status ON rsvps(event_id, status) WHERE kicked_at IS NULL;

-- Comments: ordered by created_at in event detail
CREATE INDEX IF NOT EXISTS idx_comments_event_created ON comments(event_id, created_at);

-- Follows: follower lookups for friend features
CREATE INDEX IF NOT EXISTS idx_follows_follower_status ON follows(follower_id, status);
CREATE INDEX IF NOT EXISTS idx_follows_following_status ON follows(following_id, status);

-- Notifications: user's notification list ordered by time
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);

-- Event swipes: checked on every discover query
CREATE INDEX IF NOT EXISTS idx_event_swipes_user_event ON event_swipes(user_id, event_id);

-- Events: date filtering queries
CREATE INDEX IF NOT EXISTS idx_events_visibility_date ON events(visibility, date) WHERE visibility = 'public';

-- ============================================================
-- 1B. Optimize check_event_access — single query instead of 5
-- ============================================================

CREATE OR REPLACE FUNCTION check_event_access(p_event_id INTEGER, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    ev_visibility TEXT;
    ev_creator_id UUID;
BEGIN
    -- Get event basics in one query
    SELECT visibility, creator_id INTO ev_visibility, ev_creator_id
    FROM events WHERE id = p_event_id;

    IF NOT FOUND THEN RETURN FALSE; END IF;

    -- Public events: everyone has access
    IF ev_visibility = 'public' THEN RETURN TRUE; END IF;

    -- No user: no access to non-public
    IF p_user_id IS NULL THEN RETURN FALSE; END IF;

    -- Creator always has access
    IF ev_creator_id = p_user_id THEN RETURN TRUE; END IF;

    -- Single query: check admin, invitation, or approved access request
    RETURN EXISTS (
        SELECT 1 FROM event_admins WHERE event_id = p_event_id AND user_id = p_user_id
        UNION ALL
        SELECT 1 FROM invitations i
            JOIN profiles p ON LOWER(p.email) = LOWER(i.email)
            WHERE i.event_id = p_event_id AND p.id = p_user_id
        UNION ALL
        SELECT 1 FROM access_requests
            WHERE event_id = p_event_id AND user_id = p_user_id AND status = 'approved'
    );
END;
$$;

-- ============================================================
-- 1C. Optimize get_discover_events — CTE for distance calc
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
        WITH candidate_events AS (
            SELECT e.*,
                CASE WHEN e.latitude IS NOT NULL AND e.longitude IS NOT NULL THEN
                    ROUND((
                        6371 * ACOS(
                            LEAST(1.0, GREATEST(-1.0,
                                COS(RADIANS(p_lat)) * COS(RADIANS(e.latitude)) *
                                COS(RADIANS(e.longitude) - RADIANS(p_lng)) +
                                SIN(RADIANS(p_lat)) * SIN(RADIANS(e.latitude))
                            ))
                        )
                    )::numeric, 1)
                ELSE NULL END AS dist_km
            FROM events e
            WHERE e.visibility = 'public'
              AND e.effective_end_date >= p_date_from
              AND (p_date_to IS NULL OR e.date <= p_date_to)
              AND (p_category IS NULL OR e.category = p_category)
              AND (current_uid IS NULL OR e.creator_id != current_uid)
              AND (current_uid IS NULL OR NOT EXISTS (
                  SELECT 1 FROM event_swipes es
                  WHERE es.user_id = current_uid AND es.event_id = e.id
              ))
        )
        SELECT jsonb_build_object(
            'id', ce.id,
            'title', ce.title,
            'date', ce.date,
            'end_date', ce.end_date,
            'time', ce.time,
            'end_time', ce.end_time,
            'category', ce.category,
            'image_url', ce.image_url,
            'join_mode', ce.join_mode,
            'event_mode', ce.event_mode,
            'online_url', ce.online_url,
            'area_name', CASE
                WHEN ce.event_mode = 'online' THEN NULL
                WHEN ce.join_mode = 'approval_required' THEN
                    CASE
                        WHEN POSITION(',' IN ce.location) > 0 THEN
                            TRIM(SUBSTRING(ce.location FROM POSITION(',' IN ce.location) + 1))
                        ELSE ce.location
                    END
                ELSE ce.location
            END,
            'distance_km', ce.dist_km,
            'going_count', (
                SELECT COUNT(*) FROM rsvps r
                WHERE r.event_id = ce.id AND r.status = 'going' AND r.kicked_at IS NULL
            ),
            'friend_count', CASE WHEN current_uid IS NOT NULL THEN (
                SELECT COUNT(*) FROM rsvps r
                WHERE r.event_id = ce.id AND r.status IN ('going', 'interested') AND r.kicked_at IS NULL
                  AND r.user_id IN (SELECT following_id FROM follows WHERE follower_id = current_uid AND status = 'active')
            ) ELSE 0 END,
            'friend_preview', CASE WHEN current_uid IS NOT NULL THEN COALESCE((
                SELECT jsonb_agg(jsonb_build_object('name', p.name, 'avatar_url', p.avatar_url))
                FROM (
                    SELECT pr.name, pr.avatar_url
                    FROM rsvps r2
                    JOIN profiles pr ON pr.id = r2.user_id
                    WHERE r2.event_id = ce.id AND r2.status IN ('going', 'interested') AND r2.kicked_at IS NULL
                      AND r2.user_id IN (SELECT following_id FROM follows WHERE follower_id = current_uid AND status = 'active')
                    LIMIT 3
                ) p
            ), '[]'::jsonb) ELSE '[]'::jsonb END,
            'attendee_preview', COALESCE((
                SELECT jsonb_agg(jsonb_build_object('name', p.name, 'avatar_url', p.avatar_url))
                FROM (
                    SELECT pr.name, pr.avatar_url,
                        CASE WHEN current_uid IS NOT NULL AND r2.user_id IN (SELECT following_id FROM follows WHERE follower_id = current_uid AND status = 'active')
                            THEN 0 ELSE 1 END AS sort_order
                    FROM rsvps r2
                    JOIN profiles pr ON pr.id = r2.user_id
                    WHERE r2.event_id = ce.id AND r2.status IN ('going', 'interested') AND r2.kicked_at IS NULL
                    ORDER BY sort_order, r2.created_at
                    LIMIT 5
                ) p
            ), '[]'::jsonb)
        ) AS row_data
        FROM candidate_events ce
        WHERE (ce.dist_km IS NOT NULL AND ce.dist_km <= p_radius_km)
           OR ce.event_mode = 'online'
        ORDER BY ce.date ASC
        LIMIT p_limit
    ) sub;

    RETURN result;
END;
$$;

-- ============================================================
-- 1D. New RPC: search_events — server-side search with pagination
-- Replaces client-side query in SearchBrowsePage
-- ============================================================

CREATE OR REPLACE FUNCTION search_events(
    p_search TEXT DEFAULT NULL,
    p_category TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 30,
    p_offset INTEGER DEFAULT 0
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
            'end_date', e.end_date,
            'time', e.time,
            'end_time', e.end_time,
            'location', e.location,
            'category', e.category,
            'image_url', e.image_url,
            'event_mode', e.event_mode,
            'online_url', e.online_url,
            'latitude', e.latitude,
            'longitude', e.longitude,
            'going_count', (
                SELECT COUNT(*) FROM rsvps r
                WHERE r.event_id = e.id AND r.status = 'going' AND r.kicked_at IS NULL
            ),
            'interested_count', (
                SELECT COUNT(*) FROM rsvps r
                WHERE r.event_id = e.id AND r.status = 'interested' AND r.kicked_at IS NULL
            ),
            'creator_name', (SELECT name FROM profiles WHERE id = e.creator_id),
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
            ), '[]'::jsonb) ELSE '[]'::jsonb END
        ) AS row_data
        FROM events e
        WHERE e.visibility = 'public'
          AND e.effective_end_date >= CURRENT_DATE
          AND (p_search IS NULL OR (
              e.title ILIKE '%' || p_search || '%'
              OR e.description ILIKE '%' || p_search || '%'
              OR e.location ILIKE '%' || p_search || '%'
          ))
          AND (p_category IS NULL OR e.category = p_category)
        ORDER BY e.date ASC
        LIMIT p_limit
        OFFSET p_offset
    ) sub;

    RETURN result;
END;
$$;

-- ============================================================
-- 1E. Rate limiting table + helper
-- ============================================================

CREATE TABLE IF NOT EXISTS rate_limits (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL,
    action TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_user_action ON rate_limits(user_id, action, created_at DESC);

-- Auto-cleanup: delete entries older than 1 hour
CREATE OR REPLACE FUNCTION cleanup_rate_limits()
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    DELETE FROM rate_limits WHERE created_at < NOW() - INTERVAL '1 hour';
$$;

-- Rate limit check: returns true if within limit
CREATE OR REPLACE FUNCTION check_rate_limit(p_user_id UUID, p_action TEXT, p_max_per_minute INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    recent_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO recent_count
    FROM rate_limits
    WHERE user_id = p_user_id AND action = p_action AND created_at > NOW() - INTERVAL '1 minute';

    IF recent_count >= p_max_per_minute THEN
        RETURN FALSE;
    END IF;

    INSERT INTO rate_limits (user_id, action) VALUES (p_user_id, p_action);
    RETURN TRUE;
END;
$$;

-- ============================================================
-- 1F. Add rate limiting to handle_swipe
-- ============================================================

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

    -- Rate limit: max 60 swipes per minute
    IF NOT check_rate_limit(current_uid, 'swipe', 60) THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'rate_limited');
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

        INSERT INTO rsvps (user_id, event_id, status)
        VALUES (current_uid, p_event_id, 'interested')
        ON CONFLICT (user_id, event_id) DO NOTHING;

        IF ev.join_mode = 'approval_required' THEN
            INSERT INTO access_requests (event_id, user_id, status)
            VALUES (p_event_id, current_uid, 'pending')
            ON CONFLICT (event_id, user_id) DO NOTHING;
        END IF;
    END IF;

    RETURN jsonb_build_object('status', 'success');
END;
$$;

-- ============================================================
-- 1G. Scheduled cleanup (run via pg_cron or manually)
-- ============================================================

-- To enable auto-cleanup, run in Supabase SQL editor:
-- SELECT cron.schedule('cleanup-rate-limits', '*/15 * * * *', 'SELECT cleanup_rate_limits()');
-- Or call cleanup_rate_limits() manually when needed

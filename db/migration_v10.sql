-- ============================================================
-- Migration V10: Online/Hybrid events, multi-day events, over-midnight
-- Run this in Supabase SQL Editor
-- ============================================================

-- ============================================================
-- 1A. New columns on events
-- ============================================================

-- End date for multi-day events
ALTER TABLE events ADD COLUMN IF NOT EXISTS end_date DATE;

-- Event mode: physical, online, or hybrid
ALTER TABLE events ADD COLUMN IF NOT EXISTS event_mode TEXT NOT NULL DEFAULT 'physical'
    CHECK (event_mode IN ('physical', 'online', 'hybrid'));

-- URL for online/hybrid events
ALTER TABLE events ADD COLUMN IF NOT EXISTS online_url TEXT;

-- Make location nullable (online events don't need a location)
ALTER TABLE events ALTER COLUMN location DROP NOT NULL;

-- Computed effective_end_date: handles multi-day and over-midnight
-- If end_date is set, use it. Otherwise, if end_time < time (over midnight), date + 1. Else date.
ALTER TABLE events ADD COLUMN IF NOT EXISTS effective_end_date DATE
    GENERATED ALWAYS AS (
        COALESCE(end_date, CASE WHEN end_time IS NOT NULL AND end_time < time THEN date + 1 ELSE date END)
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_events_effective_end ON events(effective_end_date);

-- ============================================================
-- 1B. Update get_discover_events — use effective_end_date, return new fields
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
            'end_date', e.end_date,
            'time', e.time,
            'end_time', e.end_time,
            'category', e.category,
            'image_url', e.image_url,
            'join_mode', e.join_mode,
            'event_mode', e.event_mode,
            'online_url', e.online_url,
            'area_name', CASE
                WHEN e.event_mode = 'online' THEN NULL
                WHEN e.join_mode = 'approval_required' THEN
                    CASE
                        WHEN POSITION(',' IN e.location) > 0 THEN
                            TRIM(SUBSTRING(e.location FROM POSITION(',' IN e.location) + 1))
                        ELSE e.location
                    END
                ELSE e.location
            END,
            'distance_km', CASE WHEN e.latitude IS NOT NULL AND e.longitude IS NOT NULL THEN ROUND((
                6371 * ACOS(
                    LEAST(1.0, GREATEST(-1.0,
                        COS(RADIANS(p_lat)) * COS(RADIANS(e.latitude)) *
                        COS(RADIANS(e.longitude) - RADIANS(p_lng)) +
                        SIN(RADIANS(p_lat)) * SIN(RADIANS(e.latitude))
                    ))
                )
            )::numeric, 1) ELSE NULL END,
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
          AND e.effective_end_date >= p_date_from
          AND (p_date_to IS NULL OR e.date <= p_date_to)
          AND (p_category IS NULL OR e.category = p_category)
          -- For geo search: include events with lat/lng OR pure online events
          AND (
              (e.latitude IS NOT NULL AND e.longitude IS NOT NULL AND (
                  6371 * ACOS(
                      LEAST(1.0, GREATEST(-1.0,
                          COS(RADIANS(p_lat)) * COS(RADIANS(e.latitude)) *
                          COS(RADIANS(e.longitude) - RADIANS(p_lng)) +
                          SIN(RADIANS(p_lat)) * SIN(RADIANS(e.latitude))
                      ))
                  )
              ) <= p_radius_km)
              OR e.event_mode = 'online'
          )
          AND (current_uid IS NULL OR e.creator_id != current_uid)
          AND (current_uid IS NULL OR NOT EXISTS (
              SELECT 1 FROM event_swipes es
              WHERE es.user_id = current_uid AND es.event_id = e.id
          ))
        ORDER BY e.date ASC
        LIMIT p_limit
    ) sub;

    RETURN result;
END;
$$;

-- ============================================================
-- 1C. Update get_event_detail — return end_date, event_mode, online_url
-- ============================================================

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
            'event_mode', ev.event_mode,
            'has_access', false,
            'access_request_status', ar_status
        );
    END IF;

    -- Determine if location should be shown
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
        'end_date', ev.end_date,
        'time', ev.time,
        'end_time', ev.end_time,
        'event_mode', ev.event_mode,
        'online_url', ev.online_url,
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
        'venue_id', ev.venue_id,
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

-- ============================================================
-- 1D. Update get_user_profile — use effective_end_date
-- ============================================================

CREATE OR REPLACE FUNCTION get_user_profile(target_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_uid UUID;
    target_profile RECORD;
    follow_status TEXT;
    can_see_activity BOOLEAN;
    is_own BOOLEAN;
    photos JSONB;
    follower_count INTEGER;
    following_count INTEGER;
    going_events JSONB;
    created_events JSONB;
BEGIN
    current_uid := auth.uid();
    is_own := (current_uid IS NOT NULL AND current_uid = target_user_id);

    SELECT * INTO target_profile FROM profiles WHERE id = target_user_id;
    IF target_profile.id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Get follow status
    IF is_own THEN
        follow_status := 'own';
    ELSIF current_uid IS NULL THEN
        follow_status := 'none';
    ELSE
        SELECT COALESCE(
            (SELECT f.status FROM follows f WHERE f.follower_id = current_uid AND f.following_id = target_user_id),
            'none'
        ) INTO follow_status;
    END IF;

    -- Determine activity visibility
    IF is_own THEN
        can_see_activity := TRUE;
    ELSIF target_profile.activity_visibility = 'public' THEN
        can_see_activity := TRUE;
    ELSIF target_profile.activity_visibility = 'followers' AND follow_status = 'active' THEN
        can_see_activity := TRUE;
    ELSE
        can_see_activity := FALSE;
    END IF;

    -- Get photos
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object('id', pp.id, 'image_url', pp.image_url, 'position', pp.position)
        ORDER BY pp.position
    ), '[]'::jsonb)
    INTO photos
    FROM profile_photos pp
    WHERE pp.user_id = target_user_id;

    -- Follower/following counts
    SELECT COUNT(*) INTO follower_count FROM follows WHERE following_id = target_user_id AND status = 'active';
    SELECT COUNT(*) INTO following_count FROM follows WHERE follower_id = target_user_id AND status = 'active';

    -- Going events (only if can see activity) — use effective_end_date
    IF can_see_activity THEN
        SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
                'id', e.id, 'title', e.title, 'date', e.date, 'time', e.time,
                'location', e.location, 'category', e.category, 'image_url', e.image_url
            )
        ), '[]'::jsonb)
        INTO going_events
        FROM rsvps r
        JOIN events e ON e.id = r.event_id
        WHERE r.user_id = target_user_id AND r.status = 'going' AND r.kicked_at IS NULL
          AND e.effective_end_date >= CURRENT_DATE AND e.visibility = 'public';
    ELSE
        going_events := '[]'::jsonb;
    END IF;

    -- Created events (always visible, only public upcoming) — use effective_end_date
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', e.id, 'title', e.title, 'date', e.date, 'time', e.time,
            'location', e.location, 'category', e.category, 'image_url', e.image_url
        )
    ), '[]'::jsonb)
    INTO created_events
    FROM events e
    WHERE e.creator_id = target_user_id AND e.effective_end_date >= CURRENT_DATE AND e.visibility = 'public';

    RETURN jsonb_build_object(
        'id', target_profile.id,
        'name', target_profile.name,
        'email', target_profile.email,
        'avatar_url', target_profile.avatar_url,
        'bio', COALESCE(target_profile.bio, ''),
        'is_plus', target_profile.is_plus,
        'activity_visibility', target_profile.activity_visibility,
        'created_at', target_profile.created_at,
        'photos', photos,
        'follower_count', follower_count,
        'following_count', following_count,
        'follow_status', follow_status,
        'can_see_activity', can_see_activity,
        'is_own_profile', is_own,
        'going_events', going_events,
        'created_events', created_events
    );
END;
$$;

-- ============================================================
-- 1E. Update get_friends_activity — use effective_end_date
-- ============================================================

CREATE OR REPLACE FUNCTION get_friends_activity(p_limit INT DEFAULT 20, p_offset INT DEFAULT 0)
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
    IF current_uid IS NULL THEN
        RETURN '[]'::jsonb;
    END IF;

    SELECT COALESCE(jsonb_agg(item), '[]'::jsonb)
    INTO result
    FROM (
        SELECT jsonb_build_object(
            'user_id', p.id,
            'user_name', p.name,
            'user_avatar_url', p.avatar_url,
            'rsvp_status', r.status,
            'rsvp_created_at', r.created_at,
            'event_id', e.id,
            'event_title', e.title,
            'event_date', e.date,
            'event_time', e.time,
            'event_location', e.location,
            'event_category', e.category,
            'event_image_url', e.image_url
        ) AS item
        FROM follows f
        JOIN profiles p ON p.id = f.following_id
        JOIN rsvps r ON r.user_id = f.following_id AND r.kicked_at IS NULL
        JOIN events e ON e.id = r.event_id AND e.effective_end_date >= CURRENT_DATE AND e.visibility = 'public'
        WHERE f.follower_id = current_uid
          AND f.status = 'active'
          AND p.activity_visibility IN ('public', 'followers')
        ORDER BY r.created_at DESC
        LIMIT p_limit
        OFFSET p_offset
    ) sub;

    RETURN result;
END;
$$;

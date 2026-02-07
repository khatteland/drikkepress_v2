-- ============================================================
-- Migration V4: Co-Admin Support
-- Run in Supabase SQL Editor
-- ============================================================

-- ============================================================
-- 1. EVENT_ADMINS TABLE
-- ============================================================

CREATE TABLE event_admins (
    id          SERIAL PRIMARY KEY,
    event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(event_id, user_id)
);

CREATE INDEX idx_event_admins_event ON event_admins(event_id);
CREATE INDEX idx_event_admins_user ON event_admins(user_id);

-- RLS
ALTER TABLE event_admins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Creator and admins can read event_admins"
    ON event_admins FOR SELECT USING (
        EXISTS (SELECT 1 FROM events WHERE id = event_id AND creator_id = auth.uid())
        OR user_id = auth.uid()
    );

CREATE POLICY "Creator can add event_admins"
    ON event_admins FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM events WHERE id = event_id AND creator_id = auth.uid())
    );

CREATE POLICY "Creator can remove event_admins"
    ON event_admins FOR DELETE USING (
        EXISTS (SELECT 1 FROM events WHERE id = event_id AND creator_id = auth.uid())
    );

-- ============================================================
-- 2. HELPER: is_event_admin(event_id, user_id)
-- ============================================================

CREATE OR REPLACE FUNCTION is_event_admin(p_event_id INTEGER, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_user_id IS NULL THEN RETURN FALSE; END IF;

    -- Creator is always admin
    IF EXISTS (SELECT 1 FROM events WHERE id = p_event_id AND creator_id = p_user_id) THEN
        RETURN TRUE;
    END IF;

    -- Co-admin
    IF EXISTS (SELECT 1 FROM event_admins WHERE event_id = p_event_id AND user_id = p_user_id) THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$;

-- ============================================================
-- 3. UPDATE check_event_access — add co-admin check
-- ============================================================

CREATE OR REPLACE FUNCTION check_event_access(p_event_id INTEGER, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Public events: everyone
    IF EXISTS (SELECT 1 FROM events WHERE id = p_event_id AND visibility = 'public') THEN
        RETURN TRUE;
    END IF;

    IF p_user_id IS NULL THEN RETURN FALSE; END IF;

    -- Creator
    IF EXISTS (SELECT 1 FROM events WHERE id = p_event_id AND creator_id = p_user_id) THEN
        RETURN TRUE;
    END IF;

    -- Co-admin
    IF EXISTS (SELECT 1 FROM event_admins WHERE event_id = p_event_id AND user_id = p_user_id) THEN
        RETURN TRUE;
    END IF;

    -- Invited by email
    IF EXISTS (
        SELECT 1 FROM invitations i
        JOIN profiles p ON p.email = i.user_email
        WHERE i.event_id = p_event_id AND p.id = p_user_id
    ) THEN
        RETURN TRUE;
    END IF;

    -- Approved access request
    IF EXISTS (
        SELECT 1 FROM access_requests
        WHERE event_id = p_event_id AND user_id = p_user_id AND status = 'approved'
    ) THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$;

-- ============================================================
-- 4. UPDATE get_event_detail — add is_admin field
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
            'has_access', false,
            'access_request_status', ar_status
        );
    END IF;

    RETURN jsonb_build_object(
        'id', ev.id,
        'title', ev.title,
        'description', ev.description,
        'date', ev.date,
        'time', ev.time,
        'end_time', ev.end_time,
        'location', ev.location,
        'image_url', ev.image_url,
        'category', ev.category,
        'visibility', ev.visibility,
        'latitude', ev.latitude,
        'longitude', ev.longitude,
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

-- ============================================================
-- 5. UPDATE checkin_by_qr_token — use is_event_admin
-- ============================================================

CREATE OR REPLACE FUNCTION checkin_by_qr_token(p_event_id INTEGER, p_qr_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_uid UUID;
    rsvp_row RECORD;
BEGIN
    current_uid := auth.uid();

    IF NOT is_event_admin(p_event_id, current_uid) THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'not_creator');
    END IF;

    SELECT r.*, p.name AS user_name, p.avatar_url AS user_avatar_url
    INTO rsvp_row
    FROM rsvps r
    JOIN profiles p ON p.id = r.user_id
    WHERE r.event_id = p_event_id AND r.qr_token = p_qr_token AND r.status = 'going';

    IF rsvp_row IS NULL THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'invalid_token');
    END IF;

    IF rsvp_row.kicked_at IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'kicked');
    END IF;

    IF rsvp_row.checked_in_at IS NOT NULL THEN
        RETURN jsonb_build_object(
            'status', 'already',
            'user_name', rsvp_row.user_name,
            'user_avatar_url', rsvp_row.user_avatar_url,
            'checked_in_at', rsvp_row.checked_in_at
        );
    END IF;

    UPDATE rsvps SET checked_in_at = NOW() WHERE id = rsvp_row.id;

    RETURN jsonb_build_object(
        'status', 'success',
        'user_name', rsvp_row.user_name,
        'user_avatar_url', rsvp_row.user_avatar_url,
        'checked_in_at', NOW()
    );
END;
$$;

-- ============================================================
-- 6. UPDATE kick_user_from_event — use is_event_admin
-- ============================================================

CREATE OR REPLACE FUNCTION kick_user_from_event(p_event_id INTEGER, p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_uid UUID;
    rsvp_row RECORD;
BEGIN
    current_uid := auth.uid();

    IF NOT is_event_admin(p_event_id, current_uid) THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'not_creator');
    END IF;

    IF p_user_id = current_uid THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'cannot_kick_self');
    END IF;

    SELECT * INTO rsvp_row FROM rsvps WHERE event_id = p_event_id AND user_id = p_user_id;
    IF rsvp_row IS NULL THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'no_rsvp');
    END IF;

    UPDATE rsvps
    SET kicked_at = NOW(), qr_token = NULL, checked_in_at = NULL,
        status = CASE WHEN status = 'going' THEN 'interested' ELSE status END
    WHERE id = rsvp_row.id;

    INSERT INTO notifications (user_id, type, event_id, actor_id)
    VALUES (p_user_id, 'kicked', p_event_id, current_uid);

    RETURN jsonb_build_object('status', 'success');
END;
$$;

-- ============================================================
-- 7. UPDATE toggle_qr_enabled — use is_event_admin
-- ============================================================

CREATE OR REPLACE FUNCTION toggle_qr_enabled(p_event_id INTEGER)
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

    SELECT * INTO ev FROM events WHERE id = p_event_id;
    IF ev.id IS NULL OR NOT is_event_admin(p_event_id, current_uid) THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'not_creator');
    END IF;

    UPDATE events SET qr_enabled = NOT qr_enabled WHERE id = p_event_id;

    RETURN jsonb_build_object('status', 'success', 'qr_enabled', NOT ev.qr_enabled);
END;
$$;

-- ============================================================
-- 8. UPDATE get_checkin_list — use is_event_admin
-- ============================================================

CREATE OR REPLACE FUNCTION get_checkin_list(p_event_id INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_uid UUID;
BEGIN
    current_uid := auth.uid();

    IF NOT is_event_admin(p_event_id, current_uid) THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'not_creator');
    END IF;

    RETURN jsonb_build_object(
        'status', 'success',
        'total_going', (SELECT COUNT(*) FROM rsvps WHERE event_id = p_event_id AND status = 'going' AND kicked_at IS NULL),
        'total_checked_in', (SELECT COUNT(*) FROM rsvps WHERE event_id = p_event_id AND status = 'going' AND kicked_at IS NULL AND checked_in_at IS NOT NULL),
        'attendees', COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'user_id', p.id,
                    'name', p.name,
                    'avatar_url', p.avatar_url,
                    'checked_in_at', r.checked_in_at
                ) ORDER BY r.checked_in_at DESC NULLS LAST, r.created_at ASC
            )
            FROM rsvps r JOIN profiles p ON p.id = r.user_id
            WHERE r.event_id = p_event_id AND r.status = 'going' AND r.kicked_at IS NULL
        ), '[]'::jsonb)
    );
END;
$$;

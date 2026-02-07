-- ============================================================
-- Migration V3: QR Check-in + Kick Users
-- Run this in Supabase SQL Editor
-- ============================================================

-- ============================================================
-- 1. New columns
-- ============================================================

-- events: toggle for QR distribution
ALTER TABLE events ADD COLUMN qr_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- rsvps: QR token, check-in, kick
ALTER TABLE rsvps ADD COLUMN qr_token UUID DEFAULT NULL;
ALTER TABLE rsvps ADD COLUMN checked_in_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE rsvps ADD COLUMN kicked_at TIMESTAMPTZ DEFAULT NULL;

CREATE UNIQUE INDEX idx_rsvps_qr_token ON rsvps(qr_token) WHERE qr_token IS NOT NULL;

-- ============================================================
-- 2. Extend notifications type CHECK
-- ============================================================

ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
    CHECK (type IN ('rsvp','comment','access_request','invitation','reminder','waitlist_promoted','kicked'));

-- ============================================================
-- 3. Trigger: Auto-generate QR token
-- ============================================================

CREATE OR REPLACE FUNCTION generate_qr_token()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status = 'going' AND NEW.qr_token IS NULL THEN
        NEW.qr_token := gen_random_uuid();
    END IF;

    IF NEW.status != 'going' THEN
        NEW.qr_token := NULL;
        NEW.checked_in_at := NULL;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_generate_qr_token
    BEFORE INSERT OR UPDATE ON rsvps
    FOR EACH ROW
    EXECUTE FUNCTION generate_qr_token();

-- Backfill existing going RSVPs
UPDATE rsvps SET qr_token = gen_random_uuid() WHERE status = 'going' AND qr_token IS NULL;

-- ============================================================
-- 4. RPC: checkin_by_qr_token
-- ============================================================

CREATE OR REPLACE FUNCTION checkin_by_qr_token(p_event_id INTEGER, p_qr_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_uid UUID;
    ev_creator UUID;
    rsvp_row RECORD;
BEGIN
    current_uid := auth.uid();

    -- Verify caller is event creator
    SELECT creator_id INTO ev_creator FROM events WHERE id = p_event_id;
    IF ev_creator IS NULL OR ev_creator != current_uid THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'not_creator');
    END IF;

    -- Find RSVP
    SELECT r.*, p.name AS user_name, p.avatar_url AS user_avatar_url
    INTO rsvp_row
    FROM rsvps r
    JOIN profiles p ON p.id = r.user_id
    WHERE r.event_id = p_event_id AND r.qr_token = p_qr_token AND r.status = 'going';

    IF rsvp_row IS NULL THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'invalid_token');
    END IF;

    -- Check if kicked
    IF rsvp_row.kicked_at IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'kicked');
    END IF;

    -- Check if already checked in
    IF rsvp_row.checked_in_at IS NOT NULL THEN
        RETURN jsonb_build_object(
            'status', 'already',
            'user_name', rsvp_row.user_name,
            'user_avatar_url', rsvp_row.user_avatar_url,
            'checked_in_at', rsvp_row.checked_in_at
        );
    END IF;

    -- Check in
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
-- 5. RPC: kick_user_from_event
-- ============================================================

CREATE OR REPLACE FUNCTION kick_user_from_event(p_event_id INTEGER, p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_uid UUID;
    ev_creator UUID;
    rsvp_row RECORD;
BEGIN
    current_uid := auth.uid();

    -- Verify caller is event creator
    SELECT creator_id INTO ev_creator FROM events WHERE id = p_event_id;
    IF ev_creator IS NULL OR ev_creator != current_uid THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'not_creator');
    END IF;

    -- Cannot kick yourself
    IF p_user_id = current_uid THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'cannot_kick_self');
    END IF;

    -- Find RSVP
    SELECT * INTO rsvp_row FROM rsvps WHERE event_id = p_event_id AND user_id = p_user_id;
    IF rsvp_row IS NULL THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'no_rsvp');
    END IF;

    -- Kick: set kicked_at, clear QR and check-in
    UPDATE rsvps
    SET kicked_at = NOW(), qr_token = NULL, checked_in_at = NULL,
        status = CASE WHEN status = 'going' THEN 'interested' ELSE status END
    WHERE id = rsvp_row.id;

    -- Create kicked notification
    INSERT INTO notifications (user_id, type, event_id, actor_id)
    VALUES (p_user_id, 'kicked', p_event_id, current_uid);

    RETURN jsonb_build_object('status', 'success');
END;
$$;

-- ============================================================
-- 6. RPC: toggle_qr_enabled
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
    IF ev.id IS NULL OR ev.creator_id != current_uid THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'not_creator');
    END IF;

    UPDATE events SET qr_enabled = NOT qr_enabled WHERE id = p_event_id;

    RETURN jsonb_build_object('status', 'success', 'qr_enabled', NOT ev.qr_enabled);
END;
$$;

-- ============================================================
-- 7. RPC: get_checkin_list
-- ============================================================

CREATE OR REPLACE FUNCTION get_checkin_list(p_event_id INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_uid UUID;
    ev_creator UUID;
BEGIN
    current_uid := auth.uid();

    SELECT creator_id INTO ev_creator FROM events WHERE id = p_event_id;
    IF ev_creator IS NULL OR ev_creator != current_uid THEN
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

-- ============================================================
-- 8. Update get_event_detail
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

    -- Full access
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
-- 9. Update promote_from_waitlist (exclude kicked)
-- ============================================================

CREATE OR REPLACE FUNCTION promote_from_waitlist()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    max_att INTEGER;
    current_going INTEGER;
    promoted_rsvp RECORD;
BEGIN
    IF TG_OP = 'DELETE' AND OLD.status != 'going' THEN
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' AND (OLD.status != 'going' OR NEW.status = 'going') THEN
        RETURN NEW;
    END IF;

    SELECT max_attendees INTO max_att FROM events WHERE id = OLD.event_id;
    IF max_att IS NULL THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(OLD.event_id);

    SELECT COUNT(*) INTO current_going
    FROM rsvps
    WHERE event_id = OLD.event_id AND status = 'going' AND kicked_at IS NULL;

    IF current_going < max_att THEN
        SELECT * INTO promoted_rsvp
        FROM rsvps
        WHERE event_id = OLD.event_id AND status = 'waitlisted' AND kicked_at IS NULL
        ORDER BY created_at ASC
        LIMIT 1;

        IF promoted_rsvp.id IS NOT NULL THEN
            UPDATE rsvps SET status = 'going' WHERE id = promoted_rsvp.id;

            INSERT INTO notifications (user_id, type, event_id)
            VALUES (promoted_rsvp.user_id, 'waitlist_promoted', OLD.event_id);
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

-- Also update check_capacity_on_rsvp to exclude kicked users
CREATE OR REPLACE FUNCTION check_capacity_on_rsvp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    max_att INTEGER;
    current_going INTEGER;
BEGIN
    IF NEW.status != 'going' THEN
        RETURN NEW;
    END IF;

    SELECT max_attendees INTO max_att FROM events WHERE id = NEW.event_id;

    IF max_att IS NULL THEN
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(NEW.event_id);

    SELECT COUNT(*) INTO current_going
    FROM rsvps
    WHERE event_id = NEW.event_id AND status = 'going' AND kicked_at IS NULL AND id != COALESCE(NEW.id, 0);

    IF current_going >= max_att THEN
        NEW.status := 'waitlisted';
    END IF;

    RETURN NEW;
END;
$$;

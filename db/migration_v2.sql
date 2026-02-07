-- ============================================================
-- Drikkepress — Migration V2
-- Notifications, Email Preferences, Calendar, Capacity/Waitlist
-- Run this in Supabase SQL Editor
-- ============================================================

-- ============================================================
-- 1. NOTIFICATIONS TABLE
-- ============================================================

CREATE TABLE notifications (
    id          SERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type        TEXT NOT NULL CHECK (type IN ('rsvp','comment','access_request','invitation','reminder','waitlist_promoted')),
    event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    actor_id    UUID REFERENCES profiles(id) ON DELETE SET NULL,
    message     TEXT,
    is_read     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id) WHERE NOT is_read;
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own notifications"
    ON notifications FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can update own notifications"
    ON notifications FOR UPDATE USING (user_id = auth.uid());

-- ============================================================
-- 2. NOTIFICATION PREFERENCES TABLE
-- ============================================================

CREATE TABLE notification_preferences (
    id                   SERIAL PRIMARY KEY,
    user_id              UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
    email_rsvp           BOOLEAN NOT NULL DEFAULT TRUE,
    email_comment        BOOLEAN NOT NULL DEFAULT TRUE,
    email_access_request BOOLEAN NOT NULL DEFAULT TRUE,
    email_invitation     BOOLEAN NOT NULL DEFAULT TRUE,
    email_reminder       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own prefs"
    ON notification_preferences FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can insert own prefs"
    ON notification_preferences FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own prefs"
    ON notification_preferences FOR UPDATE USING (user_id = auth.uid());

-- ============================================================
-- 3. ADD max_attendees TO events
-- ============================================================

ALTER TABLE events ADD COLUMN max_attendees INTEGER DEFAULT NULL;

-- ============================================================
-- 4. EXTEND rsvps status CHECK to include 'waitlisted'
-- ============================================================

ALTER TABLE rsvps DROP CONSTRAINT rsvps_status_check;
ALTER TABLE rsvps ADD CONSTRAINT rsvps_status_check CHECK (status IN ('going', 'interested', 'waitlisted'));

-- ============================================================
-- 5. NOTIFICATION TRIGGERS (SECURITY DEFINER — bypass RLS)
-- ============================================================

-- 5a. Notify event creator on new RSVP
CREATE OR REPLACE FUNCTION notify_on_rsvp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    creator UUID;
BEGIN
    SELECT creator_id INTO creator FROM events WHERE id = NEW.event_id;
    IF creator IS NOT NULL AND creator != NEW.user_id THEN
        INSERT INTO notifications (user_id, type, event_id, actor_id)
        VALUES (creator, 'rsvp', NEW.event_id, NEW.user_id);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_on_rsvp
    AFTER INSERT ON rsvps
    FOR EACH ROW
    EXECUTE FUNCTION notify_on_rsvp();

-- 5b. Notify event creator on new comment
CREATE OR REPLACE FUNCTION notify_on_comment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    creator UUID;
    snippet TEXT;
BEGIN
    SELECT creator_id INTO creator FROM events WHERE id = NEW.event_id;
    IF creator IS NOT NULL AND creator != NEW.user_id THEN
        snippet := LEFT(NEW.text, 100);
        INSERT INTO notifications (user_id, type, event_id, actor_id, message)
        VALUES (creator, 'comment', NEW.event_id, NEW.user_id, snippet);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_on_comment
    AFTER INSERT ON comments
    FOR EACH ROW
    EXECUTE FUNCTION notify_on_comment();

-- 5c. Notify event creator on access request
CREATE OR REPLACE FUNCTION notify_on_access_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    creator UUID;
BEGIN
    SELECT creator_id INTO creator FROM events WHERE id = NEW.event_id;
    IF creator IS NOT NULL THEN
        INSERT INTO notifications (user_id, type, event_id, actor_id)
        VALUES (creator, 'access_request', NEW.event_id, NEW.user_id);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_on_access_request
    AFTER INSERT ON access_requests
    FOR EACH ROW
    EXECUTE FUNCTION notify_on_access_request();

-- 5d. Notify invited user on invitation
CREATE OR REPLACE FUNCTION notify_on_invitation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    target_user UUID;
BEGIN
    SELECT p.id INTO target_user
    FROM profiles p
    WHERE p.email = NEW.user_email
    LIMIT 1;

    IF target_user IS NOT NULL THEN
        INSERT INTO notifications (user_id, type, event_id, actor_id)
        VALUES (target_user, 'invitation', NEW.event_id, NEW.invited_by);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_on_invitation
    AFTER INSERT ON invitations
    FOR EACH ROW
    EXECUTE FUNCTION notify_on_invitation();

-- ============================================================
-- 6. CAPACITY / WAITLIST TRIGGERS
-- ============================================================

-- 6a. Check capacity before inserting/updating RSVP to 'going'
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

    -- Advisory lock to prevent race conditions
    PERFORM pg_advisory_xact_lock(NEW.event_id);

    SELECT COUNT(*) INTO current_going
    FROM rsvps
    WHERE event_id = NEW.event_id AND status = 'going' AND id != COALESCE(NEW.id, 0);

    IF current_going >= max_att THEN
        NEW.status := 'waitlisted';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_check_capacity_on_rsvp
    BEFORE INSERT OR UPDATE ON rsvps
    FOR EACH ROW
    EXECUTE FUNCTION check_capacity_on_rsvp();

-- 6b. Promote from waitlist when a 'going' RSVP is removed
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
    -- Only act when a 'going' RSVP is deleted or changed away from 'going'
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
    WHERE event_id = OLD.event_id AND status = 'going';

    IF current_going < max_att THEN
        SELECT * INTO promoted_rsvp
        FROM rsvps
        WHERE event_id = OLD.event_id AND status = 'waitlisted'
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

CREATE TRIGGER trg_promote_from_waitlist
    AFTER DELETE OR UPDATE ON rsvps
    FOR EACH ROW
    EXECUTE FUNCTION promote_from_waitlist();

-- ============================================================
-- 7. RPC: mark_all_notifications_read
-- ============================================================

CREATE OR REPLACE FUNCTION mark_all_notifications_read()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE notifications
    SET is_read = TRUE
    WHERE user_id = auth.uid() AND is_read = FALSE;
END;
$$;

-- ============================================================
-- 8. UPDATE get_event_detail to include capacity/waitlist info
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
        'creator_name', (SELECT name FROM profiles WHERE id = ev.creator_id),
        'going_count', (SELECT COUNT(*) FROM rsvps WHERE event_id = p_event_id AND status = 'going'),
        'interested_count', (SELECT COUNT(*) FROM rsvps WHERE event_id = p_event_id AND status = 'interested'),
        'waitlisted_count', (SELECT COUNT(*) FROM rsvps WHERE event_id = p_event_id AND status = 'waitlisted'),
        'going_users', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'avatar_url', p.avatar_url))
            FROM rsvps r JOIN profiles p ON p.id = r.user_id
            WHERE r.event_id = p_event_id AND r.status = 'going'
        ), '[]'::jsonb),
        'interested_users', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'avatar_url', p.avatar_url))
            FROM rsvps r JOIN profiles p ON p.id = r.user_id
            WHERE r.event_id = p_event_id AND r.status = 'interested'
        ), '[]'::jsonb),
        'waitlisted_users', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'avatar_url', p.avatar_url) ORDER BY r.created_at ASC)
            FROM rsvps r JOIN profiles p ON p.id = r.user_id
            WHERE r.event_id = p_event_id AND r.status = 'waitlisted'
        ), '[]'::jsonb),
        'my_rsvp', (SELECT r.status FROM rsvps r WHERE r.event_id = p_event_id AND r.user_id = current_uid),
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
-- 9. UPDATE handle_new_user to create notification_preferences
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO profiles (id, name, email)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
        NEW.email
    );
    INSERT INTO notification_preferences (user_id) VALUES (NEW.id);
    RETURN NEW;
END;
$$;

-- Backfill notification_preferences for existing users
INSERT INTO notification_preferences (user_id)
SELECT id FROM profiles
WHERE id NOT IN (SELECT user_id FROM notification_preferences);

-- ============================================================
-- 10. ENABLE REALTIME on notifications
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- ============================================================
-- Drikkepress — Supabase Schema (Full)
-- Run this in Supabase SQL Editor for fresh installs
-- ============================================================

-- ============================================================
-- PROFILES (linked to Supabase Auth)
-- ============================================================
CREATE TABLE profiles (
    id          UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    name        TEXT NOT NULL,
    email       TEXT,
    avatar_url  TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_profiles_email ON profiles(email);

-- Auto-create profile on signup
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

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- EVENTS
-- ============================================================
CREATE TABLE events (
    id              SERIAL PRIMARY KEY,
    title           TEXT NOT NULL,
    description     TEXT,
    date            DATE NOT NULL,
    time            TIME NOT NULL,
    end_time        TIME,
    location        TEXT NOT NULL,
    image_url       TEXT,
    category        TEXT NOT NULL,
    visibility      TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'semi_public')),
    max_attendees   INTEGER DEFAULT NULL,
    qr_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    creator_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_creator ON events(creator_id);
CREATE INDEX idx_events_date ON events(date);
CREATE INDEX idx_events_category ON events(category);
CREATE INDEX idx_events_visibility ON events(visibility);

-- ============================================================
-- RSVPS
-- ============================================================
CREATE TABLE rsvps (
    id          SERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    status      TEXT NOT NULL CHECK (status IN ('going', 'interested', 'waitlisted')),
    qr_token    UUID DEFAULT NULL,
    checked_in_at TIMESTAMPTZ DEFAULT NULL,
    kicked_at   TIMESTAMPTZ DEFAULT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, event_id)
);

CREATE INDEX idx_rsvps_event ON rsvps(event_id);
CREATE INDEX idx_rsvps_user ON rsvps(user_id);
CREATE UNIQUE INDEX idx_rsvps_qr_token ON rsvps(qr_token) WHERE qr_token IS NOT NULL;

-- ============================================================
-- EVENT IMAGES
-- ============================================================
CREATE TABLE event_images (
    id          SERIAL PRIMARY KEY,
    event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    image_url   TEXT NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_event_images_event ON event_images(event_id);

-- ============================================================
-- COMMENTS
-- ============================================================
CREATE TABLE comments (
    id          SERIAL PRIMARY KEY,
    event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    text        TEXT NOT NULL,
    image_url   TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_comments_event ON comments(event_id);

-- ============================================================
-- INVITATIONS
-- ============================================================
CREATE TABLE invitations (
    id          SERIAL PRIMARY KEY,
    event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_email  TEXT NOT NULL,
    invited_by  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(event_id, user_email)
);

CREATE INDEX idx_invitations_event ON invitations(event_id);
CREATE INDEX idx_invitations_email ON invitations(user_email);

-- ============================================================
-- ACCESS REQUESTS
-- ============================================================
CREATE TABLE access_requests (
    id          SERIAL PRIMARY KEY,
    event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
    message     TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(event_id, user_id)
);

CREATE INDEX idx_ar_event ON access_requests(event_id);
CREATE INDEX idx_ar_user ON access_requests(user_id);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE notifications (
    id          SERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type        TEXT NOT NULL CHECK (type IN ('rsvp','comment','access_request','invitation','reminder','waitlist_promoted','kicked')),
    event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    actor_id    UUID REFERENCES profiles(id) ON DELETE SET NULL,
    message     TEXT,
    is_read     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id) WHERE NOT is_read;
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);

-- ============================================================
-- NOTIFICATION PREFERENCES
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

-- ============================================================
-- EVENT ADMINS (co-admin support)
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

-- ============================================================
-- HELPER: is_event_admin (creator OR co-admin)
-- ============================================================
CREATE OR REPLACE FUNCTION is_event_admin(p_event_id INTEGER, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_user_id IS NULL THEN RETURN FALSE; END IF;

    IF EXISTS (SELECT 1 FROM events WHERE id = p_event_id AND creator_id = p_user_id) THEN
        RETURN TRUE;
    END IF;

    IF EXISTS (SELECT 1 FROM event_admins WHERE event_id = p_event_id AND user_id = p_user_id) THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$;

-- ============================================================
-- ACCESS CHECK FUNCTION (used by RLS policies)
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
-- GET EVENT DETAIL (RPC function — returns full or restricted view)
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
        -- Check for existing access request
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
-- MARK ALL NOTIFICATIONS READ (RPC)
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
-- NOTIFICATION TRIGGERS (SECURITY DEFINER — bypass RLS)
-- ============================================================

-- Notify event creator on new RSVP
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

-- Notify event creator on new comment
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

-- Notify event creator on access request
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

-- Notify invited user on invitation
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
-- CAPACITY / WAITLIST TRIGGERS
-- ============================================================

-- Check capacity before inserting/updating RSVP to 'going'
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

CREATE TRIGGER trg_check_capacity_on_rsvp
    BEFORE INSERT OR UPDATE ON rsvps
    FOR EACH ROW
    EXECUTE FUNCTION check_capacity_on_rsvp();

-- Promote from waitlist when a 'going' RSVP is removed
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

CREATE TRIGGER trg_promote_from_waitlist
    AFTER DELETE OR UPDATE ON rsvps
    FOR EACH ROW
    EXECUTE FUNCTION promote_from_waitlist();

-- ============================================================
-- QR TOKEN AUTO-GENERATION TRIGGER
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

-- ============================================================
-- RPC: checkin_by_qr_token
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
-- RPC: kick_user_from_event
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
-- RPC: toggle_qr_enabled
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
-- RPC: get_checkin_list
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

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- Profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles are publicly readable"
    ON profiles FOR SELECT USING (true);

CREATE POLICY "Users can update own profile"
    ON profiles FOR UPDATE USING (id = auth.uid());

-- Events
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public events readable by all, semi-public by authorized"
    ON events FOR SELECT USING (
        visibility = 'public' OR check_event_access(id, auth.uid())
    );

CREATE POLICY "Authenticated users can create events"
    ON events FOR INSERT WITH CHECK (
        auth.uid() IS NOT NULL AND creator_id = auth.uid()
    );

CREATE POLICY "Creators can update own events"
    ON events FOR UPDATE USING (creator_id = auth.uid());

CREATE POLICY "Creators can delete own events"
    ON events FOR DELETE USING (creator_id = auth.uid());

-- RSVPs
ALTER TABLE rsvps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "RSVPs readable if event accessible"
    ON rsvps FOR SELECT USING (check_event_access(event_id, auth.uid()));

CREATE POLICY "Users can RSVP with event access"
    ON rsvps FOR INSERT WITH CHECK (
        auth.uid() = user_id AND check_event_access(event_id, auth.uid())
    );

CREATE POLICY "Users can update own RSVP"
    ON rsvps FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can remove own RSVP"
    ON rsvps FOR DELETE USING (auth.uid() = user_id);

-- Comments
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Comments readable if event accessible"
    ON comments FOR SELECT USING (check_event_access(event_id, auth.uid()));

CREATE POLICY "Users can comment with event access"
    ON comments FOR INSERT WITH CHECK (
        auth.uid() = user_id AND check_event_access(event_id, auth.uid())
    );

CREATE POLICY "Users can delete own comments"
    ON comments FOR DELETE USING (auth.uid() = user_id);

-- Invitations
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Event creator can read invitations"
    ON invitations FOR SELECT USING (
        EXISTS (SELECT 1 FROM events WHERE id = event_id AND creator_id = auth.uid())
    );

CREATE POLICY "Event creator can create invitations"
    ON invitations FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM events WHERE id = event_id AND creator_id = auth.uid())
    );

CREATE POLICY "Event creator can delete invitations"
    ON invitations FOR DELETE USING (
        EXISTS (SELECT 1 FROM events WHERE id = event_id AND creator_id = auth.uid())
    );

-- Access Requests
ALTER TABLE access_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Creator sees event requests, users see own"
    ON access_requests FOR SELECT USING (
        user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM events WHERE id = event_id AND creator_id = auth.uid())
    );

CREATE POLICY "Authenticated users can request access"
    ON access_requests FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Event creator can update request status"
    ON access_requests FOR UPDATE USING (
        EXISTS (SELECT 1 FROM events WHERE id = event_id AND creator_id = auth.uid())
    );

-- Event Images
ALTER TABLE event_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Event images readable if event accessible"
    ON event_images FOR SELECT USING (check_event_access(event_id, auth.uid()));

CREATE POLICY "Event creator can add images"
    ON event_images FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM events WHERE id = event_id AND creator_id = auth.uid())
    );

CREATE POLICY "Event creator can delete images"
    ON event_images FOR DELETE USING (
        EXISTS (SELECT 1 FROM events WHERE id = event_id AND creator_id = auth.uid())
    );

-- Notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own notifications"
    ON notifications FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can update own notifications"
    ON notifications FOR UPDATE USING (user_id = auth.uid());

-- Notification Preferences
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own prefs"
    ON notification_preferences FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can insert own prefs"
    ON notification_preferences FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own prefs"
    ON notification_preferences FOR UPDATE USING (user_id = auth.uid());

-- Event Admins
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
-- ENABLE REALTIME on notifications
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

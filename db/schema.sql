-- ============================================================
-- Hapn — Supabase Schema (Full)
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
    is_plus     BOOLEAN NOT NULL DEFAULT FALSE,
    bio         TEXT DEFAULT '',
    activity_visibility TEXT NOT NULL DEFAULT 'public'
        CHECK (activity_visibility IN ('public', 'followers', 'private')),
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
-- VENUES
-- ============================================================
CREATE TABLE venues (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT DEFAULT '',
    address         TEXT NOT NULL,
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    image_url       TEXT,
    opening_hours   TEXT DEFAULT '',
    contact_email   TEXT,
    contact_phone   TEXT,
    owner_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    verified        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_venues_owner ON venues(owner_id);

-- ============================================================
-- VENUE STAFF
-- ============================================================
CREATE TABLE venue_staff (
    id          SERIAL PRIMARY KEY,
    venue_id    INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'bouncer')),
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(venue_id, user_id)
);

CREATE INDEX idx_venue_staff_venue ON venue_staff(venue_id);
CREATE INDEX idx_venue_staff_user ON venue_staff(user_id);

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
    join_mode       TEXT NOT NULL DEFAULT 'open' CHECK (join_mode IN ('open', 'approval_required')),
    max_attendees   INTEGER DEFAULT NULL,
    qr_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    venue_id        INTEGER REFERENCES venues(id) ON DELETE SET NULL,
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
    type        TEXT NOT NULL CHECK (type IN ('rsvp','comment','access_request','invitation','reminder','waitlist_promoted','kicked','follow_request','follow_accepted','booking_confirmed','booking_cancelled')),
    event_id    INTEGER REFERENCES events(id) ON DELETE CASCADE,
    venue_id    INTEGER REFERENCES venues(id),
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
-- EVENT SWIPES (discover feature)
-- ============================================================
CREATE TABLE event_swipes (
    id          SERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    direction   TEXT NOT NULL CHECK (direction IN ('right', 'left')),
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, event_id)
);

CREATE INDEX idx_event_swipes_user ON event_swipes(user_id);
CREATE INDEX idx_event_swipes_event ON event_swipes(event_id);

-- ============================================================
-- TIMESLOTS
-- ============================================================
CREATE TABLE timeslots (
    id          SERIAL PRIMARY KEY,
    venue_id    INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    event_id    INTEGER REFERENCES events(id) ON DELETE SET NULL,
    date        DATE NOT NULL,
    start_time  TIME NOT NULL,
    end_time    TIME NOT NULL,
    price       INTEGER NOT NULL DEFAULT 0,
    capacity    INTEGER NOT NULL DEFAULT 10,
    description TEXT DEFAULT '',
    type        TEXT NOT NULL DEFAULT 'queue' CHECK (type IN ('queue', 'ticket', 'table')),
    label       TEXT DEFAULT '',
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_timeslots_venue ON timeslots(venue_id);
CREATE INDEX idx_timeslots_event ON timeslots(event_id);
CREATE INDEX idx_timeslots_date ON timeslots(date);
CREATE INDEX idx_timeslots_type ON timeslots(type);

-- ============================================================
-- BOOKINGS
-- ============================================================
CREATE TABLE bookings (
    id          SERIAL PRIMARY KEY,
    timeslot_id INTEGER NOT NULL REFERENCES timeslots(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    qr_token    UUID NOT NULL DEFAULT gen_random_uuid(),
    status      TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'checked_in', 'cancelled', 'expired')),
    checked_in_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(timeslot_id, user_id)
);

CREATE INDEX idx_bookings_timeslot ON bookings(timeslot_id);
CREATE INDEX idx_bookings_user ON bookings(user_id);
CREATE UNIQUE INDEX idx_bookings_qr_token ON bookings(qr_token);

-- ============================================================
-- TRANSACTIONS
-- ============================================================
CREATE TABLE transactions (
    id              SERIAL PRIMARY KEY,
    booking_id      INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    amount          INTEGER NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'NOK',
    status          TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'refunded')),
    payment_method  TEXT NOT NULL DEFAULT 'mock',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_transactions_booking ON transactions(booking_id);
CREATE INDEX idx_transactions_user ON transactions(user_id);

-- ============================================================
-- PROFILE PHOTOS
-- ============================================================
CREATE TABLE profile_photos (
    id          SERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    image_url   TEXT NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_profile_photos_user ON profile_photos(user_id);

-- Trigger: enforce max 6 photos per user
CREATE OR REPLACE FUNCTION enforce_max_profile_photos()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF (SELECT COUNT(*) FROM profile_photos WHERE user_id = NEW.user_id) >= 6 THEN
        RAISE EXCEPTION 'Maximum 6 profile photos allowed';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_max_profile_photos
    BEFORE INSERT ON profile_photos
    FOR EACH ROW
    EXECUTE FUNCTION enforce_max_profile_photos();

-- ============================================================
-- FOLLOWS
-- ============================================================
CREATE TABLE follows (
    id          SERIAL PRIMARY KEY,
    follower_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    following_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status      TEXT NOT NULL CHECK (status IN ('active', 'pending')),
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(follower_id, following_id)
);

CREATE INDEX idx_follows_follower ON follows(follower_id);
CREATE INDEX idx_follows_following ON follows(following_id);
CREATE INDEX idx_follows_pending ON follows(following_id) WHERE status = 'pending';

-- ============================================================
-- HELPER: is_venue_staff
-- ============================================================
CREATE OR REPLACE FUNCTION is_venue_staff(p_venue_id INT, p_user_id UUID, p_roles TEXT[] DEFAULT ARRAY['owner','manager','bouncer'])
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_user_id IS NULL THEN RETURN FALSE; END IF;
    RETURN EXISTS (
        SELECT 1 FROM venue_staff
        WHERE venue_id = p_venue_id AND user_id = p_user_id AND role = ANY(p_roles)
    );
END;
$$;

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
        'venue_id', ev.venue_id,
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
-- RPC: get_discover_events
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

-- ============================================================
-- RPC: handle_swipe
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

    INSERT INTO event_swipes (user_id, event_id, direction)
    VALUES (current_uid, p_event_id, p_direction)
    ON CONFLICT (user_id, event_id) DO UPDATE SET direction = p_direction;

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
-- RPC: toggle_follow
-- ============================================================

CREATE OR REPLACE FUNCTION toggle_follow(target_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_uid UUID;
    existing_follow RECORD;
    target_visibility TEXT;
    new_status TEXT;
BEGIN
    current_uid := auth.uid();
    IF current_uid IS NULL THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'not_authenticated');
    END IF;

    IF current_uid = target_user_id THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'cannot_follow_self');
    END IF;

    SELECT * INTO existing_follow FROM follows
    WHERE follower_id = current_uid AND following_id = target_user_id;

    IF existing_follow.id IS NOT NULL THEN
        DELETE FROM follows WHERE id = existing_follow.id;
        RETURN jsonb_build_object('status', 'success', 'action', 'unfollowed');
    END IF;

    SELECT activity_visibility INTO target_visibility FROM profiles WHERE id = target_user_id;

    IF target_visibility = 'public' THEN
        new_status := 'active';
    ELSE
        new_status := 'pending';
    END IF;

    INSERT INTO follows (follower_id, following_id, status)
    VALUES (current_uid, target_user_id, new_status);

    IF new_status = 'pending' THEN
        INSERT INTO notifications (user_id, type, actor_id)
        VALUES (target_user_id, 'follow_request', current_uid);
    ELSE
        INSERT INTO notifications (user_id, type, actor_id)
        VALUES (target_user_id, 'follow_accepted', current_uid);
    END IF;

    RETURN jsonb_build_object('status', 'success', 'action', CASE WHEN new_status = 'active' THEN 'followed' ELSE 'requested' END);
END;
$$;

-- ============================================================
-- RPC: handle_follow_request
-- ============================================================

CREATE OR REPLACE FUNCTION handle_follow_request(p_follower_id UUID, p_action TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_uid UUID;
    follow_row RECORD;
BEGIN
    current_uid := auth.uid();
    IF current_uid IS NULL THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'not_authenticated');
    END IF;

    SELECT * INTO follow_row FROM follows
    WHERE follower_id = p_follower_id AND following_id = current_uid AND status = 'pending';

    IF follow_row.id IS NULL THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'not_found');
    END IF;

    IF p_action = 'accept' THEN
        UPDATE follows SET status = 'active' WHERE id = follow_row.id;
        INSERT INTO notifications (user_id, type, actor_id)
        VALUES (p_follower_id, 'follow_accepted', current_uid);
        RETURN jsonb_build_object('status', 'success', 'action', 'accepted');
    ELSIF p_action = 'deny' THEN
        DELETE FROM follows WHERE id = follow_row.id;
        RETURN jsonb_build_object('status', 'success', 'action', 'denied');
    ELSE
        RETURN jsonb_build_object('status', 'error', 'code', 'invalid_action');
    END IF;
END;
$$;

-- ============================================================
-- RPC: get_user_profile
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

    IF is_own THEN
        can_see_activity := TRUE;
    ELSIF target_profile.activity_visibility = 'public' THEN
        can_see_activity := TRUE;
    ELSIF target_profile.activity_visibility = 'followers' AND follow_status = 'active' THEN
        can_see_activity := TRUE;
    ELSE
        can_see_activity := FALSE;
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object('id', pp.id, 'image_url', pp.image_url, 'position', pp.position)
        ORDER BY pp.position
    ), '[]'::jsonb)
    INTO photos
    FROM profile_photos pp
    WHERE pp.user_id = target_user_id;

    SELECT COUNT(*) INTO follower_count FROM follows WHERE following_id = target_user_id AND status = 'active';
    SELECT COUNT(*) INTO following_count FROM follows WHERE follower_id = target_user_id AND status = 'active';

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
          AND e.date >= CURRENT_DATE AND e.visibility = 'public';
    ELSE
        going_events := '[]'::jsonb;
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', e.id, 'title', e.title, 'date', e.date, 'time', e.time,
            'location', e.location, 'category', e.category, 'image_url', e.image_url
        )
    ), '[]'::jsonb)
    INTO created_events
    FROM events e
    WHERE e.creator_id = target_user_id AND e.date >= CURRENT_DATE AND e.visibility = 'public';

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
-- RPC: get_friends_activity
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
        JOIN events e ON e.id = r.event_id AND e.date >= CURRENT_DATE AND e.visibility = 'public'
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

-- ============================================================
-- RPC: purchase_timeslot
-- ============================================================

CREATE OR REPLACE FUNCTION purchase_timeslot(p_timeslot_id INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_uid UUID;
    ts RECORD;
    current_bookings INT;
    new_booking_id INT;
    new_qr_token UUID;
BEGIN
    current_uid := auth.uid();
    IF current_uid IS NULL THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'not_authenticated');
    END IF;

    PERFORM pg_advisory_xact_lock(p_timeslot_id);

    SELECT * INTO ts FROM timeslots WHERE id = p_timeslot_id;
    IF ts.id IS NULL THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'timeslot_not_found');
    END IF;

    IF NOT ts.active THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'timeslot_inactive');
    END IF;

    IF ts.date < CURRENT_DATE THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'timeslot_past');
    END IF;

    IF EXISTS (SELECT 1 FROM bookings WHERE timeslot_id = p_timeslot_id AND user_id = current_uid AND status != 'cancelled') THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'already_booked');
    END IF;

    SELECT COUNT(*) INTO current_bookings
    FROM bookings WHERE timeslot_id = p_timeslot_id AND status IN ('confirmed', 'checked_in');

    IF current_bookings >= ts.capacity THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'sold_out');
    END IF;

    new_qr_token := gen_random_uuid();
    INSERT INTO bookings (timeslot_id, user_id, qr_token, status)
    VALUES (p_timeslot_id, current_uid, new_qr_token, 'confirmed')
    RETURNING id INTO new_booking_id;

    INSERT INTO transactions (booking_id, user_id, amount, currency, status, payment_method)
    VALUES (new_booking_id, current_uid, ts.price, 'NOK', 'completed', 'mock');

    INSERT INTO notifications (user_id, type, venue_id, actor_id)
    VALUES (current_uid, 'booking_confirmed', ts.venue_id, current_uid);

    RETURN jsonb_build_object('status', 'success', 'booking_id', new_booking_id, 'qr_token', new_qr_token);
END;
$$;

-- ============================================================
-- RPC: verify_queue_ticket
-- ============================================================

CREATE OR REPLACE FUNCTION verify_queue_ticket(p_venue_id INT, p_qr_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_uid UUID;
    b RECORD;
BEGIN
    current_uid := auth.uid();
    IF NOT is_venue_staff(p_venue_id, current_uid) THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'not_staff');
    END IF;

    SELECT b2.id AS booking_id, b2.status AS booking_status, b2.checked_in_at,
           b2.user_id, p.name AS user_name, p.avatar_url AS user_avatar_url,
           ts.date, ts.start_time, ts.end_time, ts.description AS ts_description,
           ts.venue_id, ts.type AS ts_type, ts.label AS ts_label
    INTO b
    FROM bookings b2
    JOIN profiles p ON p.id = b2.user_id
    JOIN timeslots ts ON ts.id = b2.timeslot_id
    WHERE b2.qr_token = p_qr_token AND ts.venue_id = p_venue_id;

    IF b.booking_id IS NULL THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'invalid_ticket');
    END IF;

    RETURN jsonb_build_object(
        'status', 'success',
        'booking_id', b.booking_id,
        'booking_status', b.booking_status,
        'checked_in_at', b.checked_in_at,
        'user_name', b.user_name,
        'user_avatar_url', b.user_avatar_url,
        'date', b.date,
        'start_time', b.start_time,
        'end_time', b.end_time,
        'timeslot_description', b.ts_description,
        'type', b.ts_type,
        'label', b.ts_label
    );
END;
$$;

-- ============================================================
-- RPC: checkin_queue_ticket
-- ============================================================

CREATE OR REPLACE FUNCTION checkin_queue_ticket(p_booking_id INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_uid UUID;
    b RECORD;
BEGIN
    current_uid := auth.uid();

    SELECT b2.*, ts.venue_id INTO b
    FROM bookings b2
    JOIN timeslots ts ON ts.id = b2.timeslot_id
    WHERE b2.id = p_booking_id;

    IF b.id IS NULL THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'not_found');
    END IF;

    IF NOT is_venue_staff(b.venue_id, current_uid) THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'not_staff');
    END IF;

    IF b.status = 'checked_in' THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'already_checked_in');
    END IF;

    IF b.status = 'cancelled' THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'booking_cancelled');
    END IF;

    UPDATE bookings SET status = 'checked_in', checked_in_at = NOW() WHERE id = p_booking_id;

    RETURN jsonb_build_object('status', 'success');
END;
$$;

-- ============================================================
-- RPC: cancel_booking
-- ============================================================

CREATE OR REPLACE FUNCTION cancel_booking(p_booking_id INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_uid UUID;
    b RECORD;
BEGIN
    current_uid := auth.uid();
    IF current_uid IS NULL THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'not_authenticated');
    END IF;

    SELECT b2.*, ts.venue_id INTO b
    FROM bookings b2
    JOIN timeslots ts ON ts.id = b2.timeslot_id
    WHERE b2.id = p_booking_id;

    IF b.id IS NULL THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'not_found');
    END IF;

    IF b.user_id != current_uid AND NOT is_venue_staff(b.venue_id, current_uid) THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'not_authorized');
    END IF;

    IF b.status = 'cancelled' THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'already_cancelled');
    END IF;

    UPDATE bookings SET status = 'cancelled' WHERE id = p_booking_id;
    UPDATE transactions SET status = 'refunded' WHERE booking_id = p_booking_id;

    INSERT INTO notifications (user_id, type, venue_id, actor_id)
    VALUES (b.user_id, 'booking_cancelled', b.venue_id, current_uid);

    RETURN jsonb_build_object('status', 'success');
END;
$$;

-- ============================================================
-- RPC: get_venue_detail
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
BEGIN
    current_uid := auth.uid();

    SELECT * INTO v FROM venues WHERE id = p_venue_id;
    IF v.id IS NULL THEN RETURN NULL; END IF;

    SELECT role INTO staff_role FROM venue_staff WHERE venue_id = p_venue_id AND user_id = current_uid;

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
        'timeslots', upcoming_timeslots
    );
END;
$$;

-- ============================================================
-- RPC: get_venue_dashboard
-- ============================================================

CREATE OR REPLACE FUNCTION get_venue_dashboard(p_venue_id INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_uid UUID;
    v RECORD;
    all_timeslots JSONB;
    staff_list JSONB;
    total_revenue INT;
    bookings_today INT;
    sold_out_count INT;
BEGIN
    current_uid := auth.uid();

    IF NOT is_venue_staff(p_venue_id, current_uid, ARRAY['owner','manager']) THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'not_staff');
    END IF;

    SELECT * INTO v FROM venues WHERE id = p_venue_id;
    IF v.id IS NULL THEN RETURN NULL; END IF;

    SELECT COALESCE(SUM(t.amount), 0) INTO total_revenue
    FROM transactions t JOIN bookings b ON b.id = t.booking_id JOIN timeslots ts ON ts.id = b.timeslot_id
    WHERE ts.venue_id = p_venue_id AND t.status = 'completed';

    SELECT COUNT(*) INTO bookings_today
    FROM bookings b JOIN timeslots ts ON ts.id = b.timeslot_id
    WHERE ts.venue_id = p_venue_id AND ts.date = CURRENT_DATE AND b.status IN ('confirmed', 'checked_in');

    SELECT COUNT(*) INTO sold_out_count
    FROM timeslots ts WHERE ts.venue_id = p_venue_id AND ts.active = true AND ts.date >= CURRENT_DATE
      AND (SELECT COUNT(*) FROM bookings b WHERE b.timeslot_id = ts.id AND b.status IN ('confirmed', 'checked_in')) >= ts.capacity;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', ts.id, 'date', ts.date, 'start_time', ts.start_time, 'end_time', ts.end_time,
            'price', ts.price, 'capacity', ts.capacity, 'description', ts.description,
            'active', ts.active, 'event_id', ts.event_id,
            'type', ts.type, 'label', ts.label,
            'bookings', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'id', b.id, 'user_id', b.user_id, 'user_name', p.name, 'user_avatar_url', p.avatar_url,
                    'status', b.status, 'checked_in_at', b.checked_in_at, 'created_at', b.created_at
                )) FROM bookings b JOIN profiles p ON p.id = b.user_id WHERE b.timeslot_id = ts.id AND b.status != 'cancelled'
            ), '[]'::jsonb)
        ) ORDER BY ts.date DESC, ts.start_time DESC
    ), '[]'::jsonb) INTO all_timeslots FROM timeslots ts WHERE ts.venue_id = p_venue_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', vs.id, 'user_id', vs.user_id, 'role', vs.role,
        'name', p.name, 'email', p.email, 'avatar_url', p.avatar_url
    )), '[]'::jsonb) INTO staff_list
    FROM venue_staff vs JOIN profiles p ON p.id = vs.user_id WHERE vs.venue_id = p_venue_id;

    RETURN jsonb_build_object(
        'venue', jsonb_build_object('id', v.id, 'name', v.name, 'description', v.description,
            'address', v.address, 'image_url', v.image_url, 'opening_hours', v.opening_hours, 'verified', v.verified),
        'timeslots', all_timeslots, 'staff', staff_list,
        'stats', jsonb_build_object('total_revenue', total_revenue, 'bookings_today', bookings_today, 'sold_out_count', sold_out_count)
    );
END;
$$;

-- ============================================================
-- RPC: get_my_bookings
-- ============================================================

CREATE OR REPLACE FUNCTION get_my_bookings()
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
    IF current_uid IS NULL THEN RETURN '[]'::jsonb; END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'booking_id', b.id, 'status', b.status, 'qr_token', b.qr_token,
            'checked_in_at', b.checked_in_at, 'created_at', b.created_at,
            'timeslot', jsonb_build_object('id', ts.id, 'date', ts.date, 'start_time', ts.start_time,
                'end_time', ts.end_time, 'price', ts.price, 'description', ts.description,
                'type', ts.type, 'label', ts.label),
            'venue', jsonb_build_object('id', v.id, 'name', v.name, 'address', v.address, 'image_url', v.image_url)
        ) ORDER BY ts.date DESC, ts.start_time DESC
    ), '[]'::jsonb) INTO result
    FROM bookings b JOIN timeslots ts ON ts.id = b.timeslot_id JOIN venues v ON v.id = ts.venue_id
    WHERE b.user_id = current_uid;

    RETURN result;
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

-- Event Swipes
ALTER TABLE event_swipes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own swipes"
    ON event_swipes FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can create own swipes"
    ON event_swipes FOR INSERT WITH CHECK (user_id = auth.uid());

-- Profile Photos
ALTER TABLE profile_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profile photos are publicly readable"
    ON profile_photos FOR SELECT USING (true);

CREATE POLICY "Users can insert own photos"
    ON profile_photos FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own photos"
    ON profile_photos FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Users can delete own photos"
    ON profile_photos FOR DELETE USING (user_id = auth.uid());

-- Follows
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read follows"
    ON follows FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can insert as follower"
    ON follows FOR INSERT WITH CHECK (follower_id = auth.uid());

CREATE POLICY "Users can delete own follows or received follows"
    ON follows FOR DELETE USING (follower_id = auth.uid() OR following_id = auth.uid());

CREATE POLICY "Users can update follows where they are the target"
    ON follows FOR UPDATE USING (following_id = auth.uid());

-- Venues
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Venues are publicly readable"
    ON venues FOR SELECT USING (true);

CREATE POLICY "Authenticated users can create venues"
    ON venues FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND owner_id = auth.uid());

CREATE POLICY "Owner can update own venue"
    ON venues FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY "Owner can delete own venue"
    ON venues FOR DELETE USING (owner_id = auth.uid());

-- Venue Staff
ALTER TABLE venue_staff ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff records readable by staff members"
    ON venue_staff FOR SELECT USING (
        user_id = auth.uid()
        OR is_venue_staff(venue_id, auth.uid(), ARRAY['owner','manager','bouncer'])
    );

CREATE POLICY "Owner can add staff"
    ON venue_staff FOR INSERT WITH CHECK (
        is_venue_staff(venue_id, auth.uid(), ARRAY['owner'])
        OR EXISTS (SELECT 1 FROM venues WHERE id = venue_id AND owner_id = auth.uid())
    );

CREATE POLICY "Owner can remove staff"
    ON venue_staff FOR DELETE USING (
        is_venue_staff(venue_id, auth.uid(), ARRAY['owner'])
        OR EXISTS (SELECT 1 FROM venues WHERE id = venue_id AND owner_id = auth.uid())
    );

-- Timeslots
ALTER TABLE timeslots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active timeslots are publicly readable"
    ON timeslots FOR SELECT USING (active = true OR is_venue_staff(venue_id, auth.uid(), ARRAY['owner','manager']));

CREATE POLICY "Staff can create timeslots"
    ON timeslots FOR INSERT WITH CHECK (is_venue_staff(venue_id, auth.uid(), ARRAY['owner','manager']));

CREATE POLICY "Staff can update timeslots"
    ON timeslots FOR UPDATE USING (is_venue_staff(venue_id, auth.uid(), ARRAY['owner','manager']));

CREATE POLICY "Staff can delete timeslots"
    ON timeslots FOR DELETE USING (is_venue_staff(venue_id, auth.uid(), ARRAY['owner','manager']));

-- Bookings
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own bookings"
    ON bookings FOR SELECT USING (
        user_id = auth.uid()
        OR is_venue_staff((SELECT venue_id FROM timeslots WHERE id = timeslot_id), auth.uid())
    );

CREATE POLICY "Users can create own bookings"
    ON bookings FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users or staff can update bookings"
    ON bookings FOR UPDATE USING (
        user_id = auth.uid()
        OR is_venue_staff((SELECT venue_id FROM timeslots WHERE id = timeslot_id), auth.uid())
    );

-- Transactions
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own transactions"
    ON transactions FOR SELECT USING (user_id = auth.uid());

-- ============================================================
-- ENABLE REALTIME on notifications
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

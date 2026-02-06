-- ============================================================
-- Drikkepress — Supabase Schema
-- Run this in Supabase SQL Editor
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
    id          SERIAL PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT,
    date        DATE NOT NULL,
    time        TIME NOT NULL,
    end_time    TIME,
    location    TEXT NOT NULL,
    image_url   TEXT,
    category    TEXT NOT NULL,
    visibility  TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'semi_public')),
    latitude    DOUBLE PRECISION,
    longitude   DOUBLE PRECISION,
    creator_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
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
    status      TEXT NOT NULL CHECK (status IN ('going', 'interested')),
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, event_id)
);

CREATE INDEX idx_rsvps_event ON rsvps(event_id);
CREATE INDEX idx_rsvps_user ON rsvps(user_id);

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
        'has_access', true,
        'creator_name', (SELECT name FROM profiles WHERE id = ev.creator_id),
        'going_count', (SELECT COUNT(*) FROM rsvps WHERE event_id = p_event_id AND status = 'going'),
        'interested_count', (SELECT COUNT(*) FROM rsvps WHERE event_id = p_event_id AND status = 'interested'),
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

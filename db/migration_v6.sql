-- ============================================================
-- Migration V6: Social Features — Profiles, Follows, Friends Activity
-- ============================================================

-- 1A. ALTER profiles: add bio and activity_visibility
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT '';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS activity_visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (activity_visibility IN ('public', 'followers', 'private'));

-- 1B. New table: profile_photos (max 6 enforced by trigger)
CREATE TABLE IF NOT EXISTS profile_photos (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profile_photos_user ON profile_photos(user_id);

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

DROP TRIGGER IF EXISTS trg_enforce_max_profile_photos ON profile_photos;
CREATE TRIGGER trg_enforce_max_profile_photos
    BEFORE INSERT ON profile_photos
    FOR EACH ROW
    EXECUTE FUNCTION enforce_max_profile_photos();

-- 1C. New table: follows
CREATE TABLE IF NOT EXISTS follows (
    id SERIAL PRIMARY KEY,
    follower_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    following_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('active', 'pending')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(follower_id, following_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);
CREATE INDEX IF NOT EXISTS idx_follows_pending ON follows(following_id) WHERE status = 'pending';

-- 1D. RLS policies for profile_photos
ALTER TABLE profile_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profile photos are publicly readable"
    ON profile_photos FOR SELECT USING (true);

CREATE POLICY "Users can insert own photos"
    ON profile_photos FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own photos"
    ON profile_photos FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Users can delete own photos"
    ON profile_photos FOR DELETE USING (user_id = auth.uid());

-- RLS policies for follows
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read follows"
    ON follows FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can insert as follower"
    ON follows FOR INSERT WITH CHECK (follower_id = auth.uid());

CREATE POLICY "Users can delete own follows or received follows"
    ON follows FOR DELETE USING (follower_id = auth.uid() OR following_id = auth.uid());

CREATE POLICY "Users can update follows where they are the target"
    ON follows FOR UPDATE USING (following_id = auth.uid());

-- 1E. Update notifications to support follow types
ALTER TABLE notifications ALTER COLUMN event_id DROP NOT NULL;

-- Update the CHECK constraint on notifications.type to include new types
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
    CHECK (type IN ('rsvp','comment','access_request','invitation','reminder','waitlist_promoted','kicked','follow_request','follow_accepted'));

-- 1F. RPC Functions

-- toggle_follow: follow/unfollow a user
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

    -- Check if already following
    SELECT * INTO existing_follow FROM follows
    WHERE follower_id = current_uid AND following_id = target_user_id;

    IF existing_follow.id IS NOT NULL THEN
        -- Unfollow
        DELETE FROM follows WHERE id = existing_follow.id;
        RETURN jsonb_build_object('status', 'success', 'action', 'unfollowed');
    END IF;

    -- Get target's visibility setting
    SELECT activity_visibility INTO target_visibility FROM profiles WHERE id = target_user_id;

    IF target_visibility = 'public' THEN
        new_status := 'active';
    ELSE
        new_status := 'pending';
    END IF;

    INSERT INTO follows (follower_id, following_id, status)
    VALUES (current_uid, target_user_id, new_status);

    -- Create notification
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

-- handle_follow_request: accept or deny a follow request
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
        -- Notify the follower that their request was accepted
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

-- get_user_profile: returns profile data respecting privacy settings
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

    -- Going events (only if can see activity)
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

    -- Created events (always visible, only public upcoming)
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

-- get_friends_activity: paginated feed of what friends are doing
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

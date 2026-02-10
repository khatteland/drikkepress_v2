-- ============================================================
-- Migration V7: Venue / Timeslot / Booking System
-- ============================================================

-- 1A. New table: venues
CREATE TABLE venues (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    address TEXT NOT NULL,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    image_url TEXT,
    opening_hours TEXT DEFAULT '',
    contact_email TEXT,
    contact_phone TEXT,
    owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_venues_owner ON venues(owner_id);

-- 1B. New table: venue_staff
CREATE TABLE venue_staff (
    id SERIAL PRIMARY KEY,
    venue_id INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'bouncer')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(venue_id, user_id)
);

CREATE INDEX idx_venue_staff_venue ON venue_staff(venue_id);
CREATE INDEX idx_venue_staff_user ON venue_staff(user_id);

-- 1C. New table: timeslots
CREATE TABLE timeslots (
    id SERIAL PRIMARY KEY,
    venue_id INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    price INTEGER NOT NULL DEFAULT 0,
    capacity INTEGER NOT NULL DEFAULT 10,
    description TEXT DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_timeslots_venue ON timeslots(venue_id);
CREATE INDEX idx_timeslots_event ON timeslots(event_id);
CREATE INDEX idx_timeslots_date ON timeslots(date);

-- 1D. New table: bookings
CREATE TABLE bookings (
    id SERIAL PRIMARY KEY,
    timeslot_id INTEGER NOT NULL REFERENCES timeslots(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    qr_token UUID NOT NULL DEFAULT gen_random_uuid(),
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'checked_in', 'cancelled', 'expired')),
    checked_in_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(timeslot_id, user_id)
);

CREATE INDEX idx_bookings_timeslot ON bookings(timeslot_id);
CREATE INDEX idx_bookings_user ON bookings(user_id);
CREATE UNIQUE INDEX idx_bookings_qr_token ON bookings(qr_token);

-- 1E. New table: transactions
CREATE TABLE transactions (
    id SERIAL PRIMARY KEY,
    booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'NOK',
    status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'refunded')),
    payment_method TEXT NOT NULL DEFAULT 'mock',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_transactions_booking ON transactions(booking_id);
CREATE INDEX idx_transactions_user ON transactions(user_id);

-- 1F. ALTER events — optional venue link
ALTER TABLE events ADD COLUMN IF NOT EXISTS venue_id INTEGER REFERENCES venues(id) ON DELETE SET NULL;

-- 1G. Helper function: is_venue_staff
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

-- 1H. RLS policies

-- venues
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Venues are publicly readable"
    ON venues FOR SELECT USING (true);

CREATE POLICY "Authenticated users can create venues"
    ON venues FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND owner_id = auth.uid());

CREATE POLICY "Owner can update own venue"
    ON venues FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY "Owner can delete own venue"
    ON venues FOR DELETE USING (owner_id = auth.uid());

-- venue_staff
ALTER TABLE venue_staff ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff records readable by staff members and public venue_id"
    ON venue_staff FOR SELECT USING (
        user_id = auth.uid()
        OR is_venue_staff(venue_id, auth.uid(), ARRAY['owner','manager','bouncer'])
    );

CREATE POLICY "Owner can add staff"
    ON venue_staff FOR INSERT WITH CHECK (
        is_venue_staff(venue_id, auth.uid(), ARRAY['owner'])
    );

CREATE POLICY "Owner can remove staff"
    ON venue_staff FOR DELETE USING (
        is_venue_staff(venue_id, auth.uid(), ARRAY['owner'])
    );

-- timeslots
ALTER TABLE timeslots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active timeslots are publicly readable"
    ON timeslots FOR SELECT USING (active = true OR is_venue_staff(venue_id, auth.uid(), ARRAY['owner','manager']));

CREATE POLICY "Staff can create timeslots"
    ON timeslots FOR INSERT WITH CHECK (
        is_venue_staff(venue_id, auth.uid(), ARRAY['owner','manager'])
    );

CREATE POLICY "Staff can update timeslots"
    ON timeslots FOR UPDATE USING (
        is_venue_staff(venue_id, auth.uid(), ARRAY['owner','manager'])
    );

CREATE POLICY "Staff can delete timeslots"
    ON timeslots FOR DELETE USING (
        is_venue_staff(venue_id, auth.uid(), ARRAY['owner','manager'])
    );

-- bookings
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

-- transactions
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own transactions"
    ON transactions FOR SELECT USING (user_id = auth.uid());

-- 1I. RPC functions

-- purchase_timeslot
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

    -- Lock to prevent race conditions
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

    -- Check if already booked
    IF EXISTS (SELECT 1 FROM bookings WHERE timeslot_id = p_timeslot_id AND user_id = current_uid AND status != 'cancelled') THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'already_booked');
    END IF;

    -- Check capacity
    SELECT COUNT(*) INTO current_bookings
    FROM bookings WHERE timeslot_id = p_timeslot_id AND status IN ('confirmed', 'checked_in');

    IF current_bookings >= ts.capacity THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'sold_out');
    END IF;

    -- Create booking
    new_qr_token := gen_random_uuid();
    INSERT INTO bookings (timeslot_id, user_id, qr_token, status)
    VALUES (p_timeslot_id, current_uid, new_qr_token, 'confirmed')
    RETURNING id INTO new_booking_id;

    -- Create mock transaction
    INSERT INTO transactions (booking_id, user_id, amount, currency, status, payment_method)
    VALUES (new_booking_id, current_uid, ts.price, 'NOK', 'completed', 'mock');

    -- Create notification
    INSERT INTO notifications (user_id, type, venue_id, actor_id)
    VALUES (current_uid, 'booking_confirmed', ts.venue_id, current_uid);

    RETURN jsonb_build_object('status', 'success', 'booking_id', new_booking_id, 'qr_token', new_qr_token);
END;
$$;

-- verify_queue_ticket
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

    SELECT b.id AS booking_id, b.status AS booking_status, b.checked_in_at,
           b.user_id, p.name AS user_name, p.avatar_url AS user_avatar_url,
           ts.date, ts.start_time, ts.end_time, ts.description AS ts_description, ts.venue_id
    INTO b
    FROM bookings b
    JOIN profiles p ON p.id = b.user_id
    JOIN timeslots ts ON ts.id = b.timeslot_id
    WHERE b.qr_token = p_qr_token AND ts.venue_id = p_venue_id;

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
        'timeslot_description', b.ts_description
    );
END;
$$;

-- checkin_queue_ticket
CREATE OR REPLACE FUNCTION checkin_queue_ticket(p_booking_id INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_uid UUID;
    b RECORD;
    v_id INT;
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

-- cancel_booking
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

    -- Notification
    INSERT INTO notifications (user_id, type, venue_id, actor_id)
    VALUES (b.user_id, 'booking_cancelled', b.venue_id, current_uid);

    RETURN jsonb_build_object('status', 'success');
END;
$$;

-- get_venue_detail
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

    -- Get user's staff role if any
    SELECT role INTO staff_role FROM venue_staff WHERE venue_id = p_venue_id AND user_id = current_uid;

    -- Get upcoming active timeslots with available spots
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', ts.id,
            'date', ts.date,
            'start_time', ts.start_time,
            'end_time', ts.end_time,
            'price', ts.price,
            'capacity', ts.capacity,
            'description', ts.description,
            'event_id', ts.event_id,
            'booked_count', (SELECT COUNT(*) FROM bookings b WHERE b.timeslot_id = ts.id AND b.status IN ('confirmed', 'checked_in')),
            'my_booking', (SELECT jsonb_build_object('id', b.id, 'status', b.status, 'qr_token', b.qr_token)
                          FROM bookings b WHERE b.timeslot_id = ts.id AND b.user_id = current_uid AND b.status != 'cancelled'
                          LIMIT 1)
        ) ORDER BY ts.date, ts.start_time
    ), '[]'::jsonb)
    INTO upcoming_timeslots
    FROM timeslots ts
    WHERE ts.venue_id = p_venue_id AND ts.active = true AND ts.date >= CURRENT_DATE;

    RETURN jsonb_build_object(
        'id', v.id,
        'name', v.name,
        'description', v.description,
        'address', v.address,
        'latitude', v.latitude,
        'longitude', v.longitude,
        'image_url', v.image_url,
        'opening_hours', v.opening_hours,
        'contact_email', v.contact_email,
        'contact_phone', v.contact_phone,
        'owner_id', v.owner_id,
        'verified', v.verified,
        'created_at', v.created_at,
        'is_staff', (staff_role IS NOT NULL),
        'staff_role', staff_role,
        'timeslots', upcoming_timeslots
    );
END;
$$;

-- get_venue_dashboard
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

    -- Stats
    SELECT COALESCE(SUM(t.amount), 0) INTO total_revenue
    FROM transactions t
    JOIN bookings b ON b.id = t.booking_id
    JOIN timeslots ts ON ts.id = b.timeslot_id
    WHERE ts.venue_id = p_venue_id AND t.status = 'completed';

    SELECT COUNT(*) INTO bookings_today
    FROM bookings b
    JOIN timeslots ts ON ts.id = b.timeslot_id
    WHERE ts.venue_id = p_venue_id AND ts.date = CURRENT_DATE AND b.status IN ('confirmed', 'checked_in');

    SELECT COUNT(*) INTO sold_out_count
    FROM timeslots ts
    WHERE ts.venue_id = p_venue_id AND ts.active = true AND ts.date >= CURRENT_DATE
      AND (SELECT COUNT(*) FROM bookings b WHERE b.timeslot_id = ts.id AND b.status IN ('confirmed', 'checked_in')) >= ts.capacity;

    -- All timeslots with bookings
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', ts.id,
            'date', ts.date,
            'start_time', ts.start_time,
            'end_time', ts.end_time,
            'price', ts.price,
            'capacity', ts.capacity,
            'description', ts.description,
            'active', ts.active,
            'event_id', ts.event_id,
            'bookings', COALESCE((
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'id', b.id, 'user_id', b.user_id,
                        'user_name', p.name, 'user_avatar_url', p.avatar_url,
                        'status', b.status, 'checked_in_at', b.checked_in_at,
                        'created_at', b.created_at
                    )
                )
                FROM bookings b JOIN profiles p ON p.id = b.user_id
                WHERE b.timeslot_id = ts.id AND b.status != 'cancelled'
            ), '[]'::jsonb)
        ) ORDER BY ts.date DESC, ts.start_time DESC
    ), '[]'::jsonb)
    INTO all_timeslots
    FROM timeslots ts WHERE ts.venue_id = p_venue_id;

    -- Staff list
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', vs.id, 'user_id', vs.user_id,
            'role', vs.role,
            'name', p.name, 'email', p.email, 'avatar_url', p.avatar_url
        )
    ), '[]'::jsonb)
    INTO staff_list
    FROM venue_staff vs JOIN profiles p ON p.id = vs.user_id
    WHERE vs.venue_id = p_venue_id;

    RETURN jsonb_build_object(
        'venue', jsonb_build_object(
            'id', v.id, 'name', v.name, 'description', v.description,
            'address', v.address, 'image_url', v.image_url,
            'opening_hours', v.opening_hours, 'verified', v.verified
        ),
        'timeslots', all_timeslots,
        'staff', staff_list,
        'stats', jsonb_build_object(
            'total_revenue', total_revenue,
            'bookings_today', bookings_today,
            'sold_out_count', sold_out_count
        )
    );
END;
$$;

-- get_my_bookings
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
    IF current_uid IS NULL THEN
        RETURN '[]'::jsonb;
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'booking_id', b.id,
            'status', b.status,
            'qr_token', b.qr_token,
            'checked_in_at', b.checked_in_at,
            'created_at', b.created_at,
            'timeslot', jsonb_build_object(
                'id', ts.id, 'date', ts.date,
                'start_time', ts.start_time, 'end_time', ts.end_time,
                'price', ts.price, 'description', ts.description
            ),
            'venue', jsonb_build_object(
                'id', v.id, 'name', v.name,
                'address', v.address, 'image_url', v.image_url
            )
        ) ORDER BY ts.date DESC, ts.start_time DESC
    ), '[]'::jsonb)
    INTO result
    FROM bookings b
    JOIN timeslots ts ON ts.id = b.timeslot_id
    JOIN venues v ON v.id = ts.venue_id
    WHERE b.user_id = current_uid;

    RETURN result;
END;
$$;

-- 1J. Update get_event_detail to include venue_id
-- We need to re-create the function to add venue_id to the return object.
-- The function uses ev.venue_id which is available after ALTER TABLE events.
-- We'll use a DO block to alter the function return to include venue_id:
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

-- 1K. Update notifications for venue types
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS venue_id INTEGER REFERENCES venues(id);

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
    CHECK (type IN ('rsvp','comment','access_request','invitation','reminder',
                    'waitlist_promoted','kicked','follow_request','follow_accepted',
                    'booking_confirmed','booking_cancelled'));

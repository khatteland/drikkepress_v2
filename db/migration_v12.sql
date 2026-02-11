-- ============================================================
-- Migration V12: Vipps Login, Vipps Payment, Age Verification
-- ============================================================

-- 1A. New columns on profiles for Vipps
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS birthdate DATE,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS vipps_sub TEXT UNIQUE;

-- 1B. Age restriction on events and venues
ALTER TABLE events ADD COLUMN IF NOT EXISTS min_age INTEGER DEFAULT NULL;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS min_age INTEGER DEFAULT NULL;

-- 1C. Extend transactions for Vipps payments
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS vipps_reference TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS vipps_psp_reference TEXT;

-- Allow pending and cancelled status on transactions
-- (existing check constraint may need updating — use DO block for safety)
DO $$
BEGIN
  -- Drop old constraint if it exists
  ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_status_check;
  -- Add updated constraint
  ALTER TABLE transactions ADD CONSTRAINT transactions_status_check
    CHECK (status IN ('completed', 'refunded', 'pending', 'cancelled'));
EXCEPTION WHEN OTHERS THEN NULL;
END$$;

-- Allow pending_payment and expired status on bookings
DO $$
BEGIN
  ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
  ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
    CHECK (status IN ('confirmed', 'checked_in', 'cancelled', 'pending_payment', 'expired'));
EXCEPTION WHEN OTHERS THEN NULL;
END$$;

-- ============================================================
-- 1D. Update handle_new_user trigger — store Vipps data
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO profiles (id, name, email, phone, birthdate, vipps_sub)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
        NEW.email,
        NEW.raw_user_meta_data->>'phone',
        (NEW.raw_user_meta_data->>'birthdate')::DATE,
        NEW.raw_user_meta_data->>'vipps_sub'
    );
    INSERT INTO notification_preferences (user_id) VALUES (NEW.id);
    RETURN NEW;
END;
$$;

-- ============================================================
-- 1E. check_user_age function
-- ============================================================

CREATE OR REPLACE FUNCTION check_user_age(p_user_id UUID, p_min_age INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    user_birthdate DATE;
BEGIN
    IF p_min_age IS NULL THEN RETURN TRUE; END IF;

    SELECT birthdate INTO user_birthdate FROM profiles WHERE id = p_user_id;
    IF user_birthdate IS NULL THEN RETURN FALSE; END IF;

    RETURN AGE(CURRENT_DATE, user_birthdate) >= make_interval(years => p_min_age);
END;
$$;

-- ============================================================
-- 1F. reserve_timeslot — replaces purchase_timeslot for Vipps
--     Two-phase: free = confirm immediately, paid = pending_payment
-- ============================================================

CREATE OR REPLACE FUNCTION reserve_timeslot(p_timeslot_id INT, p_vipps_reference TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_uid UUID;
    ts RECORD;
    v RECORD;
    current_bookings INT;
    new_booking_id INT;
    new_qr_token UUID;
    is_free BOOLEAN;
    venue_min_age INTEGER;
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

    -- Age check (venue-level)
    SELECT min_age INTO venue_min_age FROM venues WHERE id = ts.venue_id;
    IF venue_min_age IS NOT NULL AND NOT check_user_age(current_uid, venue_min_age) THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'too_young', 'min_age', venue_min_age);
    END IF;

    IF EXISTS (SELECT 1 FROM bookings WHERE timeslot_id = p_timeslot_id AND user_id = current_uid AND status NOT IN ('cancelled', 'expired')) THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'already_booked');
    END IF;

    SELECT COUNT(*) INTO current_bookings
    FROM bookings WHERE timeslot_id = p_timeslot_id AND status IN ('confirmed', 'checked_in', 'pending_payment');

    IF current_bookings >= ts.capacity THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'sold_out');
    END IF;

    is_free := (ts.price = 0);
    new_qr_token := gen_random_uuid();

    IF is_free THEN
        -- Free: confirm immediately
        INSERT INTO bookings (timeslot_id, user_id, qr_token, status)
        VALUES (p_timeslot_id, current_uid, new_qr_token, 'confirmed')
        RETURNING id INTO new_booking_id;

        INSERT INTO transactions (booking_id, user_id, amount, currency, status, payment_method)
        VALUES (new_booking_id, current_uid, 0, 'NOK', 'completed', 'free');

        INSERT INTO notifications (user_id, type, venue_id, actor_id)
        VALUES (current_uid, 'booking_confirmed', ts.venue_id, current_uid);

        RETURN jsonb_build_object('status', 'success', 'booking_id', new_booking_id, 'qr_token', new_qr_token, 'payment_required', false);
    ELSE
        -- Paid: create pending booking
        INSERT INTO bookings (timeslot_id, user_id, qr_token, status)
        VALUES (p_timeslot_id, current_uid, new_qr_token, 'pending_payment')
        RETURNING id INTO new_booking_id;

        INSERT INTO transactions (booking_id, user_id, amount, currency, status, payment_method, vipps_reference)
        VALUES (new_booking_id, current_uid, ts.price, 'NOK', 'pending', 'vipps', p_vipps_reference);

        RETURN jsonb_build_object(
            'status', 'success',
            'booking_id', new_booking_id,
            'qr_token', new_qr_token,
            'payment_required', true,
            'amount', ts.price,
            'vipps_reference', p_vipps_reference
        );
    END IF;
END;
$$;

-- Keep purchase_timeslot as alias for backwards compatibility (free tickets only)
CREATE OR REPLACE FUNCTION purchase_timeslot(p_timeslot_id INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN reserve_timeslot(p_timeslot_id, NULL);
END;
$$;

-- ============================================================
-- 1G. confirm_vipps_payment — called by webhook
-- ============================================================

CREATE OR REPLACE FUNCTION confirm_vipps_payment(p_vipps_reference TEXT, p_psp_reference TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    tx RECORD;
    bk RECORD;
BEGIN
    SELECT * INTO tx FROM transactions WHERE vipps_reference = p_vipps_reference;
    IF tx.id IS NULL THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'reference_not_found');
    END IF;

    IF tx.status = 'completed' THEN
        RETURN jsonb_build_object('status', 'already_confirmed');
    END IF;

    UPDATE transactions
    SET status = 'completed', vipps_psp_reference = p_psp_reference
    WHERE id = tx.id;

    UPDATE bookings SET status = 'confirmed' WHERE id = tx.booking_id
    RETURNING * INTO bk;

    -- Send notification
    INSERT INTO notifications (user_id, type, venue_id, actor_id)
    SELECT bk.user_id, 'booking_confirmed', ts.venue_id, bk.user_id
    FROM timeslots ts WHERE ts.id = bk.timeslot_id;

    RETURN jsonb_build_object('status', 'success', 'booking_id', tx.booking_id);
END;
$$;

-- ============================================================
-- 1H. Update cancel_booking — return refund info
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
    tx RECORD;
    needs_refund BOOLEAN;
    ref TEXT;
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

    IF b.status IN ('cancelled', 'expired') THEN
        RETURN jsonb_build_object('status', 'error', 'code', 'already_cancelled');
    END IF;

    UPDATE bookings SET status = 'cancelled' WHERE id = p_booking_id;

    -- Check if Vipps refund is needed
    SELECT * INTO tx FROM transactions WHERE booking_id = p_booking_id AND status = 'completed' AND payment_method = 'vipps';
    IF tx.id IS NOT NULL THEN
        needs_refund := true;
        ref := tx.vipps_reference;
        UPDATE transactions SET status = 'refunded' WHERE id = tx.id;
    ELSE
        needs_refund := false;
        ref := NULL;
        UPDATE transactions SET status = 'refunded' WHERE booking_id = p_booking_id AND status != 'refunded';
    END IF;

    INSERT INTO notifications (user_id, type, venue_id, actor_id)
    VALUES (b.user_id, 'booking_cancelled', b.venue_id, current_uid);

    RETURN jsonb_build_object('status', 'success', 'needs_refund', needs_refund, 'vipps_reference', ref);
END;
$$;

-- ============================================================
-- 1I. Update get_venue_detail — include min_age
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
    v_is_following BOOLEAN;
    v_follower_count INTEGER;
BEGIN
    current_uid := auth.uid();

    SELECT * INTO v FROM venues WHERE id = p_venue_id;
    IF v.id IS NULL THEN RETURN NULL; END IF;

    SELECT role INTO staff_role FROM venue_staff WHERE venue_id = p_venue_id AND user_id = current_uid;

    IF current_uid IS NOT NULL THEN
        SELECT EXISTS(SELECT 1 FROM venue_follows WHERE user_id = current_uid AND venue_id = p_venue_id) INTO v_is_following;
    ELSE
        v_is_following := false;
    END IF;

    SELECT COUNT(*) INTO v_follower_count FROM venue_follows WHERE venue_id = p_venue_id;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', ts.id, 'date', ts.date, 'start_time', ts.start_time, 'end_time', ts.end_time,
            'price', ts.price, 'capacity', ts.capacity, 'description', ts.description, 'event_id', ts.event_id,
            'type', ts.type, 'label', ts.label,
            'booked_count', (SELECT COUNT(*) FROM bookings b WHERE b.timeslot_id = ts.id AND b.status IN ('confirmed', 'checked_in', 'pending_payment')),
            'my_booking', (SELECT jsonb_build_object('id', b.id, 'status', b.status, 'qr_token', b.qr_token)
                          FROM bookings b WHERE b.timeslot_id = ts.id AND b.user_id = current_uid AND b.status NOT IN ('cancelled', 'expired') LIMIT 1)
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
        'min_age', v.min_age,
        'is_staff', (staff_role IS NOT NULL), 'staff_role', staff_role,
        'is_following', v_is_following,
        'follower_count', v_follower_count,
        'timeslots', upcoming_timeslots
    );
END;
$$;

-- ============================================================
-- 1I-b. Update get_event_detail — include min_age
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
            'event_mode', ev.event_mode,
            'min_age', ev.min_age,
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
        'min_age', ev.min_age,
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
-- 1J. Expire pending bookings (run via pg_cron or scheduled function)
-- ============================================================

CREATE OR REPLACE FUNCTION expire_pending_bookings()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    expired_count INTEGER;
BEGIN
    WITH expired AS (
        UPDATE bookings SET status = 'expired'
        WHERE status = 'pending_payment' AND created_at < NOW() - INTERVAL '15 minutes'
        RETURNING id
    )
    SELECT COUNT(*) INTO expired_count FROM expired;

    -- Also cancel associated pending transactions
    UPDATE transactions SET status = 'cancelled'
    WHERE booking_id IN (
        SELECT id FROM bookings WHERE status = 'expired'
    ) AND status = 'pending';

    RETURN expired_count;
END;
$$;

-- Update get_my_bookings to handle new statuses
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
            'venue', jsonb_build_object('id', v.id, 'name', v.name, 'address', v.address, 'image_url', v.image_url),
            'vipps_reference', (SELECT t.vipps_reference FROM transactions t WHERE t.booking_id = b.id LIMIT 1)
        ) ORDER BY ts.date DESC, ts.start_time DESC
    ), '[]'::jsonb) INTO result
    FROM bookings b JOIN timeslots ts ON ts.id = b.timeslot_id JOIN venues v ON v.id = ts.venue_id
    WHERE b.user_id = current_uid AND b.status != 'expired';

    RETURN result;
END;
$$;

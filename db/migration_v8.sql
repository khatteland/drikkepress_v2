-- ============================================================
-- Migration V8: Add type and label to timeslots
-- Supports: queue (default), ticket, table
-- ============================================================

-- 1. Add new columns
ALTER TABLE timeslots ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'queue'
  CHECK (type IN ('queue', 'ticket', 'table'));
ALTER TABLE timeslots ADD COLUMN IF NOT EXISTS label TEXT DEFAULT '';

-- 2. Index on type
CREATE INDEX IF NOT EXISTS idx_timeslots_type ON timeslots(type);

-- 3. Update get_venue_detail to include type and label
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

-- 4. Update get_venue_dashboard to include type and label
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

-- 5. Update get_my_bookings to include type and label
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

-- 6. Update verify_queue_ticket to include type and label
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

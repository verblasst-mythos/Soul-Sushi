-- Soul Sushi – Update: Termine + VIP-Anträge löschen
-- Sicher: ändert keine Tabellenstruktur, löscht keine Daten. Einmal im Supabase SQL Editor ausführen.
begin;

-- Liste 'appointments' im Datenspeicher anlegen
create or replace function private.load() returns jsonb
language plpgsql as $$
declare d jsonb; k text;
begin
  select data into d from private.state where id = 'main' for update;
  if d is null then
    d := jsonb_build_object('status', '{"isOpen":true,"workload":"Niedrig","discordWebhook":""}'::jsonb);
  end if;
  foreach k in array array['roles','staff','menu','orders','reservations','customers','vipApplications','appointments','news','jobs','discounts'] loop
    if d->k is null then d := jsonb_set(d, array[k], '[]'::jsonb); end if;
  end loop;
  return d;
end $$;

-- Tische (muss zu floorplan.js passen): Lounge-Tische N1-N11 (4 Plätze), Tische L1-L3 (4 Sitze), Barhocker B1-B15 (1)
create or replace function private.table_seats() returns jsonb
language sql immutable as $$
  select '{"N1":4,"N2":4,"N3":4,"N4":4,"N5":4,"N6":4,"N7":4,"N8":4,"N9":4,"N10":4,"N11":4,
           "L1":4,"L2":4,"L3":4,
           "B1":1,"B2":1,"B3":1,"B4":1,"B5":1,"B6":1,"B7":1,"B8":1,"B9":1,"B10":1,"B11":1,"B12":1,"B13":1,"B14":1,"B15":1}'::jsonb
$$;

-- Belegte Tische zu Datum + Uhrzeit (Reservierung blockiert 2 Stunden)
create or replace function private.taken_tables(p_date text, p_time text) returns text[]
language plpgsql as $$
declare d jsonb; res text[] := '{}'; r jsonb; t text; m int; m2 int;
begin
  if coalesce(p_time, '') !~ '^\d{1,2}:\d{2}' then return res; end if;
  m := split_part(p_time, ':', 1)::int * 60 + split_part(p_time, ':', 2)::int;
  select data into d from private.state where id = 'main';
  for r in select e from jsonb_array_elements(coalesce(d->'reservations', '[]'::jsonb)) e loop
    continue when r->>'date' is distinct from p_date;
    continue when coalesce(r->>'time', '') !~ '^\d{1,2}:\d{2}';
    m2 := split_part(r->>'time', ':', 1)::int * 60 + split_part(r->>'time', ':', 2)::int;
    continue when abs(m - m2) >= 120;
    for t in select jsonb_array_elements_text(coalesce(r->'tables', '[]'::jsonb)) loop
      res := res || t;
    end loop;
  end loop;
  return res;
end $$;

create or replace function public.api_taken_tables(p_date text, p_time text) returns jsonb
language plpgsql security definer set search_path = private, public as $$
begin
  return jsonb_build_object('taken', to_jsonb(private.taken_tables(left(coalesce(p_date, ''), 40), left(coalesce(p_time, ''), 20))));
end $$;

-- Reservierung mit Telefonnummer, Anmerkungen und Tischwahl
create or replace function public.api_place_reservation(p jsonb) returns jsonb
language plpgsql security definer set search_path = private, public as $$
declare d jsonb; r jsonb; tabs jsonb := '[]'::jsonb; t text; seats int := 0; seat_map jsonb := private.table_seats();
        guests int := greatest(1, coalesce((p->>'guests')::int, 1)); area text := left(coalesce(p->>'type', ''), 40);
        has_bar boolean := false; has_other boolean := false;
begin
  d := private.load();
  for t in select distinct jsonb_array_elements_text(coalesce(p->'tables', '[]'::jsonb)) loop
    if seat_map->t is null then
      return jsonb_build_object('error', 'Unbekannter Tisch: ' || left(t, 10), 'status', 400);
    end if;
    tabs := tabs || to_jsonb(t);
    seats := seats + (seat_map->>t)::int;
    if t like 'B%' then has_bar := true; else has_other := true; end if;
  end loop;
  if has_bar and has_other then
    return jsonb_build_object('error', 'Barhocker und Tisch lassen sich nicht mischen.', 'status', 400);
  end if;
  if jsonb_array_length(tabs) > 0 then
    if jsonb_array_length(tabs) > 1 and has_other then
      return jsonb_build_object('error', 'Bitte nur einen Tisch wählen.', 'status', 400);
    end if;
    if seats < guests then
      return jsonb_build_object('error', 'Der gewählte Tisch hat zu wenig Plätze für ' || guests || ' Personen.', 'status', 400);
    end if;
    if exists (select 1 from jsonb_array_elements_text(tabs) x
               where x = any(private.taken_tables(left(coalesce(p->>'date', ''), 40), left(coalesce(p->>'time', ''), 20)))) then
      return jsonb_build_object('error', 'Dieser Tisch ist zur gewählten Zeit schon vergeben. Bitte wähle einen anderen.', 'status', 409);
    end if;
    area := case when has_bar then 'Sushi Bar' else 'Hauptraum' end;
  end if;
  r := jsonb_build_object('id', private.now_id()::text, 'name', left(coalesce(p->>'name', ''), 60),
        'guests', guests, 'date', left(coalesce(p->>'date', ''), 40),
        'time', left(coalesce(p->>'time', ''), 20), 'type', area,
        'phone', left(coalesce(p->>'phone', ''), 40), 'notes', left(coalesce(p->>'notes', ''), 500),
        'tables', tabs, 'status', 'Bestätigt');
  d := jsonb_set(d, '{reservations}', jsonb_build_array(r) || (d->'reservations'));
  perform private.save(d);
  return r;
end $$;

-- Öffentlicher Zustand inkl. News, Stellen und Bewerbungsphase
create or replace function public.api_public_state() returns jsonb
language plpgsql security definer set search_path = private, public as $$
declare d jsonb;
begin
  select data into d from private.state where id = 'main';
  d := coalesce(d, '{}'::jsonb);
  return jsonb_build_object(
    'status',  jsonb_build_object('isOpen', case when exists (select 1 from jsonb_array_elements(coalesce(d->'staff', '[]'::jsonb)) st where coalesce((st->>'onDuty')::boolean, false)) then coalesce(d->'status'->'isOpen', 'true'::jsonb) else 'false'::jsonb end,
                                  'workload', coalesce(d->'status'->'workload', '"Niedrig"'::jsonb),
                                  'discordInvite', coalesce(d->'status'->'discordInvite', '""'::jsonb),
                                  'applicationsOpen', coalesce(d->'status'->'applicationsOpen', 'false'::jsonb)),
    'roles',   coalesce(d->'roles', '[]'::jsonb),
    'staff',   private.staff_public(coalesce(d->'staff', '[]'::jsonb)),
    'menu',    coalesce(d->'menu', '[]'::jsonb),
    'news',    coalesce(d->'news', '[]'::jsonb),
    'jobs',    coalesce(d->'jobs', '[]'::jsonb),
    'orders', '[]'::jsonb, 'reservations', '[]'::jsonb, 'customers', '[]'::jsonb, 'vipApplications', '[]'::jsonb);
end $$;

-- Termin anfragen (nur eingeloggte Kunden)
create or replace function public.api_appointment_create(p_username text, p_password text, p jsonb) returns jsonb
language plpgsql security definer set search_path = private, public as $$
declare d jsonb; c jsonb; r jsonb; uname text := null;
begin
  p := coalesce(p, '{}'::jsonb);
  if btrim(coalesce(p->>'name', '')) = '' or btrim(coalesce(p->>'concern', '')) = ''
     or coalesce(p->>'date', '') = '' or coalesce(p->>'time', '') = '' or btrim(coalesce(p->>'phone', '')) = '' then
    return jsonb_build_object('error', 'Bitte alle Felder ausfüllen.', 'status', 400);
  end if;
  d := private.load();
  -- Login Pflicht: ohne gültiges Kundenkonto kein Termin
  select e into c from jsonb_array_elements(d->'customers') e where lower(e->>'username') = lower(coalesce(p_username, '')) limit 1;
  if c is null or c->>'passHash' is null or extensions.crypt(coalesce(p_password, ''), c->>'passHash') <> c->>'passHash' then
    return jsonb_build_object('error', 'Bitte logge dich ein, um einen Termin zu vereinbaren.', 'status', 401);
  end if;
  if coalesce((c->>'hasHausverbot')::boolean, false) then
    return jsonb_build_object('error', 'Für dieses Konto besteht ein Hausverbot.', 'status', 403);
  end if;
  uname := c->>'username';
  r := jsonb_build_object('id', private.now_id()::text, 'customerUsername', uname,
        'name', left(btrim(p->>'name'), 60), 'concern', left(btrim(p->>'concern'), 400),
        'date', left(p->>'date', 20), 'time', left(p->>'time', 10), 'phone', left(btrim(p->>'phone'), 40),
        'status', 'In Bearbeitung', 'timestamp', private.now_id());
  d := jsonb_set(d, '{appointments}', jsonb_build_array(r) || (d->'appointments'));
  perform private.save(d);
  return jsonb_build_object('success', true, 'appointment', r);
end $$;

-- Eigene Termine abrufen (Kundenkonto)
create or replace function public.api_my_appointments(p_username text, p_password text) returns jsonb
language plpgsql security definer set search_path = private, public as $$
declare d jsonb; c jsonb; k text := 'c:' || lower(coalesce(p_username, ''));
begin
  if private.is_locked(k) then
    return jsonb_build_object('error', 'Zu viele Versuche. Bitte 10 Minuten warten.', 'status', 429);
  end if;
  select data into d from private.state where id = 'main';
  select e into c from jsonb_array_elements(coalesce(d->'customers', '[]'::jsonb)) e
   where lower(e->>'username') = lower(coalesce(p_username, '')) limit 1;
  if c is null or c->>'passHash' is null or extensions.crypt(coalesce(p_password, ''), c->>'passHash') <> c->>'passHash' then
    perform private.add_fail(k);
    return jsonb_build_object('error', 'Bitte neu einloggen.', 'status', 401);
  end if;
  return jsonb_build_object('appointments', coalesce((
    select jsonb_agg(a order by (a->>'timestamp')::bigint desc)
    from jsonb_array_elements(coalesce(d->'appointments', '[]'::jsonb)) a
    where lower(a->>'customerUsername') = lower(c->>'username')), '[]'::jsonb));
end $$;

create or replace function public.api_staff_state(p_token text) returns jsonb
language plpgsql security definer set search_path = private, public as $$
declare m jsonb; d jsonb;
begin
  m := private.auth(p_token);
  if m is null then return jsonb_build_object('error', 'Nicht angemeldet', 'status', 401); end if;
  select data into d from private.state where id = 'main';
  d := coalesce(d, '{}'::jsonb);
  if not exists (select 1 from jsonb_array_elements(coalesce(d->'staff', '[]'::jsonb)) st where coalesce((st->>'onDuty')::boolean, false)) then
    d := jsonb_set(d, '{status,isOpen}', 'false'::jsonb);
    perform private.save(d);
  end if;
  return jsonb_build_object(
    'status', coalesce(d->'status', '{}'::jsonb),
    'roles', coalesce(d->'roles', '[]'::jsonb),
    'staff', private.staff_view(coalesce(d->'staff', '[]'::jsonb)),
    'menu', coalesce(d->'menu', '[]'::jsonb),
    'orders', coalesce(d->'orders', '[]'::jsonb),
    'reservations', coalesce(d->'reservations', '[]'::jsonb),
    'customers', private.customer_view(coalesce(d->'customers', '[]'::jsonb)),
    'vipApplications', coalesce(d->'vipApplications', '[]'::jsonb),
    'appointments', coalesce(d->'appointments', '[]'::jsonb),
    'news', coalesce(d->'news', '[]'::jsonb),
    'jobs', coalesce(d->'jobs', '[]'::jsonb),
    'discounts', coalesce(d->'discounts', '[]'::jsonb));
end $$;

create or replace function public.api_staff_do(p_token text, p_action text, p jsonb) returns jsonb
language plpgsql security definer set search_path = private, public as $$
declare
  m jsonb; d jsonb; mg boolean; res jsonb; e jsonb; nid text; tier text; patch jsonb; on_duty boolean;
begin
  m := private.auth(p_token);
  if m is null then return jsonb_build_object('error', 'Nicht angemeldet', 'status', 401); end if;
  d := private.load();
  mg := private.is_mgmt(m, d);
  p := coalesce(p, '{}'::jsonb);

  if p_action not in ('toggle', 'order_create', 'order_status', 'reservation_delete', 'shop_toggle') and not mg then
    return jsonb_build_object('error', 'Nur Führungsebene', 'status', 403);
  end if;

  case p_action
    when 'toggle' then
      if p->>'id' <> m->>'id' and not mg then
        return jsonb_build_object('error', 'Du kannst nur dich selbst einstempeln', 'status', 403);
      end if;
      e := private.arr_get(d->'staff', p->>'id');
      if e is not null then
        on_duty := not coalesce((e->>'onDuty')::boolean, false);
        d := jsonb_set(d, '{staff}', private.arr_patch(d->'staff', p->>'id',
              jsonb_build_object('onDuty', on_duty, 'clockIn', case when on_duty then private.hhmm() else '-' end)));
      end if;
      if not exists (select 1 from jsonb_array_elements(d->'staff') st where coalesce((st->>'onDuty')::boolean, false)) then
        d := jsonb_set(d, '{status,isOpen}', 'false'::jsonb);
      end if;
      res := private.staff_view(d->'staff');

    when 'shop_toggle' then
      if coalesce((d->'status'->>'isOpen')::boolean, false) = false
         and not exists (select 1 from jsonb_array_elements(d->'staff') st where coalesce((st->>'onDuty')::boolean, false)) then
        return jsonb_build_object('error', 'Der Laden kann erst geöffnet werden, wenn mindestens ein Mitarbeiter eingestempelt ist.', 'status', 409);
      end if;
      d := jsonb_set(d, '{status,isOpen}', to_jsonb(not coalesce((d->'status'->>'isOpen')::boolean, false)));
      res := d->'status';

    when 'order_create' then
      if jsonb_typeof(p->'items') <> 'array' then return jsonb_build_object('error', 'Ungültige Bestellung', 'status', 400); end if;
      res := jsonb_build_object('id', floor(1000 + random() * 9000)::int, 'staffId', m->'id',
              'customer', left(coalesce(nullif(p->>'customer', ''), 'Tisch / Laufkunde'), 60),
              'table', left(coalesce(nullif(p->>'table', ''), 'Abholung'), 60),
              'items', p->'items', 'total', coalesce((p->>'total')::numeric, 0),
              'status', 'In Zubereitung', 'time', private.hhmm(), 'timestamp', private.now_id());
      d := jsonb_set(d, '{orders}', jsonb_build_array(res) || (d->'orders'));

    when 'order_status' then
      d := jsonb_set(d, '{orders}', private.arr_patch(d->'orders', p->>'id', jsonb_build_object('status', left(p->>'status', 40))));
      res := d->'orders';

    when 'order_archive' then
      d := jsonb_set(d, '{orders}', private.arr_patch(d->'orders', p->>'id', jsonb_build_object('status', 'Archiviert')));
      res := d->'orders';

    when 'order_delete' then
      d := jsonb_set(d, '{orders}', private.arr_del(d->'orders', p->>'id'));
      res := d->'orders';

    when 'reservation_delete' then
      d := jsonb_set(d, '{reservations}', private.arr_del(d->'reservations', p->>'id'));
      res := d->'reservations';

    when 'status' then
      if coalesce((p->>'isOpen')::boolean, false) and not exists (select 1 from jsonb_array_elements(d->'staff') st where coalesce((st->>'onDuty')::boolean, false)) then
        return jsonb_build_object('error', 'Der Laden kann erst geöffnet werden, wenn mindestens ein Mitarbeiter eingestempelt ist.', 'status', 409);
      end if;
      patch := coalesce((select jsonb_object_agg(k, v) from jsonb_each(p) t(k, v)
                          where k in ('isOpen', 'workload', 'discordWebhook', 'discordInvite', 'applicationsOpen')), '{}'::jsonb);
      d := jsonb_set(d, '{status}', coalesce(d->'status', '{}'::jsonb) || patch);
      res := d->'status';

    when 'customer_update' then
      e := private.arr_get(d->'customers', p->>'id');
      if e is not null then
        tier := coalesce(p->>'vipStatus', e->>'vipStatus');
        patch := jsonb_build_object('vipStatus', tier,
                  'isStammkunde', coalesce((p->>'isStammkunde')::boolean, (e->>'isStammkunde')::boolean, false),
                  'hasHausverbot', coalesce((p->>'hasHausverbot')::boolean, (e->>'hasHausverbot')::boolean, false),
                  'discount', private.discount_of(tier));
        d := jsonb_set(d, '{customers}', private.arr_patch(d->'customers', p->>'id', patch));
      end if;
      res := private.customer_view(d->'customers');

    when 'customer_delete' then
      if private.arr_get(d->'customers', p->>'id') is null then
        return jsonb_build_object('error', 'Kundenkonto wurde nicht gefunden oder bereits gelöscht.', 'status', 404);
      end if;
      d := jsonb_set(d, '{customers}', private.arr_del(d->'customers', p->>'id'));
      res := private.customer_view(d->'customers');

    when 'vip_action' then
      e := private.arr_get(d->'vipApplications', p->>'id');
      if e is not null then
        d := jsonb_set(d, '{vipApplications}', private.arr_patch(d->'vipApplications', p->>'id',
              jsonb_build_object('status', left(p->>'action', 30))));
        if p->>'action' = 'Akzeptiert' then
          d := jsonb_set(d, '{customers}', (
            select coalesce(jsonb_agg(case when lower(c->>'username') = lower(e->>'username')
                   then c || jsonb_build_object('vipStatus', e->>'tier', 'discount', private.discount_of(e->>'tier')) else c end order by o), '[]'::jsonb)
            from jsonb_array_elements(d->'customers') with ordinality t(c, o)));
        end if;
      end if;
      res := d->'vipApplications';

    when 'vip_delete' then
      e := private.arr_get(d->'vipApplications', p->>'id');
      if e is null then
        return jsonb_build_object('error', 'Antrag nicht gefunden oder bereits gelöscht.', 'status', 404);
      end if;
      if e->>'status' <> 'Abgelehnt' then
        return jsonb_build_object('error', 'Es können nur abgelehnte Anträge gelöscht werden.', 'status', 409);
      end if;
      d := jsonb_set(d, '{vipApplications}', private.arr_del(d->'vipApplications', p->>'id'));
      res := d->'vipApplications';

    when 'vip_delete_rejected' then
      d := jsonb_set(d, '{vipApplications}', (
        select coalesce(jsonb_agg(a order by o), '[]'::jsonb)
        from jsonb_array_elements(d->'vipApplications') with ordinality t(a, o)
        where a->>'status' <> 'Abgelehnt'));
      res := d->'vipApplications';

    when 'appointment_action' then
      e := private.arr_get(d->'appointments', p->>'id');
      if e is null then
        return jsonb_build_object('error', 'Termin nicht gefunden.', 'status', 404);
      end if;
      if p->>'action' not in ('Akzeptiert', 'Abgelehnt', 'Verschoben', 'In Bearbeitung') then
        return jsonb_build_object('error', 'Ungültiger Status', 'status', 400);
      end if;
      patch := jsonb_build_object('status', p->>'action', 'updatedAt', private.now_id());
      if p->>'action' = 'Verschoben' then
        if coalesce(p->>'date', '') = '' or coalesce(p->>'time', '') = '' then
          return jsonb_build_object('error', 'Neues Datum und neue Uhrzeit angeben.', 'status', 400);
        end if;
        patch := patch || jsonb_build_object(
          'date', left(p->>'date', 20), 'time', left(p->>'time', 10),
          'origDate', coalesce(e->>'origDate', e->>'date'), 'origTime', coalesce(e->>'origTime', e->>'time'));
      end if;
      d := jsonb_set(d, '{appointments}', private.arr_patch(d->'appointments', p->>'id', patch));
      res := d->'appointments';

    when 'appointment_delete' then
      d := jsonb_set(d, '{appointments}', private.arr_del(d->'appointments', p->>'id'));
      res := d->'appointments';

    when 'role_add' then
      d := jsonb_set(d, '{roles}', d->'roles' || jsonb_build_array(jsonb_build_object(
            'id', private.now_id(), 'name', left(p->>'name', 40),
            'isManagement', coalesce((p->>'isManagement')::boolean, false),
            'color', coalesce(nullif(p->>'color', ''), '#c82333'))));
      res := d->'roles';

    when 'role_delete' then
      d := jsonb_set(d, '{roles}', private.arr_del(d->'roles', p->>'id'));
      res := d->'roles';

    when 'staff_add' then
      if length(coalesce(p->>'pin', '1234')) < 4 then return jsonb_build_object('error', 'PIN zu kurz', 'status', 400); end if;
      d := jsonb_set(d, '{staff}', d->'staff' || jsonb_build_array(jsonb_build_object(
            'id', private.now_id(), 'name', left(p->>'name', 40), 'role', p->>'role',
            'pinHash', extensions.crypt(coalesce(nullif(p->>'pin', ''), '1234'), extensions.gen_salt('bf')),
            'avatar', coalesce(nullif(p->>'avatar', ''), 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80'),
            'onDuty', false, 'clockIn', '-')));
      res := private.staff_view(d->'staff');

    when 'staff_update' then
      patch := coalesce((select jsonb_object_agg(k, v) from jsonb_each(p) t(k, v)
                          where k in ('name', 'role', 'avatar')), '{}'::jsonb);
      if p ? 'pin' then
        if length(coalesce(p->>'pin', '')) < 4 then return jsonb_build_object('error', 'PIN zu kurz', 'status', 400); end if;
        patch := patch || jsonb_build_object('pinHash', extensions.crypt(p->>'pin', extensions.gen_salt('bf')));
      end if;
      d := jsonb_set(d, '{staff}', private.arr_patch(d->'staff', p->>'id', patch));
      res := private.staff_view(d->'staff');

    when 'staff_delete' then
      d := jsonb_set(d, '{staff}', private.arr_del(d->'staff', p->>'id'));
      delete from private.sessions where staff_id = p->>'id';
      res := private.staff_view(d->'staff');

    when 'discount_add' then
      if btrim(coalesce(p->>'code', '')) = '' then
        return jsonb_build_object('error', 'Bitte einen Code angeben.', 'status', 400);
      end if;
      d := jsonb_set(d, '{discounts}', coalesce(d->'discounts', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
            'id', private.now_id()::text, 'code', left(btrim(p->>'code'), 30), 'name', left(coalesce(p->>'name', ''), 120),
            'group', left(coalesce(nullif(btrim(p->>'group'), ''), 'Sonstiges'), 40))));
      res := d->'discounts';

    when 'discount_update' then
      patch := jsonb_build_object('code', left(btrim(coalesce(p->>'code', '')), 30), 'name', left(coalesce(p->>'name', ''), 120),
                                  'group', left(coalesce(nullif(btrim(p->>'group'), ''), 'Sonstiges'), 40));
      d := jsonb_set(d, '{discounts}', private.arr_patch(d->'discounts', p->>'id', patch));
      res := d->'discounts';

    when 'discount_delete' then
      d := jsonb_set(d, '{discounts}', private.arr_del(d->'discounts', p->>'id'));
      res := d->'discounts';

    when 'news_add' then
      if btrim(coalesce(p->>'title', '')) = '' then
        return jsonb_build_object('error', 'Bitte einen Titel angeben.', 'status', 400);
      end if;
      d := jsonb_set(d, '{news}', jsonb_build_array(jsonb_build_object(
            'id', private.now_id()::text, 'createdAt', private.now_id(), 'title', left(btrim(p->>'title'), 120),
            'text', left(coalesce(p->>'text', ''), 1500), 'pinned', coalesce((p->>'pinned')::boolean, false))) || coalesce(d->'news', '[]'::jsonb));
      res := d->'news';

    when 'news_update' then
      patch := jsonb_build_object('title', left(btrim(coalesce(p->>'title', '')), 120), 'text', left(coalesce(p->>'text', ''), 1500),
                                  'pinned', coalesce((p->>'pinned')::boolean, false));
      d := jsonb_set(d, '{news}', private.arr_patch(d->'news', p->>'id', patch));
      res := d->'news';

    when 'news_delete' then
      d := jsonb_set(d, '{news}', private.arr_del(d->'news', p->>'id'));
      res := d->'news';

    when 'job_add' then
      if btrim(coalesce(p->>'title', '')) = '' then
        return jsonb_build_object('error', 'Bitte eine Stellenbezeichnung angeben.', 'status', 400);
      end if;
      d := jsonb_set(d, '{jobs}', coalesce(d->'jobs', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
            'id', private.now_id()::text, 'title', left(btrim(p->>'title'), 80), 'type', left(coalesce(p->>'type', ''), 40),
            'description', left(coalesce(p->>'description', ''), 800), 'requirements', left(coalesce(p->>'requirements', ''), 800))));
      res := d->'jobs';

    when 'job_update' then
      patch := jsonb_build_object('title', left(btrim(coalesce(p->>'title', '')), 80), 'type', left(coalesce(p->>'type', ''), 40),
                                  'description', left(coalesce(p->>'description', ''), 800), 'requirements', left(coalesce(p->>'requirements', ''), 800));
      d := jsonb_set(d, '{jobs}', private.arr_patch(d->'jobs', p->>'id', patch));
      res := d->'jobs';

    when 'job_delete' then
      d := jsonb_set(d, '{jobs}', private.arr_del(d->'jobs', p->>'id'));
      res := d->'jobs';

    when 'menu_add' then
      d := jsonb_set(d, '{menu}', d->'menu' || jsonb_build_array(jsonb_build_object(
            'id', private.now_id(), 'category', left(p->>'category', 40), 'name', left(p->>'name', 80),
            'desc', left(coalesce(p->>'desc', ''), 300), 'price', coalesce((p->>'price')::numeric, 0))));
      res := d->'menu';

    when 'menu_update' then
      patch := coalesce((select jsonb_object_agg(k, v) from jsonb_each(p) t(k, v)
                          where k in ('name', 'category', 'desc')), '{}'::jsonb);
      if p ? 'price' then patch := patch || jsonb_build_object('price', (p->>'price')::numeric); end if;
      d := jsonb_set(d, '{menu}', private.arr_patch(d->'menu', p->>'id', patch));
      res := d->'menu';

    when 'menu_delete' then
      d := jsonb_set(d, '{menu}', private.arr_del(d->'menu', p->>'id'));
      res := d->'menu';

    else
      return jsonb_build_object('error', 'Unbekannte Aktion', 'status', 400);
  end case;

  perform private.save(d);
  return res;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'api_appointment_create(text,text,jsonb)', 'api_place_reservation(jsonb)', 'api_taken_tables(text,text)', 'api_public_state()', 'api_my_appointments(text,text)',
    'api_staff_state(text)', 'api_staff_do(text,text,jsonb)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;

-- Startliste Rabattcodes (nur einmalig, solange noch keine Liste existiert)
update private.state
   set data = jsonb_set(data, '{discounts}', '[{"id": "d1", "code": "Craft", "name": "CCM", "group": "Firmen"}, {"id": "d2", "code": "NL", "name": "NextLevel", "group": "Firmen"}, {"id": "d3", "code": "RKO", "name": "Mitarbeiter (Soul Sushi Intern)", "group": "Firmen"}, {"id": "d4", "code": "JS", "name": "Justiz", "group": "Firmen"}, {"id": "d5", "code": "AN", "name": "ANRW", "group": "Firmen"}, {"id": "d6", "code": "LM", "name": "Lost MC", "group": "Firmen"}, {"id": "d7", "code": "VAS", "name": "Vagos", "group": "Firmen"}, {"id": "d8", "code": "SUSM", "name": "Smokeys", "group": "Firmen"}, {"id": "d9", "code": "SCOP", "name": "Scorpions", "group": "Firmen"}, {"id": "d10", "code": "BEFE", "name": "Berufsfeuerwehr", "group": "Firmen"}, {"id": "d11", "code": "BEDO", "name": "Belladonnas", "group": "Firmen"}, {"id": "d12", "code": "ELDO", "name": "Eldorado", "group": "Firmen"}, {"id": "d13", "code": "TAKO", "name": "Taxi Köln", "group": "Firmen"}, {"id": "d14", "code": "BLPY", "name": "Black Pytons", "group": "Firmen"}, {"id": "d15", "code": "BURH", "name": "Burger House", "group": "Firmen"}, {"id": "d16", "code": "UKK", "name": "UnfallKlinikum Köln", "group": "Firmen"}, {"id": "d17", "code": "BP", "name": "Blue Pearl", "group": "Firmen"}, {"id": "d18", "code": "DOPPEL", "name": "ab 150 Essen / Trinken", "group": "Großbestellungen"}, {"id": "d19", "code": "MAXI", "name": "ab 250 Essen / Trinken", "group": "Großbestellungen"}, {"id": "d20", "code": "ULTRA", "name": "ab 500 Essen / Trinken", "group": "Großbestellungen"}, {"id": "d21", "code": "SALE", "name": "20 % Rabatt", "group": "Aktionen"}, {"id": "d22", "code": "MISA", "name": "25 % · Mittwoch und Samstag, 20–24 Uhr", "group": "Aktionen"}]'::jsonb)
 where id = 'main' and data->'discounts' is null;

commit;

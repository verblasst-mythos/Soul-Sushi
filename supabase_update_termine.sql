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
  foreach k in array array['roles','staff','menu','orders','reservations','customers','vipApplications','appointments'] loop
    if d->k is null then d := jsonb_set(d, array[k], '[]'::jsonb); end if;
  end loop;
  return d;
end $$;

-- Termin anfragen (Gast oder eingeloggter Kunde)
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
  if coalesce(p_username, '') <> '' then
    select e into c from jsonb_array_elements(d->'customers') e where lower(e->>'username') = lower(p_username) limit 1;
    if c is not null and c->>'passHash' is not null and extensions.crypt(coalesce(p_password, ''), c->>'passHash') = c->>'passHash' then
      if coalesce((c->>'hasHausverbot')::boolean, false) then
        return jsonb_build_object('error', 'Für dieses Konto besteht ein Hausverbot.', 'status', 403);
      end if;
      uname := c->>'username';
    end if;
  end if;
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
    'appointments', coalesce(d->'appointments', '[]'::jsonb));
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
                          where k in ('isOpen', 'workload', 'discordWebhook', 'discordInvite')), '{}'::jsonb);
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
      if p->>'action' not in ('Angenommen', 'Abgelehnt', 'Verschoben', 'In Bearbeitung') then
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
    'api_appointment_create(text,text,jsonb)', 'api_my_appointments(text,text)',
    'api_staff_state(text)', 'api_staff_do(text,text,jsonb)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;

commit;

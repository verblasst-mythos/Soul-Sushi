-- ============================================================================
-- Soul Sushi – sichere Supabase-Einrichtung
-- Supabase Dashboard -> SQL Editor -> New query -> alles einfügen -> Run
--
-- Sicherheitskonzept:
--  * Alle Daten liegen in Tabellen im Schema "private" -> von außen nicht erreichbar.
--  * Die Webseite darf nur die api_*-Funktionen unten aufrufen.
--  * Kundenpasswörter und Mitarbeiter-PINs werden als bcrypt-Hash gespeichert
--    und niemals ausgegeben.
--  * Verwaltung nur mit Mitarbeiter-Login (Token, 12 h gültig).
--  * Login-Sperre: 6 Fehlversuche -> 10 Minuten gesperrt.
-- ============================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

-- Alte, unsichere Tabelle aus der ersten Version entfernen (falls vorhanden)
drop table if exists public.app_state;

create table if not exists private.state (
  id   text primary key,
  data jsonb not null
);
create table if not exists private.sessions (
  token      text primary key,
  staff_id   text not null,
  created_at timestamptz not null default now()
);
create table if not exists private.attempts (
  key text not null,
  at  timestamptz not null default now()
);
create index if not exists attempts_key_at on private.attempts (key, at);

alter table private.state    enable row level security;
alter table private.sessions enable row level security;
alter table private.attempts enable row level security;
revoke all on schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

-- ---------------------------------------------------------------- Hilfsfunktionen

create or replace function private.load() returns jsonb
language plpgsql as $$
declare d jsonb; k text;
begin
  select data into d from private.state where id = 'main' for update;
  if d is null then
    d := jsonb_build_object('status', '{"isOpen":true,"workload":"Niedrig","discordWebhook":""}'::jsonb);
  end if;
  foreach k in array array['roles','staff','menu','orders','reservations','customers','vipApplications'] loop
    if d->k is null then d := jsonb_set(d, array[k], '[]'::jsonb); end if;
  end loop;
  return d;
end $$;

create or replace function private.save(d jsonb) returns void
language sql as $$
  insert into private.state (id, data) values ('main', d)
  on conflict (id) do update set data = excluded.data;
$$;

create or replace function private.arr_get(arr jsonb, p_id text) returns jsonb
language sql stable as $$
  select e from jsonb_array_elements(arr) e where e->>'id' = p_id limit 1;
$$;

create or replace function private.arr_patch(arr jsonb, p_id text, patch jsonb) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(case when e->>'id' = p_id then e || patch else e end order by o), '[]'::jsonb)
  from jsonb_array_elements(arr) with ordinality t(e, o);
$$;

create or replace function private.arr_del(arr jsonb, p_id text) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(e order by o), '[]'::jsonb)
  from jsonb_array_elements(arr) with ordinality t(e, o) where e->>'id' <> p_id;
$$;

create or replace function private.now_id() returns bigint
language sql as $$ select (extract(epoch from clock_timestamp()) * 1000)::bigint $$;

create or replace function private.hhmm() returns text
language sql as $$ select to_char(now() at time zone 'Europe/Berlin', 'HH24:MI') $$;

-- Sichten ohne Geheimnisse
create or replace function private.staff_public(arr jsonb) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', e->'id', 'name', e->'name', 'role', e->'role',
         'avatar', e->'avatar', 'onDuty', e->'onDuty', 'clockIn', e->'clockIn') order by o), '[]'::jsonb)
  from jsonb_array_elements(arr) with ordinality t(e, o);
$$;

create or replace function private.staff_view(arr jsonb) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(e - 'pin' - 'pinHash' order by o), '[]'::jsonb)
  from jsonb_array_elements(arr) with ordinality t(e, o);
$$;

create or replace function private.customer_view(arr jsonb) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(e - 'password' - 'passHash' order by o), '[]'::jsonb)
  from jsonb_array_elements(arr) with ordinality t(e, o);
$$;

-- Login-Sperre
create or replace function private.is_locked(p_key text) returns boolean
language sql as $$
  select count(*) >= 6 from private.attempts where key = p_key and at > now() - interval '10 minutes'
$$;
create or replace function private.add_fail(p_key text) returns void
language sql as $$
  delete from private.attempts where at < now() - interval '1 day';
  insert into private.attempts (key) values (p_key);
$$;

-- Token -> Mitarbeiter (oder null)
create or replace function private.auth(p_token text) returns jsonb
language plpgsql as $$
declare sid text; m jsonb;
begin
  if p_token is null then return null; end if;
  select staff_id into sid from private.sessions
   where token = p_token and created_at > now() - interval '12 hours';
  if sid is null then return null; end if;
  select e into m from private.state s, jsonb_array_elements(s.data->'staff') e
   where s.id = 'main' and e->>'id' = sid limit 1;
  return m;
end $$;

create or replace function private.is_mgmt(m jsonb, d jsonb) returns boolean
language sql stable as $$
  select (m->>'role') in ('Geschäftsführung', 'Manager', 'Serviceleitung')
      or exists (select 1 from jsonb_array_elements(d->'roles') r
                  where r->>'name' = m->>'role' and coalesce((r->>'isManagement')::boolean, false))
$$;

create or replace function private.discount_of(tier text) returns int
language sql immutable as $$
  select case tier when 'Silver VIP' then 5 when 'Gold VIP' then 10 when 'Black VIP' then 15 else 0 end
$$;

-- ---------------------------------------------------------------- ÖFFENTLICHE API

create or replace function public.api_public_state() returns jsonb
language plpgsql security definer set search_path = private, public as $$
declare d jsonb;
begin
  select data into d from private.state where id = 'main';
  d := coalesce(d, '{}'::jsonb);
  return jsonb_build_object(
    'status',  jsonb_build_object('isOpen', coalesce(d->'status'->'isOpen', 'true'::jsonb),
                                  'workload', coalesce(d->'status'->'workload', '"Niedrig"'::jsonb),
                                  'discordInvite', coalesce(d->'status'->'discordInvite', '""'::jsonb)),
    'roles',   coalesce(d->'roles', '[]'::jsonb),
    'staff',   private.staff_public(coalesce(d->'staff', '[]'::jsonb)),
    'menu',    coalesce(d->'menu', '[]'::jsonb),
    'orders', '[]'::jsonb, 'reservations', '[]'::jsonb, 'customers', '[]'::jsonb, 'vipApplications', '[]'::jsonb);
end $$;

create or replace function public.api_customer_register(p_username text, p_password text) returns jsonb
language plpgsql security definer set search_path = private, public as $$
declare d jsonb; c jsonb; u text := btrim(coalesce(p_username, ''));
begin
  if u = '' or coalesce(p_password, '') = '' then
    return jsonb_build_object('error', 'Benutzername und Passwort erforderlich', 'status', 400);
  end if;
  if length(u) > 30 or length(p_password) > 100 then
    return jsonb_build_object('error', 'Benutzername oder Passwort zu lang', 'status', 400);
  end if;
  if length(p_password) < 4 then
    return jsonb_build_object('error', 'Passwort muss mindestens 4 Zeichen haben', 'status', 400);
  end if;
  d := private.load();
  if exists (select 1 from jsonb_array_elements(d->'customers') e where lower(e->>'username') = lower(u)) then
    return jsonb_build_object('error', 'Benutzername bereits vergeben', 'status', 400);
  end if;
  c := jsonb_build_object('id', private.now_id(), 'username', u,
        'passHash', extensions.crypt(p_password, extensions.gen_salt('bf')),
        'vipStatus', 'Kein', 'isStammkunde', false, 'hasHausverbot', false, 'discount', 0);
  d := jsonb_set(d, '{customers}', d->'customers' || jsonb_build_array(c));
  perform private.save(d);
  return jsonb_build_object('success', true, 'customer', c - 'passHash');
end $$;

create or replace function public.api_customer_login(p_username text, p_password text) returns jsonb
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
    return jsonb_build_object('error', 'Ungültiger Benutzername oder Passwort', 'status', 401);
  end if;
  delete from private.attempts where key = k;
  return jsonb_build_object('success', true, 'customer', c - 'passHash');
end $$;

create or replace function public.api_place_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = private, public as $$
declare d jsonb; o jsonb;
begin
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 or jsonb_array_length(p->'items') > 100 then
    return jsonb_build_object('error', 'Ungültige Bestellung', 'status', 400);
  end if;
  d := private.load();
  o := jsonb_build_object('id', floor(1000 + random() * 9000)::int, 'staffId', null,
        'customer', left(coalesce(nullif(p->>'customer', ''), 'Tisch / Laufkunde'), 60),
        'table', left(coalesce(nullif(p->>'table', ''), 'Abholung'), 60),
        'items', p->'items', 'total', coalesce((p->>'total')::numeric, 0),
        'status', 'In Zubereitung', 'time', private.hhmm(), 'timestamp', private.now_id());
  d := jsonb_set(d, '{orders}', jsonb_build_array(o) || (d->'orders'));
  perform private.save(d);
  return o;
end $$;

create or replace function public.api_place_reservation(p jsonb) returns jsonb
language plpgsql security definer set search_path = private, public as $$
declare d jsonb; r jsonb;
begin
  d := private.load();
  r := jsonb_build_object('id', private.now_id()::text, 'name', left(coalesce(p->>'name', ''), 60),
        'guests', coalesce((p->>'guests')::int, 1), 'date', left(coalesce(p->>'date', ''), 40),
        'time', left(coalesce(p->>'time', ''), 20), 'type', left(coalesce(p->>'type', ''), 40),
        'status', 'Bestätigt');
  d := jsonb_set(d, '{reservations}', jsonb_build_array(r) || (d->'reservations'));
  perform private.save(d);
  return r;
end $$;

create or replace function public.api_vip_apply(p_username text, p_phone text, p_tier text) returns jsonb
language plpgsql security definer set search_path = private, public as $$
declare d jsonb; a jsonb;
begin
  if coalesce(p_username, '') = '' or coalesce(p_phone, '') = '' or p_tier not in ('Silver VIP', 'Gold VIP', 'Black VIP') then
    return jsonb_build_object('error', 'Fehlende Angaben', 'status', 400);
  end if;
  d := private.load();
  a := jsonb_build_object('id', private.now_id()::text, 'username', left(p_username, 30),
        'phone', left(p_phone, 40), 'tier', p_tier, 'status', 'Ausstehend', 'timestamp', private.now_id());
  d := jsonb_set(d, '{vipApplications}', jsonb_build_array(a) || (d->'vipApplications'));
  perform private.save(d);
  return jsonb_build_object('success', true, 'application', a);
end $$;

-- ---------------------------------------------------------------- MITARBEITER-API

create or replace function public.api_staff_login(p_name text, p_pin text) returns jsonb
language plpgsql security definer set search_path = private, public as $$
declare d jsonb; m jsonb; t text; k text := 's:' || lower(coalesce(p_name, ''));
begin
  if private.is_locked(k) then
    return jsonb_build_object('error', 'Zu viele Versuche. Bitte 10 Minuten warten.', 'status', 429);
  end if;
  select data into d from private.state where id = 'main';
  select e into m from jsonb_array_elements(coalesce(d->'staff', '[]'::jsonb)) e
   where lower(e->>'name') = lower(btrim(coalesce(p_name, ''))) limit 1;
  if m is null then
    perform private.add_fail(k);
    return jsonb_build_object('error', 'Mitarbeiter nicht gefunden', 'status', 401);
  end if;
  if m->>'pinHash' is null or extensions.crypt(coalesce(p_pin, ''), m->>'pinHash') <> m->>'pinHash' then
    perform private.add_fail(k);
    return jsonb_build_object('error', 'Falscher PIN für ' || (m->>'name'), 'status', 401);
  end if;
  delete from private.attempts where key = k;
  delete from private.sessions where created_at < now() - interval '1 day';
  t := encode(extensions.gen_random_bytes(24), 'hex');
  insert into private.sessions (token, staff_id) values (t, m->>'id');
  return jsonb_build_object('success', true, 'token', t, 'member', m - 'pin' - 'pinHash');
end $$;

create or replace function public.api_staff_logout(p_token text) returns jsonb
language plpgsql security definer set search_path = private, public as $$
begin
  delete from private.sessions where token = p_token;
  return jsonb_build_object('success', true);
end $$;

create or replace function public.api_staff_state(p_token text) returns jsonb
language plpgsql security definer set search_path = private, public as $$
declare m jsonb; d jsonb;
begin
  m := private.auth(p_token);
  if m is null then return jsonb_build_object('error', 'Nicht angemeldet', 'status', 401); end if;
  select data into d from private.state where id = 'main';
  d := coalesce(d, '{}'::jsonb);
  return jsonb_build_object(
    'status', coalesce(d->'status', '{}'::jsonb),
    'roles', coalesce(d->'roles', '[]'::jsonb),
    'staff', private.staff_view(coalesce(d->'staff', '[]'::jsonb)),
    'menu', coalesce(d->'menu', '[]'::jsonb),
    'orders', coalesce(d->'orders', '[]'::jsonb),
    'reservations', coalesce(d->'reservations', '[]'::jsonb),
    'customers', private.customer_view(coalesce(d->'customers', '[]'::jsonb)),
    'vipApplications', coalesce(d->'vipApplications', '[]'::jsonb));
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

  if p_action not in ('toggle', 'order_create', 'order_status', 'reservation_delete') and not mg then
    return jsonb_build_object('error', 'Nur Führungsebene', 'status', 403);
  end if;

  case p_action
    when 'toggle' then
      e := private.arr_get(d->'staff', p->>'id');
      if e is not null then
        on_duty := not coalesce((e->>'onDuty')::boolean, false);
        d := jsonb_set(d, '{staff}', private.arr_patch(d->'staff', p->>'id',
              jsonb_build_object('onDuty', on_duty, 'clockIn', case when on_duty then private.hhmm() else '-' end)));
      end if;
      res := private.staff_view(d->'staff');

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

-- ---------------------------------------------------------------- RECHTE
do $$
declare f text;
begin
  foreach f in array array[
    'api_public_state()', 'api_customer_register(text,text)', 'api_customer_login(text,text)',
    'api_place_order(jsonb)', 'api_place_reservation(jsonb)', 'api_vip_apply(text,text,text)',
    'api_staff_login(text,text)', 'api_staff_logout(text)', 'api_staff_state(text)',
    'api_staff_do(text,text,jsonb)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------- STARTDATEN
-- Speisekarte, Personal (Owner / PIN 0903), Rollen, ... – nur beim ersten Mal.
-- Klartext-PINs/-Passwörter werden direkt danach gehasht.
insert into private.state (id, data)
values ('main', $json${"status": {"isOpen": true, "workload": "Niedrig", "discordWebhook": ""}, "roles": [{"id": 1, "name": "Geschäftsführung", "isManagement": true, "color": "#d4af37"}, {"id": 2, "name": "Manager", "isManagement": true, "color": "#c82333"}, {"id": 1794841924045, "name": "Serviceleitung", "isManagement": true, "color": "#5900ff"}, {"id": 1794841932999, "name": "Koch", "isManagement": false, "color": "#ffae00"}, {"id": 1794841937827, "name": "Kellner", "isManagement": false, "color": "#ffae00"}, {"id": 1794841944048, "name": "Azubi", "isManagement": false, "color": "#2c1f02"}], "staff": [{"id": 1, "name": "Kai Mueller", "role": "Geschäftsführung", "pin": "9999", "avatar": "https://cdn.discordapp.com/attachments/1550910503348346981/1571553979874148443/image.png?ex=6afbcff2&is=6afa7e72&hm=7583c516ce66915448db61b00ee78f41c9e27708df2d8cd43516901652461c7a&", "onDuty": false, "clockIn": "-"}, {"id": 1794842283373, "name": "Eray Drewer", "role": "Geschäftsführung", "pin": "1111", "avatar": "file:///C:/Users/noahk/OneDrive/Bilder/Screenshots%201/Screenshot%202026-11-16%20174450.png", "onDuty": false, "clockIn": "-"}, {"id": 1794860000001, "name": "Owner", "role": "Geschäftsführung", "pin": "0903", "avatar": "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80", "onDuty": false, "clockIn": "-"}], "menu": [{"id": 1794842394790, "category": "Sushi", "name": "Frittiertes Sushi", "desc": "Alle Sorten frittiert", "price": 210}, {"id": 1794842409004, "category": "Sushi", "name": "Maki Sushi", "desc": "Lachs", "price": 200}, {"id": 1794842426397, "category": "Sushi", "name": "Sashimi Sushi", "desc": "Tintenfisch", "price": 190}, {"id": 1794850000001, "category": "Sushi", "name": "Nigiri Sushi", "desc": "Roher Thunfisch oder Makrele", "price": 200}, {"id": 1794842441158, "category": "Sushi", "name": "Chirashi Sushi", "desc": "Fisch + Gemüse + Pilze", "price": 200}, {"id": 1794842457307, "category": "Hauptspeisen", "name": "Soul Bowl", "desc": "Teriyaki: Mariniertes Fleisch + Toppings", "price": 210}, {"id": 1794842466910, "category": "Hauptspeisen", "name": "Ramen", "desc": "Nudelsuppe mit kräftiger Brühe", "price": 210}, {"id": 1794842488988, "category": "Hauptspeisen", "name": "Hühnchennudeln", "desc": "", "price": 210}, {"id": 1794842499691, "category": "Hauptspeisen", "name": "Gebratene Ente", "desc": "Mit Reis", "price": 190}, {"id": 1794842518498, "category": "Getränke", "name": "Grüntee", "desc": "", "price": 200}, {"id": 1794842528002, "category": "Getränke", "name": "Tequila", "desc": "", "price": 290}, {"id": 1794842541240, "category": "Getränke", "name": "Bananensaft", "desc": "", "price": 175}, {"id": 1794842549655, "category": "Getränke", "name": "Soul Matcha", "desc": "Frisch & eiskalt", "price": 250}, {"id": 1794842556623, "category": "Getränke", "name": "Cola", "desc": "", "price": 160}, {"id": 1794842594431, "category": "Nachspeise", "name": "Schokoerdbeeren", "desc": "", "price": 170}, {"id": 1794842603762, "category": "Nachspeise", "name": "Mochi", "desc": "Klebreisbällchen + süße Füllung", "price": 170}, {"id": 1794842675317, "category": "Nachspeise", "name": "SushiPlatte", "desc": "10 Chirashi, 10 Nigiri, 10 Maki, 10 Sashimi, 10 Frittierte, 5 Soul Bowl, 10 Matcha, 5 Mochis, 5 Schokoerdbeeren", "price": 15000}, {"id": 1794850000002, "category": "Halloween Spezial", "name": "Witch Kiss", "desc": "", "price": 200}, {"id": 1794850000003, "category": "Halloween Spezial", "name": "Pumpkin Spice Latte", "desc": "", "price": 180}], "orders": [{"id": 7051, "staffId": null, "customer": "Online Kunde", "table": "Lieferung / Abholung", "items": [{"id": 1794842409004, "category": "Sushi", "name": "Maki Sushi", "desc": "Sushi", "price": 200, "qty": 4}], "total": 800, "status": "Fertig", "time": "17:04", "timestamp": 1794845080229}, {"id": 8999, "customer": "Kai Mueller", "table": "Tisch 4", "items": [{"id": 1794842675317, "category": "Menü", "name": "SushiPlatte", "desc": "10 Chirachi Sushi 10 Nigiri Sushi 10 Maki sushi 10 sashimi sushi 10 Frittierte sushi 5 soul bowl 10 matcha 5 mochi 5 schokoerdbeeren", "price": 15000, "qty": 1}, {"id": 1794842603762, "category": "Dessert", "name": "Mochi", "desc": "Dessert", "price": 170, "qty": 1}, {"id": 1794842541240, "category": "Getränke", "name": "Bananensaft", "desc": "Getränke", "price": 175, "qty": 1}, {"id": 1794842488988, "category": "Hauptspeisen", "name": "Hünchen Nudeln", "desc": "Hauptspeisen", "price": 210, "qty": 1}], "total": 15555, "status": "Fertig", "time": "16:36"}, {"id": 8989, "customer": "POS Direkt", "table": "Tisch 4", "items": [{"id": 1794842441158, "category": "Sushi", "name": "Chirashi Sushi", "desc": "Sushi", "price": 200, "qty": 1}, {"id": 1794842499691, "category": "Hauptspeisen", "name": "Gebratene Ente Mit reis", "desc": "Hauptspeisen", "price": 190, "qty": 1}, {"id": 1794842549655, "category": "Getränke", "name": "Soul Matcha", "desc": "Getränke", "price": 250, "qty": 1}], "total": 640, "status": "Fertig", "time": "16:32"}], "reservations": [], "customers": [{"id": 1794845628366, "username": "Kai Mueller", "password": "Southfork1505", "vipStatus": "Black VIP", "isStammkunde": true, "discount": 15}, {"id": 1794846671881, "username": "test1", "password": "test^1", "vipStatus": "Kein", "isStammkunde": false, "hasHausverbot": false, "discount": 0}, {"id": 1794847004294, "username": "test12", "password": "test12", "vipStatus": "Kein", "isStammkunde": false, "hasHausverbot": false, "discount": 0}], "vipApplications": [{"id": "1794847379379", "username": "test1", "phone": "11111", "tier": "Black VIP", "status": "Abgelehnt", "timestamp": 1794847379379}, {"id": "1794847376233", "username": "test1", "phone": "11111", "tier": "Silver VIP", "status": "Abgelehnt", "timestamp": 1794847376233}, {"id": "1794847373415", "username": "test1", "phone": "11111", "tier": "Gold VIP", "status": "Abgelehnt", "timestamp": 1794847373415}, {"id": "1794847240309", "username": "test1", "phone": "256", "tier": "Black VIP", "status": "Abgelehnt", "timestamp": 1794847240309}]}$json$::jsonb)
on conflict (id) do nothing;

update private.state set data = jsonb_set(jsonb_set(data, '{staff}', (
    select coalesce(jsonb_agg(case when e ? 'pin'
      then (e - 'pin') || jsonb_build_object('pinHash', extensions.crypt(e->>'pin', extensions.gen_salt('bf')))
      else e end order by o), '[]'::jsonb)
    from jsonb_array_elements(data->'staff') with ordinality t(e, o))),
  '{customers}', (
    select coalesce(jsonb_agg(case when e ? 'password'
      then (e - 'password') || jsonb_build_object('passHash', extensions.crypt(e->>'password', extensions.gen_salt('bf')))
      else e end order by o), '[]'::jsonb)
    from jsonb_array_elements(data->'customers') with ordinality t(e, o)))
where id = 'main';

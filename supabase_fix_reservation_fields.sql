-- Soul Sushi – Fix: Telefonnummer, Anmerkungen und Tischwahl werden bei Reservierungen gespeichert
-- Ursache: In der Datenbank lief noch die alte api_place_reservation (aus supabase_setup.sql), die nur
-- name/guests/date/time/type speichert. Dieses Skript legt die richtige Version (aus supabase_update_termine.sql) an.
-- Sicher: ändert keine Tabellen, löscht keine Daten. Einmal im Supabase SQL Editor ausführen.
-- WICHTIG: Danach NICHT mehr supabase_setup.sql erneut ausführen – das überschreibt die Funktion wieder mit der alten Version.
begin;

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

do $$
declare f text;
begin
  foreach f in array array['api_place_reservation(jsonb)', 'api_taken_tables(text,text)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;

commit;

-- Kontrolle (optional, nach einer neuen Test-Reservierung auf der Website):
-- select jsonb_pretty(data->'reservations'->0) from private.state where id = 'main';
-- Dort müssen phone, notes und tables stehen.

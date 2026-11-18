-- Soul Sushi – Update: Lieferdaten bei Online-Bestellungen (Name, PLZ, Telefon, Anmerkung)
-- Sicher: ändert keine Tabellenstruktur, löscht keine Daten. Einmal im Supabase SQL Editor ausführen
-- (NACH supabase_update_termine.sql).
begin;

create or replace function public.api_place_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = private, public as $$
declare d jsonb; o jsonb; dl jsonb; nm text; zip text; ph text;
begin
  p := coalesce(p, '{}'::jsonb);
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 or jsonb_array_length(p->'items') > 100 then
    return jsonb_build_object('error', 'Ungültige Bestellung', 'status', 400);
  end if;

  nm  := left(btrim(coalesce(p->'delivery'->>'name', '')), 60);
  zip := left(btrim(coalesce(p->'delivery'->>'zip', '')), 10);
  ph  := left(btrim(coalesce(p->'delivery'->>'phone', '')), 40);
  if nm = '' or zip = '' or ph = '' then
    return jsonb_build_object('error', 'Bitte Name, PLZ und Telefonnummer angeben.', 'status', 400);
  end if;
  dl := jsonb_build_object('name', nm, 'zip', zip, 'phone', ph,
                           'notes', left(btrim(coalesce(p->'delivery'->>'notes', '')), 500));

  d := private.load();
  o := jsonb_build_object('id', floor(1000 + random() * 9000)::int, 'staffId', null,
        'customer', left(coalesce(nullif(p->>'customer', ''), nm), 60),
        'table', left(coalesce(nullif(p->>'table', ''), 'Lieferung / Abholung'), 60),
        'delivery', dl,
        'items', p->'items', 'total', coalesce((p->>'total')::numeric, 0),
        'status', 'In Zubereitung', 'time', private.hhmm(), 'timestamp', private.now_id());
  d := jsonb_set(d, '{orders}', jsonb_build_array(o) || (d->'orders'));
  perform private.save(d);
  return o;
end $$;

revoke all on function public.api_place_order(jsonb) from public;
grant execute on function public.api_place_order(jsonb) to anon, authenticated;

commit;

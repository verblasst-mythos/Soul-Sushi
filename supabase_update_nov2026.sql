-- Soul Sushi – Update November 2026
-- Sicheres Funktions-Update: verändert keine Tabellenstruktur und löscht keine Bestellungen/Kunden.
begin;

create or replace function public.api_public_state() returns jsonb
language plpgsql security definer set search_path = private, public as $$
declare d jsonb;
begin
  select data into d from private.state where id = 'main';
  d := coalesce(d, '{}'::jsonb);
  return jsonb_build_object(
    'status',  jsonb_build_object('isOpen', case when exists (select 1 from jsonb_array_elements(coalesce(d->'staff', '[]'::jsonb)) st where coalesce((st->>'onDuty')::boolean, false)) then coalesce(d->'status'->'isOpen', 'true'::jsonb) else 'false'::jsonb end,
                                  'workload', coalesce(d->'status'->'workload', '"Niedrig"'::jsonb),
                                  'discordInvite', coalesce(d->'status'->'discordInvite', '""'::jsonb)),
    'roles',   coalesce(d->'roles', '[]'::jsonb),
    'staff',   private.staff_public(coalesce(d->'staff', '[]'::jsonb)),
    'menu',    coalesce(d->'menu', '[]'::jsonb),
    'orders', '[]'::jsonb, 'reservations', '[]'::jsonb, 'customers', '[]'::jsonb, 'vipApplications', '[]'::jsonb);
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

-- Alte lokale Screenshot- und Discord-CDN-Avatare entfernen; Speisekarte bleibt unberührt.
update private.state s
set data = jsonb_set(s.data, '{staff}', (
  select coalesce(jsonb_agg(
    case when coalesce(e->>'avatar', '') like 'file:///%'
              or coalesce(e->>'avatar', '') like 'https://cdn.discordapp.com/attachments/%'
         then e || jsonb_build_object('avatar', '') else e end
    order by ord), '[]'::jsonb)
  from jsonb_array_elements(coalesce(s.data->'staff', '[]'::jsonb)) with ordinality t(e, ord)
))
where s.id = 'main';

commit;

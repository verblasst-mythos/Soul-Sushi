-- Supabase Dashboard -> SQL Editor -> New query -> einfügen -> Run
create table if not exists public.app_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb
);

alter table public.app_state enable row level security;
drop policy if exists "app_state_all" on public.app_state;
create policy "app_state_all" on public.app_state
  for all to anon, authenticated using (true) with check (true);

-- Startdaten (Speisekarte, Personal inkl. Owner/0903, Rollen, ...). Überschreibt nichts, wenn schon Daten da sind.
insert into public.app_state (id, data)
values ('main', $json${
 "status": {
  "isOpen": true,
  "workload": "Niedrig",
  "discordWebhook": ""
 },
 "roles": [
  {
   "id": 1,
   "name": "Geschäftsführung",
   "isManagement": true,
   "color": "#d4af37"
  },
  {
   "id": 2,
   "name": "Manager",
   "isManagement": true,
   "color": "#c82333"
  },
  {
   "id": 1794841924045,
   "name": "Serviceleitung",
   "isManagement": true,
   "color": "#5900ff"
  },
  {
   "id": 1794841932999,
   "name": "Koch",
   "isManagement": false,
   "color": "#ffae00"
  },
  {
   "id": 1794841937827,
   "name": "Kellner",
   "isManagement": false,
   "color": "#ffae00"
  },
  {
   "id": 1794841944048,
   "name": "Azubi",
   "isManagement": false,
   "color": "#2c1f02"
  }
 ],
 "staff": [
  {
   "id": 1,
   "name": "Kai Mueller",
   "role": "Geschäftsführung",
   "pin": "9999",
   "avatar": "https://cdn.discordapp.com/attachments/1550910503348346981/1571553979874148443/image.png?ex=6afbcff2&is=6afa7e72&hm=7583c516ce66915448db61b00ee78f41c9e27708df2d8cd43516901652461c7a&",
   "onDuty": false,
   "clockIn": "-"
  },
  {
   "id": 1794842283373,
   "name": "Eray Drewer",
   "role": "Geschäftsführung",
   "pin": "1111",
   "avatar": "file:///C:/Users/noahk/OneDrive/Bilder/Screenshots%201/Screenshot%202026-11-16%20174450.png",
   "onDuty": false,
   "clockIn": "-"
  },
  {
   "id": 1794860000001,
   "name": "Owner",
   "role": "Geschäftsführung",
   "pin": "0903",
   "avatar": "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80",
   "onDuty": false,
   "clockIn": "-"
  }
 ],
 "menu": [
  {
   "id": 1794842394790,
   "category": "Sushi",
   "name": "Frittiertes Sushi",
   "desc": "Alle Sorten frittiert",
   "price": 210
  },
  {
   "id": 1794842409004,
   "category": "Sushi",
   "name": "Maki Sushi",
   "desc": "Lachs",
   "price": 200
  },
  {
   "id": 1794842426397,
   "category": "Sushi",
   "name": "Sashimi Sushi",
   "desc": "Tintenfisch",
   "price": 190
  },
  {
   "id": 1794850000001,
   "category": "Sushi",
   "name": "Nigiri Sushi",
   "desc": "Roher Thunfisch oder Makrele",
   "price": 200
  },
  {
   "id": 1794842441158,
   "category": "Sushi",
   "name": "Chirashi Sushi",
   "desc": "Fisch + Gemüse + Pilze",
   "price": 200
  },
  {
   "id": 1794842457307,
   "category": "Hauptspeisen",
   "name": "Soul Bowl",
   "desc": "Teriyaki: Mariniertes Fleisch + Toppings",
   "price": 210
  },
  {
   "id": 1794842466910,
   "category": "Hauptspeisen",
   "name": "Ramen",
   "desc": "Nudelsuppe mit kräftiger Brühe",
   "price": 210
  },
  {
   "id": 1794842488988,
   "category": "Hauptspeisen",
   "name": "Hühnchennudeln",
   "desc": "",
   "price": 210
  },
  {
   "id": 1794842499691,
   "category": "Hauptspeisen",
   "name": "Gebratene Ente",
   "desc": "Mit Reis",
   "price": 190
  },
  {
   "id": 1794842518498,
   "category": "Getränke",
   "name": "Grüntee",
   "desc": "",
   "price": 200
  },
  {
   "id": 1794842528002,
   "category": "Getränke",
   "name": "Tequila",
   "desc": "",
   "price": 290
  },
  {
   "id": 1794842541240,
   "category": "Getränke",
   "name": "Bananensaft",
   "desc": "",
   "price": 175
  },
  {
   "id": 1794842549655,
   "category": "Getränke",
   "name": "Soul Matcha",
   "desc": "Frisch & eiskalt",
   "price": 250
  },
  {
   "id": 1794842556623,
   "category": "Getränke",
   "name": "Cola",
   "desc": "",
   "price": 160
  },
  {
   "id": 1794842594431,
   "category": "Nachspeise",
   "name": "Schokoerdbeeren",
   "desc": "",
   "price": 170
  },
  {
   "id": 1794842603762,
   "category": "Nachspeise",
   "name": "Mochi",
   "desc": "Klebreisbällchen + süße Füllung",
   "price": 170
  },
  {
   "id": 1794842675317,
   "category": "Nachspeise",
   "name": "SushiPlatte",
   "desc": "10 Chirashi, 10 Nigiri, 10 Maki, 10 Sashimi, 10 Frittierte, 5 Soul Bowl, 10 Matcha, 5 Mochis, 5 Schokoerdbeeren",
   "price": 15000
  },
  {
   "id": 1794850000002,
   "category": "Halloween Spezial",
   "name": "Witch Kiss",
   "desc": "",
   "price": 200
  },
  {
   "id": 1794850000003,
   "category": "Halloween Spezial",
   "name": "Pumpkin Spice Latte",
   "desc": "",
   "price": 180
  }
 ],
 "orders": [
  {
   "id": 7051,
   "staffId": null,
   "customer": "Online Kunde",
   "table": "Lieferung / Abholung",
   "items": [
    {
     "id": 1794842409004,
     "category": "Sushi",
     "name": "Maki Sushi",
     "desc": "Sushi",
     "price": 200,
     "qty": 4
    }
   ],
   "total": 800,
   "status": "Fertig",
   "time": "17:04",
   "timestamp": 1794845080229
  },
  {
   "id": 8999,
   "customer": "Kai Mueller",
   "table": "Tisch 4",
   "items": [
    {
     "id": 1794842675317,
     "category": "Menü",
     "name": "SushiPlatte",
     "desc": "10 Chirachi Sushi 10 Nigiri Sushi 10 Maki sushi 10 sashimi sushi 10 Frittierte sushi 5 soul bowl 10 matcha 5 mochi 5 schokoerdbeeren",
     "price": 15000,
     "qty": 1
    },
    {
     "id": 1794842603762,
     "category": "Dessert",
     "name": "Mochi",
     "desc": "Dessert",
     "price": 170,
     "qty": 1
    },
    {
     "id": 1794842541240,
     "category": "Getränke",
     "name": "Bananensaft",
     "desc": "Getränke",
     "price": 175,
     "qty": 1
    },
    {
     "id": 1794842488988,
     "category": "Hauptspeisen",
     "name": "Hünchen Nudeln",
     "desc": "Hauptspeisen",
     "price": 210,
     "qty": 1
    }
   ],
   "total": 15555,
   "status": "Fertig",
   "time": "16:36"
  },
  {
   "id": 8989,
   "customer": "POS Direkt",
   "table": "Tisch 4",
   "items": [
    {
     "id": 1794842441158,
     "category": "Sushi",
     "name": "Chirashi Sushi",
     "desc": "Sushi",
     "price": 200,
     "qty": 1
    },
    {
     "id": 1794842499691,
     "category": "Hauptspeisen",
     "name": "Gebratene Ente Mit reis",
     "desc": "Hauptspeisen",
     "price": 190,
     "qty": 1
    },
    {
     "id": 1794842549655,
     "category": "Getränke",
     "name": "Soul Matcha",
     "desc": "Getränke",
     "price": 250,
     "qty": 1
    }
   ],
   "total": 640,
   "status": "Fertig",
   "time": "16:32"
  }
 ],
 "reservations": [],
 "customers": [
  {
   "id": 1794845628366,
   "username": "Kai Mueller",
   "password": "Southfork1505",
   "vipStatus": "Black VIP",
   "isStammkunde": true,
   "discount": 15
  },
  {
   "id": 1794846671881,
   "username": "test1",
   "password": "test^1",
   "vipStatus": "Kein",
   "isStammkunde": false,
   "hasHausverbot": false,
   "discount": 0
  },
  {
   "id": 1794847004294,
   "username": "test12",
   "password": "test12",
   "vipStatus": "Kein",
   "isStammkunde": false,
   "hasHausverbot": false,
   "discount": 0
  }
 ],
 "vipApplications": [
  {
   "id": "1794847379379",
   "username": "test1",
   "phone": "11111",
   "tier": "Black VIP",
   "status": "Abgelehnt",
   "timestamp": 1794847379379
  },
  {
   "id": "1794847376233",
   "username": "test1",
   "phone": "11111",
   "tier": "Silver VIP",
   "status": "Abgelehnt",
   "timestamp": 1794847376233
  },
  {
   "id": "1794847373415",
   "username": "test1",
   "phone": "11111",
   "tier": "Gold VIP",
   "status": "Abgelehnt",
   "timestamp": 1794847373415
  },
  {
   "id": "1794847240309",
   "username": "test1",
   "phone": "256",
   "tier": "Black VIP",
   "status": "Abgelehnt",
   "timestamp": 1794847240309
  }
 ]
}$json$::jsonb)
on conflict (id) do nothing;

# Soul Sushi – GitHub Pages + Supabase (gesichert)
Kein eigener Server nötig.

1. Supabase: SQL Editor -> kompletten Inhalt von `supabase_setup.sql` einfügen -> Run.
   (Legt gesperrte Tabellen + sichere Funktionen an, Passwörter/PINs werden gehasht.)
2. `config.js`: eigene SUPABASE_URL und Publishable-Key eintragen
   (Project Settings -> API Keys).
3. **Reihenfolge der SQL-Dateien (wichtig):** `supabase_setup.sql` (nur bei leerer Datenbank) -> `supabase_update_nov2026.sql` -> `supabase_update_termine.sql` -> `supabase_update_bestellungen.sql` -> `supabase_go_live.sql` (immer ZULETZT). `supabase_fix_reservation_fields.sql` ist nur nötig, wenn die Reservierungsfelder fehlen; mit `supabase_update_termine.sql` ist sie überflüssig. `supabase_setup.sql` und die nov2026-Datei nie erneut ausführen, wenn die Datenbank schon läuft. `supabase_go_live.sql` aktiviert Discord-Meldungen (Webhook in der Verwaltung unter "Shop & Discord" eintragen).
4. GitHub: Dateien in den obersten Ordner des Repos, Settings -> Pages -> Branch main / root.

Mitarbeiter-Login: /staff.html  (Name `Owner`; Start-PIN aus dem Setup sofort ändern und nirgends veröffentlichen!)
Neue Mitarbeiter/PINs legst du in der Verwaltung an (PINs sind danach nicht mehr einsehbar).

## Raumplan

- `floorplan.js` zeichnet den Grundriss: Lounge links, Theke mit 12 Barhockern (B1–B12), Tischblock L1–L3.
- Die Mitarbeiteransicht (`staff.js`) hat im Reiter Reservierungen EINE gemeinsame Raumplan-Karte pro Tag (Tag wählbar, reservierte Tische rot, "Im Plan zeigen" hebt die Tische einer Reservierung gold hervor).
- Tisch-IDs müssen zu `private.table_seats()` in der Datenbank passen.

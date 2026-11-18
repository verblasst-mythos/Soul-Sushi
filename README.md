# Soul Sushi – GitHub Pages + Supabase (gesichert)
Kein eigener Server nötig.

1. Supabase: SQL Editor -> kompletten Inhalt von `supabase_setup.sql` einfügen -> Run.
   (Legt gesperrte Tabellen + sichere Funktionen an, Passwörter/PINs werden gehasht.)
2. `config.js`: eigene SUPABASE_URL und Publishable-Key eintragen
   (Project Settings -> API Keys).
3. **Reservierungen:** Danach `supabase_update_termine.sql` und anschließend `supabase_fix_reservation_fields.sql` im SQL Editor ausführen. Das Fix-Skript sorgt dafür, dass Telefonnummer, Anmerkungen und Tischwahl gespeichert werden. `supabase_setup.sql` danach nicht erneut ausführen, sonst wird `api_place_reservation` wieder mit der alten Version überschrieben.
4. GitHub: Dateien in den obersten Ordner des Repos, Settings -> Pages -> Branch main / root.

Mitarbeiter-Login: /staff.html  (Name `Owner`, PIN `0903` – danach ändern!)
Neue Mitarbeiter/PINs legst du in der Verwaltung an (PINs sind danach nicht mehr einsehbar).

## Raumplan

- `floorplan.js` zeichnet den Grundriss: Lounge links, Theke mit 12 Barhockern (B1–B12), Tischblock L1–L3.
- Die Mitarbeiteransicht (`staff.js`) hat im Reiter Reservierungen EINE gemeinsame Raumplan-Karte pro Tag (Tag wählbar, reservierte Tische rot, "Im Plan zeigen" hebt die Tische einer Reservierung gold hervor).
- Tisch-IDs müssen zu `private.table_seats()` in der Datenbank passen.

# Soul Sushi – GitHub Pages + Supabase (gesichert)
Kein eigener Server nötig.

1. Supabase: SQL Editor -> kompletten Inhalt von `supabase_setup.sql` einfügen -> Run.
   (Legt gesperrte Tabellen + sichere Funktionen an, Passwörter/PINs werden gehasht.)
2. `config.js`: eigene SUPABASE_URL und Publishable-Key eintragen
   (Project Settings -> API Keys).
3. **Reihenfolge der Updates (wichtig):** `supabase_update_nov2026.sql` und danach `supabase_update_termine.sql` ausführen – `supabase_update_termine.sql` immer ZULETZT. Es enthält die vollständigen Funktionen für Reservierungen (Telefon, Anmerkungen, Tische), Termine, News, Jobs und Bewerbungsphase. Die nov2026-Datei enthält ältere Versionen der State-Funktionen und würde sonst News, Jobs, Bewerbungsphase und Reservierungsfelder wieder entfernen. `supabase_setup.sql` nicht erneut ausführen. Alle Updates sind mehrfach ausführbar und löschen keine Daten.
4. GitHub: Dateien in den obersten Ordner des Repos, Settings -> Pages -> Branch main / root.

Mitarbeiter-Login: /staff.html  (Name `Owner`, PIN `0903` – danach ändern!)
Neue Mitarbeiter/PINs legst du in der Verwaltung an (PINs sind danach nicht mehr einsehbar).

## Raumplan

- `floorplan.js` zeichnet den Grundriss: Lounge links, Theke mit 12 Barhockern (B1–B12), Tischblock L1–L3.
- Die Mitarbeiteransicht (`staff.js`) hat im Reiter Reservierungen EINE gemeinsame Raumplan-Karte pro Tag (Tag wählbar, reservierte Tische rot, "Im Plan zeigen" hebt die Tische einer Reservierung gold hervor).
- Tisch-IDs müssen zu `private.table_seats()` in der Datenbank passen.

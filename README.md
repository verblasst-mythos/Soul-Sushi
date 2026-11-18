# Soul Sushi – GitHub Pages + Supabase

Kein eigener Server nötig.

## Einrichtung / Update

1. Supabase: SQL Editor -> `supabase_setup.sql` ausführen (bei einer Neuinstallation).
2. Bei einem bestehenden Projekt: die bisher verwendeten Update-SQL-Dateien wie bisher ausführen.
3. **Wichtig für das Tisch-Reservierungssystem:** Danach `supabase_fix_reservations.sql` vollständig im Supabase SQL Editor ausführen. Dieses Update synchronisiert die bisherigen Reservierungen automatisch mit `public.reservations`. Es erhält die bestehende JSON-Speicherung und das Tischsystem.
4. `config.js`: eigene `SUPABASE_URL` und den Publishable-Key eintragen.
5. GitHub: Dateien in den obersten Ordner des Repos legen, Settings -> Pages -> Branch `main` / root.

## Reservierungen

- Die Tischprüfung und die bestehende Mitarbeiteransicht bleiben erhalten.
- Neue Reservierungen werden im bisherigen Hauptspeicher abgelegt und automatisch nach `public.reservations` gespiegelt.
- Löschungen in der Mitarbeiterverwaltung werden ebenfalls synchronisiert.
- `public.reservations` bleibt für direkte Browserzugriffe gesperrt. Die Synchronisierung läuft innerhalb der Datenbank.
- Bereits vorhandene Reservierungen werden beim Ausführen des SQL-Updates einmalig abgeglichen.

Mitarbeiter-Login: `/staff.html` (Initialkonto gemäß eigener Datenbankeinrichtung; PIN nach dem ersten Login ändern).

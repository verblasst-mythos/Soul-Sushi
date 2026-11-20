# Soul Sushi – Go-live-Checkliste

## 1. Datenbank (Supabase -> SQL Editor)
Läuft die Datenbank schon mit setup/nov2026/termine/bestellungen, genügt: **`supabase_go_live.sql` einmal ausführen**.
Sonst Reihenfolge laut README. Danach Test: die zwei auskommentierten Zeilen am Ende der Datei einzeln ausführen (Antwort 204 = Discord hat die Testmeldung angenommen).

## 2. Discord
1. Discord: Kanal -> Einstellungen -> Integrationen -> Webhooks -> Neuer Webhook -> URL kopieren.
2. Seite -> Mitarbeiter-Login -> Verwaltung -> Shop & Discord -> Webhook einfügen -> speichern.
3. Ab jetzt kommen Meldungen für Online-Bestellungen, Reservierungen, Terminanfragen und VIP-Anträge.
Optional mit Cloudflare-Zwischenstation (Webhook-URL bleibt geheim): `integration/discord-relay-worker.js`, Anleitung im Dateikopf. Im Admin-Feld wird dann die Worker-URL eingetragen.

## 3. Cloudflare / Domain (GitHub Pages)
- GitHub: Settings -> Pages -> Custom domain eintragen, "Enforce HTTPS" aktivieren.
- Cloudflare DNS: CNAME `www` -> `<github-user>.github.io` (Proxy an), SSL/TLS-Modus **Full**, "Always Use HTTPS" an.
- Apex-Domain: vier A-Records von GitHub Pages (185.199.108.153 / .109 / .110 / .111).

## 4. Vor dem Livegang
- [ ] Owner-PIN ändern (Start-PIN stand in der README / im Setup-SQL).
- [ ] Weitere Test-Mitarbeiter und Test-Kunden löschen.
- [ ] Alle Funktionen testen: Registrieren/Login, Bestellung, Reservierung, Termin, VIP-Antrag -> im Staff-Bereich sichtbar -> Discord-Meldung da.
- [ ] Staff-Bereich auf Handy und Desktop testen.

## 5. Bekannte Restrisiken (kein Blocker, aber im Auge behalten)
- Öffentliche Formulare (Bestellung, Reservierung, VIP-Antrag) haben keine Spam-Bremse. Bei Missbrauch: Cloudflare Turnstile + Proxy-Worker davor, oder Discord-Meldungen vorübergehend abschalten (Webhook-Feld leeren).
- Bestellsumme kommt vom Browser und wird nicht serverseitig nachgerechnet. Mitarbeiter sollten die Summe beim Kassieren mit der Speisekarte abgleichen.
- Alle Daten liegen in einer einzigen Datenbankzeile. Für einen kleinen Laden okay, bei vielen gleichzeitigen Bestellungen wird es langsam.
- Kunden-Passwort liegt für die Sitzung im sessionStorage des Browsers (wird beim Schließen des Tabs gelöscht).

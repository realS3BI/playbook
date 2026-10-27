# Playbook

Playbook ist eine eigenständige Plattform für Counter-Strike 2. Sie verbindet eine Lineup-Bibliothek, Granatentraining im Spiel, Teams und Strats, Demoanalyse, gemeinsame Reviews und die Verwaltung eines CS2-Servers. Zum Projekt gehören das Web-Dashboard, ein eigenes CounterStrikeSharp-Plugin, das Panorama-HUD und eine Windows-App für Review-Aufnahmen.

MatchZy ist ein optionaler Servermodus für Matches und Scrims. Das eigene Playbook-Training läuft ohne MatchZy. Metamod und CounterStrikeSharp bilden die gemeinsame Servergrundlage.

[Dokumentation](docs/README.md) · [Quellcode](https://github.com/realS3BI/playbook) · [Fehler melden](https://github.com/realS3BI/playbook/issues)

## Was Playbook bietet

- Maps und Lineups mit Radarpositionen, Wurfdaten, Bildern, Videos und persönlichen Favoriten.
- Eigenes Granatentraining mit Respawn, unbegrenzten Granaten, Bots, Teleports und wiederholbaren Würfen.
- Ein kompaktes Ingame-Panel mit Mausbedienung und immer neun Listenplätzen pro Seite.
- Aufnahmen und Reviews mit Erstellerrechten sowie den Admin-Freigaben „Offiziell“ und „Must Know“.
- Steam-Anmeldung, Rollenverwaltung, Serverkonsole, Plugins, Workshop-Maps, Diagnose und geplante Neustarts.
- Teams mit Ownern und Captains, veröffentlichten Strats und gemeinsamen Live-Ansichten.
- Demoanalyse, Live-Aufzeichnungen, Prematch-Vorbereitung und FACEIT-/Steam-Matchimporte.
- Eine Windows-App, die CS2 mit der Website für Review-Fotos und -Videos verbindet.

## Lokal starten

Voraussetzungen: Node.js ab 22, pnpm (`corepack enable pnpm`) und ein laufender Docker-Dienst mit Docker Compose ab 2.22.

```bash
git clone https://github.com/realS3BI/playbook.git
cd playbook
./dev.sh
```

Unter Windows oder ohne Bash funktioniert `node dev.mjs`. Auch `pnpm dev` im Projektordner und `cd admin-panel && pnpm dev` starten dieselbe Umgebung. Das Skript startet MongoDB, API und Demo-Worker in Docker und Vite direkt auf dem Rechner. Turborepo zeigt `web`, `api` und `worker` in eigenen Bereichen; API und Worker starten nach Codeänderungen von selbst neu. `--plain` schreibt alle Ausgaben untereinander. Die Website ist unter `http://localhost:5173` erreichbar. Es legt `.env.development` mit einem zufälligen Session-Secret an. Für Admin-Rechte die eigene Steam64-ID übergeben:

```bash
node dev.mjs --admin DEINE_STEAM64_ID
```

Für den Zugriff im LAN zusätzlich `--url http://DEINE_ADRESSE:5173` angeben. Steam-Anmeldung und Browser müssen dieselbe Adresse verwenden. Strg+C stoppt die Container; die Entwicklungsdaten bleiben im Compose-Projekt `playbook-dev` erhalten. Diese Umgebung startet keinen Gameserver. Bei bestehenden Entwicklungsdaten `COMPOSE_PROJECT_NAME=cs2-matchzy-dev` in `.env.development` beibehalten, damit dieselben Volumes verwendet werden.

Ein bisher separat gestartetes Vite zuerst beenden, falls Port 5173 belegt ist. `pnpm dev:client` in `admin-panel` startet nur das Frontend und benötigt eine laufende API auf Port 8080.

Die Entwicklungsumgebung startet keinen CS2-Gameserver und erhält keinen Docker-Socket. Anmeldung, Dashboard und gespeicherte Daten lassen sich lokal entwickeln; Gameserver-Steuerung und Live-Diagnosen benötigen den vollständigen Deployment-Stack.

### HTTPS für die Entwicklung

Für HTTPS einen eigenen Reverse Proxy einrichten und mit `--url https://playbook.example.com` starten. Der Proxy muss an den lokalen Vite-Port weiterleiten und WebSocket-Upgrades unterstützen. Vite stellt selbst kein Zertifikat aus. Der interne Port lässt sich mit `--port` wählen.

## Server betreiben

Der vollständige Stack läuft mit Docker Compose auf einem Linux-Host für CS2 oder als Compose-Ressource in Coolify. Details zu Ports, Domain und persistenten Volumes stehen in der [Betriebsanleitung](docs/operations.md).

1. `.env.example` als `.env` kopieren. Öffentliche URL, Admin-Steam64-ID und Session-Secret eintragen. Ein Secret lässt sich mit `openssl rand -hex 32` erzeugen.
2. `docker compose up -d --build` ausführen. In Coolify die Variablen in der bestehenden Ressource setzen und das Repository verbinden.
3. Das Dashboard über einen Reverse Proxy auf dessen internem Port `8080` erreichbar machen und mit Steam anmelden.
4. Unter „Server“ Steam Game Server Login Token für App 730, RCON-Passwort, Startmap und Modus konfigurieren. Einstellungen übernehmen und CS2 starten.
5. Für das Ingame-Panel die [HUD-Assets](training-hud/README.md) installieren oder über das Workshop-Addon ausliefern.

Neue Compose-Installationen heißen `playbook`. Vor einem Update einer bestehenden Installation zuerst die [Umstiegsanleitung](docs/migration-playbook.md) lesen. Ein anderer Compose-Projektname wählt andere Volumes aus.

## Servermodi

| Modus | Aufgabe |
| --- | --- |
| Nades | Eigenständiges Playbook-Training mit Lineups und Ingame-Panel. |
| MatchZy | Matches und Scrims über das externe MatchZy-Plugin; Playbook ist auch in dessen Practice-Modus verfügbar. |
| Warmup / Aim Botz | Aim-Training auf der Workshop-Map Aim Botz. |
| Vanilla + framework | CS2 mit Metamod, CounterStrikeSharp und der Playbook-Rollenprüfung. |

Es ist immer genau ein Modus aktiv. Der Modus und eigene Servernamen bleiben bei der Umbenennung erhalten. [Funktionen und Befehle je Modus](docs/playbook.md).

## Live-Aktualisierungen

Jeder angemeldete Browser verwendet eine gemeinsame WebSocket-Verbindung unter `/api/live`. Das erste Laden und das Speichern von Inhalten verwenden HTTP-Anfragen. Gemeinsame Demo-Wiedergabe und Anwesenheit verwenden zusätzlich bestätigte WebSocket-Befehle. Änderungen an Teams, Strats, aktiven Taktiken, Nades, Favoriten, Benutzerrechten und Servereinstellungen werden nach dem Speichern an die geöffneten Ansichten gesendet. Der bisherige Nade-SSE-Endpunkt bleibt für ältere Clients verfügbar.

HTTP und WebSocket verwenden dieselben Datenabfragen und RBAC-Prüfungen. Vor jedem Versand wird die Sitzung erneut geprüft. Fremde Teams, unveröffentlichte Entwürfe und Serverdaten ohne passende Rolle werden nicht übertragen. Entzogene Mitgliedschaften leeren offene Teamansichten; eine beendete Sitzung schließt die Verbindung. Der Server akzeptiert nur die konfigurierte öffentliche Herkunft, begrenzt Abonnements und Nachrichten und trennt Clients, die keine Daten mehr abnehmen.

Bei einer Unterbrechung zeigt die Oberfläche den Verbindungsstatus und verbindet sich automatisch neu. Danach sendet der Server vollständige aktuelle Ansichten. Ungespeicherte Server- und Strat-Entwürfe bleiben erhalten; parallele Strat-Änderungen müssen vor dem Speichern abgeglichen werden.

Docker-Ereignisse und Logausgaben lösen Server-Updates aus. Dateien des bestehenden Ingame-Plugins werden beobachtet. Als Rückfallebene prüft die API abonnierte Logs jede Sekunde, den Serverstatus alle zwei Sekunden, die Live-Map alle drei Sekunden und Diagnosen alle zehn Sekunden. Diese Prüfungen laufen auf dem Server; im Browser entfallen die wiederkehrenden HTTP-Abfragen. Der Ingame-Dateiabgleich und die Capture-Leases behalten ihr bestehendes Protokoll. Es gibt weiterhin keinen CS2-Gameserver im lokalen Entwicklungsstack.

Ein vorgeschalteter Proxy muss WebSocket-Upgrades für `/api/live` an denselben API-Port weiterreichen. Vite unterstützt das bereits. In Produktion verwendet der Browser automatisch `wss://` mit der konfigurierten HTTPS-Adresse. Die Umsetzung läuft innerhalb einer API-Instanz; mehrere API-Replikate benötigen zusätzlich einen gemeinsamen Ereignisverteiler.

## Team-Management und Strats

1. Unter **Team-Management** ein Team gründen. Der Gründer ist Owner. Ein Spieler kann mehreren Teams angehören.
2. Als Owner einen Einladungslink erstellen. Er gilt sieben Tage und kann widerrufen werden. Eingeladene Steam-Benutzer bestätigen den Beitritt als Mitglied. Nur der Owner darf Mitglieder entfernen, Captains ernennen und das Eigentum übertragen. Eine Übertragung widerruft offene Einladungen.
3. Unter **Strats** eine Taktik anlegen. Owner und Captains bearbeiten Name, Map, Seite, gemeinsame Erklärung und fünf frei benennbare Plätze. Pro Platz lassen sich ein Teammitglied und geordnete Schritte mit Position, Timing und Nade-Links hinterlegen.
4. Den Entwurf speichern und anschließend veröffentlichen. Mitglieder sehen nur veröffentlichte Strats. **Meine Aufgaben** ist die Standardansicht; **Teamübersicht** zeigt alle Plätze. Noch nicht besetzte Spieler erhalten einen Hinweis.
5. Eine veröffentlichte Strat aktivieren und gemeinsam **Strats → Live-Ansicht** öffnen. Jeder Tab folgt seinem Team aus der URL, mit sofortigen Aktualisierungen über WebSocket. Entwurf und erneute Veröffentlichung verändern die aktive Fassung erst bei erneuter Aktivierung. Archivieren blendet die Bibliotheksfassung aus; ein bereits aktiver Stand bleibt bis zum Beenden erhalten.

Revisionsprüfungen verhindern, dass parallele Änderungen unbemerkt überschrieben werden. Der Editor warnt vor dem Verlassen mit ungespeicherten Änderungen. Nach dem Entfernen eines besetzten Mitglieds muss die Besetzung vor der nächsten Veröffentlichung oder Aktivierung korrigiert werden. Verknüpfte Nades behalten ihre eigenen Rechte und ihren Freigabestatus. Fehlende Nades werden im Schritt angezeigt und verhindern eine erneute Veröffentlichung, bis die Referenz entfernt oder ersetzt wird.

Teams und Strats funktionieren ohne laufenden CS2-Server. Es gibt keinen Import aus `cs-playbook` und keine Ingame-Strat-Ansicht. Technische Details und ursprüngliche Entscheidungen stehen in [Team-Plan](docs/team-playbooks-plan.md) und [RBAC-Plan](docs/rbac-plan.md).


## Demoanalyse und Team-Reviews

Unter **Analyse** könnt ihr heruntergeladene FACEIT- und Premier-Demos hochladen, Runden auf dem Radar ansehen und Szenen für einen Team-Review vorbereiten. Der Captain steuert die gemeinsame Wiedergabe über WebSocket. Mitglieder können selbst nachsehen, wieder folgen und Erkenntnisse festhalten. Aus einer Szene entsteht ein Strat-Entwurf; Beispiele lassen sich auch mit bestehenden Strats und Spieleraufgaben verbinden.

Uploads sind zunächst privat, sofern beim Hochladen kein Team gewählt wird. Eine spätere Teamfreigabe ist ausdrücklich möglich. Die Verarbeitung läuft im neuen Dienst `demo-worker`; API und Worker benötigen das gemeinsame Demo-Volume. Eine laufende Entwicklungsumgebung nach diesem Update einmal neu starten, damit der zusätzliche Dienst und das Volume eingebunden werden.

Manuelle Datei-Uploads (`.dem`, `.dem.gz`, `.dem.bz2`) bleiben verfügbar. Unter **Live** werden Match- und Team-Besprechungen mit Tonspuren, Präsentationswechseln und Notizen verbunden; Ausschnitte lassen sich als Strat-Erklärungen übernehmen. **Prematch** verbindet Gegnerbesetzung, FACEIT-Wettbewerb, verfügbare Demos und den eigenen Matchplan. **Matchimporte** verwaltet FACEIT-/Steam-Verbindungen, Speicherquoten und Aufbewahrung. Die Quellenzugänge, private Audioablage und noch ausstehenden echten Windows-/Provider-Tests stehen im [Betriebsablauf für Live und Matchvorbereitung](docs/live-analysis-operations.md). KI bleibt eine spätere Erweiterung. Ablauf und Grenzen der Demoanalyse sind in [Demoanalyse und Matchvorbereitung](docs/demo-analysis-plan.md#implementierter-erster-ausbau) beschrieben.

## Projektaufbau

| Verzeichnis | Inhalt |
| --- | --- |
| `admin-panel/` | React-Website, API, Datenhaltung und Serververwaltung. |
| `server-plugin/Playbook/` | Eigenes C#-Server-Plugin, gebaut als `Playbook.dll`. |
| `server-plugin/Playbook.Tests/` | Tests für Training, Rollen, Lineups und Panel. |
| `training-hud/` | Panorama-Layout, Styles und lokale sowie Workshop-Builds. |
| `playbook-desktop/` | Windows-App mit Electron und nativem Aufnahme-Hilfsprogramm. |
| `cs2/` | CS2-Image, Bootstrap und Installation der externen Plugins. |
| `docs/` | Betrieb, Architektur, Migration und Bedienung. |

[Entwicklung und Prüfungen](CONTRIBUTING.md) · [Architektur und Datenfluss](docs/architecture.md) · [Windows-App](playbook-desktop/README.md)

## Eingebundene Projekte

Playbook verwendet unter anderem [CounterStrikeSharp](https://github.com/roflmuffin/CounterStrikeSharp), [Metamod:Source](https://www.sourcemm.net/) und das [CS2-Docker-Image von CM2Walki](https://github.com/CM2Walki/CS2). [MatchZy](https://github.com/shobhit-pathak/MatchZy) ist die Integration für den gleichnamigen Modus. Die Namen, Herkunft und Lizenzen dieser Komponenten bleiben eigenständig. Quellen eingebundener Kartenbilder und Symbole sind in den jeweiligen `sources.json`-Dateien dokumentiert.

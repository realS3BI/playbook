# Recherche zur CS2-Demoanalyse

Stand: 5. Oktober 2026. Recherchiert wurden die offiziellen Produktdokumentationen, die FACEIT-API-Spezifikation, Valves Dokumentation zum Matchzugang und die genannten Open-Source-Repositories. Es wurden keine Accounts verbunden, Downloads-API-Zugänge beantragt oder Demos geparst. Produktangaben sind als dokumentierte Fähigkeiten zu verstehen; ein Test der angemeldeten Anwendungen steht aus. Der erste Schwerpunkt sind eigene FACEIT- und CS2-Premier-/Matchmaking-Matches. Der Captain soll den gemeinsamen Review führen; die im Projekt ergänzten WebSockets sind dafür vorgesehen. Der [Produktentwurf](demo-analysis-plan.md) beschreibt diesen Ablauf.

## Einschätzung

Für den ersten technischen Versuch empfehle ich Datei-Uploads eigener FACEIT- und CS2-Premier-/Matchmaking-Demos, einen getrennten Parser-Prozess und eine kleine 2D-Rundenansicht. Die automatische Beschaffung folgt später getrennt je Quelle. FACEIT-Matchdaten lassen sich unabhängig vom Demo-Download anbinden. MatchZy bleibt eine zusätzliche Quelle für spätere Scrims auf dem eigenen Server.

Der wesentliche Produktentwurf ist der Weg von einer beobachteten Runde zu einer eigenen Strat, den zugehörigen Nades und einem Training auf dem vorhandenen Server. CS2.CAM deckt bereits viele Teile davon ab. Eine Verbesserung muss deshalb an konkreten Teamabläufen gemessen werden, etwa wie schnell fünf Spieler ihre Aufgaben verstehen und gemeinsam üben können.

## Was die Referenzprodukte dokumentieren

| Produkt | Dokumentierte Fähigkeiten | Einordnung |
| --- | --- | --- |
| GetReplay | Browserbasierte 2D-Wiedergabe, Ereignis-Timeline, Spielerpositionen, Granatenverläufe und Statistiken. Ein Smart Mode passt die Abspielgeschwindigkeit an Ereignisse an. | Gute Referenz für einen leicht zugänglichen Viewer. Aussagen zu Geschwindigkeit oder Zeitersparnis wurden nicht gemessen. [Produktseite](https://getreplay.gg/) |
| GetReplay, Pro-Demos | Die Anleitung beschreibt das Beschaffen einer Demo und anschließende Hochladen in den Viewer. | Daraus folgt kein dokumentierter öffentlicher Katalogzugang oder eine API für unser Projekt. [Pro-Demo-Anleitung](https://getreplay.gg/en/pro-demos) |
| CS2.CAM, Private Playbook | Verknüpft Strats mit Demo-Runden, Board-Taktiken und Videos. Spieler erhalten Aufgaben; die Utility der zugeordneten Demo-Spieler kann übernommen werden. | Die Verbindung von Demo und Playbook existiert bereits. [Private Playbook](https://cs2.cam/en/wiki/private-playbook) |
| CS2.CAM, Playbook | Beschreibt die Erkennung von Spielzügen, Filter nach Team, Map, Zeitraum, Seite und Economy sowie Wiedergabe der gefundenen Runden. | Erkennungsqualität und Vollständigkeit sind ohne Testdaten nicht beurteilt. [Playbook](https://cs2.cam/en/wiki/playbook) |
| CS2.CAM, Grenade Mode | Zeigt Würfe mehrerer Runden, sucht ähnliche Muster und exportiert Position sowie Blickwinkel als `setpos` und `setang`. | Ein bloßer Teleport zum Wurfpunkt wäre keine neue Fähigkeit. [Grenade Mode](https://cs2.cam/en/wiki/grenade-mode) |
| CS2.CAM, FACEIT | Dokumentiert das Verknüpfen persönlicher Accounts und von FACEIT-Teams zum Match-Sync. Private Demos lassen sich nach gleichem Roster taggen, ausdrücklich auch für Gegner ohne HLTV-Eintrag. | FACEIT- und Amateuranalyse sind dort bereits vorgesehen. Umfang und Zuverlässigkeit des tatsächlichen Imports bleiben ungetestet. [FACEIT-Integration](https://cs2.cam/en/wiki/faceit-integration), [Private Demos](https://cs2.cam/en/wiki/private-demos) |
| CS2.CAM, Veto | Die Simulation für BO1, BO3 und BO5 ist als geschlossene Beta dokumentiert. Sie nutzt HLTV-Historie; ohne diese fehlen ihr laut Dokumentation die Teamdaten. | Diese konkrete Einschränkung gilt für die Veto-Simulation, nicht pauschal für die anderen Analysefunktionen. [Veto Analysis](https://cs2.cam/en/wiki/veto-analysis) |

Die CS2.CAM-Startseite bewirbt außerdem einen großen vorverarbeiteten Pro-Match-Katalog und 3D-Wiedergabe. Weder Katalogabdeckung noch Genauigkeit wurden unabhängig geprüft. In den untersuchten Produktseiten ist keine für unser Projekt nutzbare öffentliche Import- oder Einbettungs-API belegt. Vor einer solchen Integration wäre deren Verfügbarkeit direkt zu klären. [CS2.CAM](https://cs2.cam/)

## FACEIT: Matchdaten und Demodateien getrennt behandeln

### Welche Abfragen dokumentiert sind

Die Data API verwendet einen API-Key und bietet öffentliche FACEIT-Daten an. Ein persönlicher Login ist für diese API nicht das dokumentierte Authentifizierungsmodell. Für unsere Anwendung bietet sich ein serverseitiger Key an. [Data API](https://docs.faceit.com/docs/data-api/), [API-Keys](https://docs.faceit.com/getting-started/authentication/api-keys/)

| Ziel | Dokumentierter Endpunkt |
| --- | --- |
| Team finden und auflösen | `/search/teams`, `/teams/{team_id}` |
| Teamstatistiken und Turnierzuordnung | `/teams/{team_id}/stats/{game_id}`, `/teams/{team_id}/tournaments` |
| Championship-Matches | `/championships/{championship_id}/matches` |
| Turnier-Matches | `/tournaments/{tournament_id}/matches` |
| Hub-Matches | `/hubs/{hub_id}/matches` |
| Spielerhistorie | `/players/{player_id}/history` |
| Match und Statistik | `/matches/{match_id}`, `/matches/{match_id}/stats` |

Die Spezifikation enthält keinen allgemeinen `/teams/{team_id}/history`-Endpunkt. Die Spielerhistorie unterstützt `from`, `to` und Pagination; `from` ist ohne Angabe auf einen Monat zuvor gesetzt. Matchdaten enthalten Teilnehmer, Wettbewerb und `demo_url`; das Feld ist keine Verfügbarkeitsgarantie. Championship-, Turnier- und Hub-IDs müssen anhand des tatsächlichen Wettbewerbstyps aufgelöst werden. Die Endpunkte dokumentieren auch Fehler wie `429`. [API-Referenz](https://docs.faceit.com/docs/data-api/data/), [OpenAPI-Spezifikation](https://open.faceit.com/data/v4/docs/swagger.json)

Eigener Umsetzungsvorschlag: Team und Wettbewerb als getrennte Quellenreferenzen speichern. Kandidaten über Wettbewerb und ergänzend Spielerhistorien finden, anhand der Match-ID deduplizieren und die tatsächliche Besetzung je Match speichern. Roster-Überschneidung ist eine Zuordnungsregel, kein Beweis für ein offizielles Teamspiel. Die Analyse sollte den betrachteten Zeitraum, die Besetzung und die Zahl verfügbarer Demos zeigen. Ob konkrete ESEA-Ligen oder andere Wettbewerbe durch die dokumentierten Endpunkte vollständig abgedeckt sind, muss mit echten Links geprüft werden.

### Der Download benötigt eigenen Zugang

FACEIT erklärt Cloud-Dateien als standardmäßig privat. Die Downloads API tauscht eine Ressourcen-URL gegen eine signierte Download-URL. Dokumentiert sind ein gesonderter Antrag, eine erwartete Antwortzeit von 30 Tagen und ein Token mit Downloads-Scope. Der Endpoint ist `POST /download/v2/demos/download`. Die Dokumentation verweist auf einen Match-Demo-Ready-Webhook. Ein normaler Data-API-Key allein belegt keinen Demo-Zugriff. [Downloads API](https://docs.faceit.com/getting-started/Guides/download-api/)

FACEITs Supportanleitung nennt für den manuellen Download Matches aus den letzten 30 Tagen. Die Anleitung stammt aus 2023; sie beschreibt keine dauerhafte Archivgarantie. Der konkrete Zugang und die Aufbewahrung müssen für den geplanten Import getestet werden. [FACEIT-Demo-Download](https://support.faceit.com/hc/en-us/articles/10622392832412-How-to-download-and-watch-a-CS2-demo)

Die aktuelle CS-Demo-Manager-Dokumentation meldet direkte FACEIT-Downloads als vorübergehend nicht verfügbar und verweist auf den Download im Browser. Das bestätigt ein praktisches Integrationsrisiko, ohne den Zustand aller anderen Anbieter zu belegen. [CS Demo Manager: Downloads](https://cs-demo-manager.com/docs/guides/downloads)

Eigener Umsetzungsvorschlag: Bereits importierte Metadaten erhalten einen klaren Zustand wie "Demo fehlt", "Zugriff fehlt", "Wird verarbeitet" oder "Analyse verfügbar". Datei-Uploads müssen dieselbe Analyse ermöglichen. Für einen späteren automatischen Import sind Zugang, Quoten, erlaubte Nutzung und konkrete Downloadformate noch offen; diese Recherche hat dafür keine Freigabe festgestellt.

## Valve Premier und Matchmaking

Steam-OpenID bestätigt die Steam-ID für den Website-Login. Es erteilt in diesem Ablauf keinen Zugriff auf die Matchhistorie. Valve beschreibt dafür einen getrennten Game Authentication Code, den der Spieler erstellt und widerrufen kann. [Steamworks: OpenID](https://partner.steamgames.com/doc/features/auth#website), [Valve: Einführung der Game Authentication Codes](https://blog.counter-strike.net/2019/09/25513/)

Der von Valve dokumentierte History-Zugang benötigt den Web-API-Key des Anwendungsbetreibers und drei Spielerangaben: `steamid`, `steamidkey` als Game Authentication Code sowie `knowncode` als bereits bekannter Match-Sharecode. `GET /ICSGOPlayers_730/GetNextMatchSharingCode/v1` liefert `result.nextcode` für das nächste verfügbare Match. Bei noch keinem Folgematch nennt die Dokumentation HTTP 202 und `n/a`; für einen ungültigen Ausgangscode HTTP 412. Der Code ist somit ein Cursor zum Vorwärtslesen und keine Download-URL. [Valve: Match-History-API](https://developer.valvesoftware.com/wiki/Counter-Strike:_Global_Offensive_Access_Match_History)

Valves Release Notes vom 31. August 2023 beziehen Competitive, Wingman und Premier ausdrücklich in die History-Freigabe ein. Sie verlangen für `GetNextMatchSharingCode` einen Ausgangscode, der höchstens einen Monat alt ist. Das erlaubt keine Zusage eines vollständigen historischen Imports. Nach längeren Pausen kann ein neuer Ausgangscode erforderlich sein. [Valve: Release Notes vom 31. August 2023](https://store.steampowered.com/news/posts/?appids=730&enddate=1693615397&feed=steam_community_announcements)

Die aktuelle CS-Demo-Manager-Implementierung dekodiert einen Match-Sharecode in Match-ID, Reservation-ID und TV-Port. Ein separater Game-Coordinator-Helfer liefert anschließend die Matchinformationen; daraus liest die Anwendung die Demo-URL. Das ist ein belegtes Implementierungsbeispiel, kein von uns getesteter gehosteter Valve-Importer. [Sharecode-Auflösung](https://github.com/akiver/cs-demo-manager/blob/main/src/node/download/build-download-from-share-code.ts), [Demo-URL aus Matchinformationen](https://github.com/akiver/cs-demo-manager/blob/main/src/node/valve-match/get-valve-match-from-match-info-protobuf-message.ts)

CS Demo Manager dokumentiert für seinen lokalen Weg laufendes, angemeldetes Steam und einen kurzen Start von CS2. Seine Abfrage der jüngsten Matches liefert laut eigener Dokumentation acht Einträge; das ist eine andere Zugriffsmethode als das Vorwärtslesen der Sharecodes. Die Dokumentation warnt auch vor ablaufenden Downloadlinks. [CS Demo Manager: Valve-Downloads](https://cs-demo-manager.com/docs/guides/downloads#valve)

Für den Upload ist die `.dem`-Datei das eigentliche Analyseobjekt. `.dem.info` enthält zusätzliche Matchmetadaten und ersetzt die Demo nicht. Ein offener Downloader für CS2 verarbeitet Valve-Replay-URLs mit `.dem.bz2` und entpackt sie zu `.dem`. [CS Demo Manager: Demoanalyse](https://cs-demo-manager.com/docs/guides/demos-analysis), [Download-Implementierung](https://github.com/claabs/cs-demo-downloader/blob/master/src/download.ts)

Eigener Umsetzungsvorschlag: Zunächst eigene heruntergeladene `.dem`-Dateien annehmen; komprimierte Varianten anhand echter Beispieldateien ergänzen. Später Sharecode-Eingabe und History-Verbindung getrennt anbieten. Der Valve-Adapter muss Code-Ermittlung, GC-Auflösung, Dateiverfügbarkeit und Download jeweils ausweisen. Sein Versuch umfasst je ein aktuelles Premier- und Competitive-Match, ein noch nicht verfügbares Folgematch und einen abgelaufenen Ausgangscode. Die gemeinsame Wiedergabe arbeitet mit bereits analysierten Dateien und bleibt von diesem Adapter unabhängig.

## MatchZy-Demos als zusätzliche Quelle für eigene Scrims

MatchZy dokumentiert automatische Aufnahmen nach dem Ready der Teams und das Ende nach dem Map-Ergebnis. `matchzy_demo_path` und `matchzy_demo_name_format` steuern Ablage und Dateinamen. Über `matchzy_demo_upload_url` kann die komprimierte Aufnahme nach Ende der Aufzeichnung an einen HTTP-Endpunkt gesendet werden. Die Header `MatchZy-FileName`, `MatchZy-MapNumber` und `MatchZy-MatchId` liefern die Zuordnung. Die Dokumentation berücksichtigt auch die verzögerte Beendigung durch GOTV-Delay. [MatchZy: GOTV und Demos](https://shobhit-pathak.github.io/MatchZy/gotv/)

Das Repository nennt `tv_enable 1` als Voraussetzung. Der Quellcode enthält außerdem `matchzy_demo_recording_enabled` und konfigurierbare Upload-Header für eine Authentifizierung am Empfänger. Die im Projekt eingesetzte MatchZy-Version muss diese Optionen tatsächlich unterstützen. [MatchZy-Repository](https://github.com/shobhit-pathak/MatchZy), [DemoManagement.cs](https://github.com/shobhit-pathak/MatchZy/blob/dev/DemoManagement.cs)

Eigener Umsetzungsvorschlag für spätere Scrims: Einen Upload-Endpunkt ergänzen, der eine vollständig eingegangene Datei einem Server und Team zuordnet und danach einen Analyseauftrag anlegt. Der Parser läuft außerhalb des Spielservers. Im Versuch müssen mindestens zwei aufeinanderfolgende Maps inklusive Mapwechsel vollständig ankommen. Eine laufende oder teilweise geschriebene Aufnahme darf noch keinen erfolgreichen Import melden.

## Geeignete Open-Source-Bausteine

Die Lizenzen wurden in den jeweiligen Repository-Dateien geprüft. Alle vier genannten Hauptprojekte führen eine MIT-Lizenz. Das ist keine Aussage über Rechte an fremden Demos, Kartenbildern oder sämtlichen transitiven Abhängigkeiten.

| Baustein | Belegte Eigenschaften | Einsatzvorschlag |
| --- | --- | --- |
| demoparser2 | Rust-Kern mit Python- und JavaScript-Anbindung; Abfragen für Ereignisse und Tickdaten. Das Repository nennt zusätzlich ein WASM-Paket. [Repository](https://github.com/LaihoE/demoparser), [Lizenz](https://github.com/LaihoE/demoparser/blob/main/LICENSE) | Erster Kandidat für einen kleinen Analyse-Worker. Die neue Weboberfläche verwendet unser eigenes, reduziertes Datenformat. |
| demoinfocs-golang | Go-Bibliothek für CS2-Demos mit ereignisbasierter Verarbeitung und dokumentierten Beispielen. [Repository](https://github.com/markus-wa/demoinfocs-golang), [Lizenz](https://github.com/markus-wa/demoinfocs-golang/blob/master/LICENSE.md) | Alternative für einen eigenständigen Worker und Gegenprobe bei Parserabweichungen. |
| Awpy | Python-Werkzeuge für Tickdaten, Statistik, Navigation, Sichtbarkeit und Visualisierung. Die Paketdefinition verwendet selbst `demoparser2`. [Repository](https://github.com/pnxenopoulos/awpy), [Abhängigkeiten](https://github.com/pnxenopoulos/awpy/blob/main/pyproject.toml), [Lizenz](https://github.com/pnxenopoulos/awpy/blob/main/LICENSE) | Ergänzung für Analysen, Heatmaps und spätere Merkmale zur Mustererkennung. Vorher prüfen, ob die Zusatzfunktionen und Abhängigkeiten gebraucht werden. |
| CS Demo Manager | Vollständige Anwendung mit CLI für Analyse und unter anderem JSON-Export. Videoerstellung ist separat dokumentiert. [CLI](https://cs-demo-manager.com/docs/cli), [Repository](https://github.com/akiver/cs-demo-manager), [Lizenz](https://github.com/akiver/cs-demo-manager/blob/main/LICENSE) | Referenz für Analyseverhalten und spätere Videoabläufe. Eine Integration der vollständigen Anwendung wäre gegen einen schmalen Worker abzuwägen. |

Bei demoparser2, demoinfocs und CS Demo Manager wurden Änderungen am Standardbranch im September beziehungsweise Oktober 2026 festgestellt. Awpys abgefragter Standardbranch zeigte zuletzt einen Commit vom 25. März 2025; ein neueres allgemeines Repository-Pushdatum belegt keine neuere Parserintegration. Diese Daten sind Wartungsindikatoren, keine Zusicherung für aktuelle CS2-Demos. [demoparser2-Commit](https://github.com/LaihoE/demoparser/commit/c8f79275f30132696abaa22796f7234300b005af), [demoinfocs-Commit](https://github.com/markus-wa/demoinfocs-golang/commit/14db58bad6e6ac2cb794b441c7b3d0d2a6dd1752), [CS-Demo-Manager-Commit](https://github.com/akiver/cs-demo-manager/commit/b45a5f29283590c3fd0fc6526564b49567c0b931), [Awpy-Commit](https://github.com/pnxenopoulos/awpy/commit/94f3571367012b763d3730d92bb4502b50a89bd8)

## Technische Fragen, die echte Demos beantworten müssen

Die folgenden Punkte sind eigene Prüfanforderungen. Die Recherche hat sie nicht als bereits gelöst nachgewiesen.

1. **Grunddaten.** Zehn Spieler, Steam-IDs, Seitenwechsel, Runden, Verlängerung, Neustarts, Pausen, Economy und Ereignisse zuerst aus echten FACEIT- und Premier-/Matchmaking-Demos vergleichen. MatchZy- und Pro-Demos erweitern später die Prüfung. Eine Demoquelle darf nicht stillschweigend dieselben Rundengrenzen wie eine andere voraussetzen.
2. **2D-Wiedergabe.** Positionen, Höhe und Blickrichtung auf die vorhandenen Karten projizieren. Mehrstöckige Maps gesondert prüfen. Anzeige-Sampling und Interpolation müssen sich von der Genauigkeit der Ereignisdaten unterscheiden lassen.
3. **Utility.** Werfer, Wurfzeitpunkt, Flugbahn, Entstehung und Ende der Effekte prüfen. Ein gefundener Wurf ist zunächst eine Demo-Referenz. Seine exakte Wiederholbarkeit als Trainings-Lineup ist gesondert nachzuweisen, insbesondere bei Bewegung, Sprüngen, Wurfstärke und abweichenden Spiel- oder Mapversionen.
4. **Ressourcen.** Für dieselben Dateien Laufzeit, maximalen Speicherverbrauch und Ergebnisgröße messen. Erst damit Parallelität, Aufbewahrung und laufende Kosten festlegen. Keine fremden Benchmarks als Kapazitätsplanung übernehmen.
5. **Wiederholbarkeit.** Parser- und Datenschemaversion am Ergebnis speichern. Fehlerhafte und erneut eingereichte Demos dürfen keine doppelten Matches erzeugen. Eine spätere Neuanalyse muss dieselben Teamnotizen und Rundenreferenzen sinnvoll erhalten.

Vorläufige Entscheidung: `demoparser2` zuerst prüfen, `demoinfocs-golang` als Alternative bereithalten. Awpy erst hinzufügen, wenn eine konkrete Analysefunktion davon profitiert. 2D-Daten und Spielvideo als getrennte Ergebnisse behandeln. Die CS-Demo-Manager-CLI dokumentiert für Video eine eigene Aufzeichnung mit Spiel- und Aufnahmeparametern; daraus folgt keine einfache Videoexportfunktion des Parsers. [Video-CLI](https://cs-demo-manager.com/docs/cli#generate-videos)

## Prematch-Analyse und spätere KI

Eigener Produktvorschlag: Ein Gegnerbericht beginnt mit belegten Beobachtungen aus den verfügbaren Runden. Jede Zahl nennt Map, Seite, Economy, Zeitraum, Besetzung und Stichprobe. Ein Klick öffnet die betreffenden Runden. "In 7 von 10 betrachteten Full-Buy-Runden" ist überprüfbar; "dieses Team macht immer" wäre daraus nicht ableitbar.

Maphäufigkeit und Ergebnisse können bereits mit Matchmetadaten entstehen. Positionen, Utility-Abfolgen und detaillierte Ausführungen setzen passende Demodaten voraus. Gespielte Maps belegen keine vollständige Veto-Historie. Eine Vetoempfehlung braucht tatsächliche Pick-/Ban-Daten und das konkrete Turnierformat, andernfalls muss sie als manuelle Einschätzung erscheinen.

KI sollte später Fragen über diese Daten beantworten, ähnliche Runden finden und Berichte formulieren. Zahlen und Rundenlisten berechnet die Analysepipeline. Aussagen der KI verweisen auf die zugrunde liegenden Runden und unterscheiden Beobachtung von Interpretation. Einen Gegenplan oder eine neue Strat erstellt sie als bearbeitbaren Entwurf. Sie vergibt keine bestehenden Freigaben wie "Offiziell" oder "Must Know".

## Abnahmekriterien für den ersten Technikversuch

- Eine vollständige eigene FACEIT- oder Premier-/Matchmaking-Demo wird per Datei-Upload verarbeitet. Quelle und Dateiversion sind festgehalten. Vor Freigabe beider Quellen wird mindestens eine aktuelle Demo je Quelle geprüft. Fehlende automatische Imports blockieren den ersten Viewer nicht.
- Eine ausgewählte Runde spielt auf einer Karte mit allen verfügbaren Spielerpositionen, Kill-Ereignissen, Bombenereignissen und mindestens einer korrekt zugeordneten Granate ab.
- Eine gespeicherte Rundenreferenz öffnet nach Neuladen denselben Ausschnitt und lässt sich einer bestehenden Strat zuordnen.
- Für die spätere FACEIT-Anbindung wird separat an einem echten Team und Wettbewerb festgehalten, welche Matches die Data API liefert und für welche davon eine Demo tatsächlich beschafft werden kann.
- Laufzeit, Spitzenverbrauch des Arbeitsspeichers, Dateigrößen und konkrete Parserlücken sind gemessen.
- Erst danach werden Parserwahl, unterstützte Demoquellen und Umfang der ersten Produktversion verbindlich festgelegt.

## Ergänzende Prüfung: automatische Imports und Gegnerberichte

Erneut geprüft am **5. Oktober 2026**. Dieser Abschnitt beschreibt öffentliche Schnittstellen und offene Voraussetzungen für die nächste Ausbaustufe. Es wurden keine Zugangsdaten verwendet, Accounts verbunden oder Importdienste eingerichtet.

### FACEIT: drei getrennte Zugänge

| Aufgabe | Dokumentierter Zugang | Konsequenz für den Entwurf |
| --- | --- | --- |
| Öffentliche Spieler-, Team- und Matchdaten lesen | Data API v4 mit API-Key des Anwendungsbetreibers; für unser Backend ein Server-Key. [Data API](https://docs.faceit.com/docs/data-api/), [API-Keys](https://docs.faceit.com/getting-started/authentication/api-keys/) | Hinterlegte FACEIT-IDs können bereits ohne persönlichen FACEIT-OAuth-Login als Datenquelle dienen. |
| Persönlichen FACEIT-Account verbinden | FACEIT Connect, Authorization Code Flow mit PKCE; OAuth-Client, Consent Screen und Redirect-URL im App Studio. [Account Linking](https://docs.faceit.com/getting-started/authentication/oauth2/) | OAuth bestätigt die Account-Verbindung. Es ersetzt weder Betreiber-Key noch die gesonderte Downloads-Freigabe. |
| Demodatei abrufen | Gesondert beantragte Downloads API mit Downloads-Scope-Token; Ressourcen-URL gegen signierte URL tauschen. [Downloads API](https://docs.faceit.com/getting-started/Guides/download-api/) | Ein gefundener Matchdatensatz oder erfolgreiches Account-Linking bedeutet noch keinen erfolgreichen Demo-Import. |

Neue Matches lassen sich laut Dokumentation auch per Webhook erkennen: Abonnements dürfen eine statische Liste anderer User-GUIDs oder eigener/fremder Organizer enthalten. `match_status_finished` und `match_demo_ready` sind für User und Organizer aufgeführt; private Details können fehlen. Eigener Entwurf: Webhooks zur schnellen Erkennung, periodischer Historienabgleich zum Nachholen. [FACEIT-Webhooks](https://docs.faceit.com/docs/webhooks/)

Die aktuelle Match-Spezifikation enthält `teams.*.roster` für die tatsächliche Besetzung und ein Feld `voting`. Dessen Inhalt ist jedoch nicht spezifiziert; ein eigener Veto-Endpunkt fehlt. Vollständige Pick-/Ban-Reihenfolgen müssen deshalb an echten Matchantworten geprüft werden. Die oben genannten Team-, Championship-, Turnier-, Hub- und Spielerabfragen sind die dokumentierten Quellen; die Standard-Zeitspanne der Spielerhistorie ist keine allgemeine Aufbewahrungsgrenze. [OpenAPI-Spezifikation](https://open.faceit.com/data/v4/docs/swagger.json)

Für Dateien bleibt die Grenze konkreter: FACEITs am 28. September 2023 veröffentlichte Supportanleitung verlangt beim manuellen Download Matches innerhalb der letzten 30 Tage. Das ist keine Zusage einer entsprechend vollständigen Downloads-API-Historie. Zugangsfreigabe, konkrete Dateien, Quoten und Laufzeit signierter URLs sind für unsere Anwendung noch ungeprüft. [FACEIT-Demo-Download](https://support.faceit.com/hc/en-us/articles/10622392832412-How-to-download-and-watch-a-CS2-demo)

### Steam/Premier: Identität, Historie und Downloadauflösung

Steam-OpenID liefert die verifizierte Steam-ID für die Website. Der oben beschriebene History-Zugang benötigt zusätzlich Game Authentication Code, aktuellen Ausgangs-Sharecode und Betreiber-Web-API-Key. Ein Sharecode ist weiterhin keine Demo-URL. Valves Release Notes vom **31. August 2023** nennen ausdrücklich Premier und die Monatsgrenze des Ausgangscodes. [Steamworks: OpenID](https://partner.steamgames.com/doc/features/auth#website), [Valve: Match-History-API](https://developer.valvesoftware.com/wiki/Counter-Strike:_Global_Offensive_Access_Match_History), [Valve: Release Notes](https://store.steampowered.com/news/posts/?appids=730&enddate=1693615397&feed=steam_community_announcements)

Für einen gehosteten Resolver existiert mit `node-globaloffensive` ein **inoffizieller Client für Valves CS2 Game Coordinator**. Er dokumentiert `requestGame(shareCodeOrDetails)`, verlangt eine aktive GC-Verbindung und baut auf einer Steam-Client-Sitzung auf. `node-steam-user` dokumentiert dafür unter anderem Refresh-Token oder Account-Anmeldung mit gegebenenfalls Steam Guard. Diese Sitzung ist ein anderer Zugang als OpenID oder der Game Authentication Code. Ein gehosteter Resolver müsste Anmeldung, Verbindungsabbrüche und Antwort-Timeouts betreiben; seine tatsächliche Funktionsfähigkeit und der geeignete Account sind hier nicht getestet. Das begründet keine Anforderung, Passwörter aller Teammitglieder zu sammeln. [GC-Client](https://github.com/DoctorMcKay/node-globaloffensive#requestgamesharecodeordetails), [Steam-Client-Anmeldung](https://github.com/DoctorMcKay/node-steam-user#logondetails)

### Folgerung für die nächste Ausbaustufe

Eigene Empfehlung: Zuerst FACEIT-Metadaten und Account-Zuordnung planen. Automatische Downloads erhalten einen eigenen Adapter und werden erst nach bestätigtem Zugang versprochen. Premier erhält einen getrennten Versuch für History-Cursor und GC-Auflösung; Datei-Uploads bleiben verfügbar. Gegnerberichte können vorher bereits gespielte Maps und Ergebnisse zeigen. Aussagen über Positionen, Utility und Abläufe benötigen beschaffte, analysierte Demos mit nachvollziehbaren Rundenreferenzen und sichtbarer Stichprobe. Teamname oder Turnierlink allein belegen keine Spielweise.

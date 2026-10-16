# Playbook im Spiel

Das kompakte Panorama-HUD bleibt am rechten Bildschirmrand. Oben stehen die Marke mit der aktuellen Map und rechts der Eingabezustand („Maus“ oder „Spiel“), darunter der Seitentitel und der Breadcrumb. Ein Farbstreifen oben zeigt den Granatentyp der aktuellen Liste. Es folgen neun feste Listenplätze mit Nummer, Granatenicon in Radar-Tinte (Must Know in Mint), Name, rechtsbündiger Meta (Seite oder Zähler), Statusglyphe (★ Favorit, ✓ Offiziell, „Review“) und einem Stern zum direkten Merken. Darunter Zurück/Seitenwechsel/Seitenzahl/Home, die nur sichtbar sind, wenn sie etwas bewirken; bei zwei bis fünf Seiten ersetzen Punkte die Seitenzahl. Dann eine Statuszeile zur Auswahl, während einer Aufnahme ein Countdown mit Fortschrittsbalken, und vier Beschreibungszeilen. Rückmeldungen erscheinen in der Beschreibung mit Ton: Erfolg grün, Fehler rot. Die Panelkante wird Mint, solange die Maus das Panel steuert, und rot auf Löschbestätigungen. Längere Texte werden mit Auslassungspunkten gekürzt. Gestaltung und Begründung: [Ingame-Panel: Gestaltung und UX](ingame-panel-ux.md).

## Aktivieren und Practice prüfen

Admin, Match Admin und Trainingsspieler dürfen das Panel öffnen. Trainingsspieler sehen im Web ausschließlich den Maps-Bereich mit Lineups und Favoriten. Im Spiel öffnen sie das Panel mit `.nades` und bedienen es mit der Maus, ohne Shortcuts einzurichten. Das eigenständige Nades-Training oder MatchZy Practice muss bereits aktiv sein. Nach dem Ausblenden erneut `.nades` eingeben. Die Rolle erlaubt Trainingswerkzeuge und Map-Abstimmungen, aber keine direkten Mapwechsel, Serververwaltung oder Lineup-Aufnahmen und -Bearbeitung. Player behalten ihre bisherigen Rechte ohne Panel-Zugang.

CS2- und Dashboard-Image gemeinsam aktualisieren; CounterStrikeSharp API 374+ verwenden. Im Dashboard unter **Server → Spiel → Trainings-HUD** aktivieren und mit **Apply & restart** übernehmen. Für lokale Entwicklung die Workshop-Auslieferung ausschalten und [lokale Assets bauen/installieren](../training-hud/README.md). Für Mitspieler das Workshop-Addon aktualisieren und ausliefern. Nach Layoutänderungen CS2 vollständig neu starten.

In diesem Stand starten Berechtigungsabgleich und Statusmeldungen erst beim ersten World-Update von CS2. Damit greifen sie beim Serverstart nicht auf noch uninitialisierte globale Variablen zu. Das gilt auch beim Nachladen des Plugins und auf einem leeren Server. Wird das Plugin vorher entladen, wird die wartende Initialisierung verworfen. Für diese Korrektur muss das CS2-Image aus dem aktualisierten Quellstand neu gebaut und deployed werden.

Im Nades-Modus startet Playbook sein eigenes Training ohne MatchZy. Im MatchZy-Modus funktioniert das Panel nur, wenn die geladene MatchZy-Instanz `isPractice == true` und `matchStarted == false` meldet. Dort aktiviert `.prac` das Training. Bloßes `sv_cheats 1` schaltet das Panel in anderen Modi nicht frei. Bei `.exitprac`, Competitive-Start oder MatchZy-Unload schließt es sich im MatchZy-Modus. [Modi, verfügbare Werkzeuge und Befehle](playbook.md).

Im eigenständigen Nades-Modus bietet Playbook unter Trainingswerkzeuge „Letzten Wurf wiederholen“ sowie Bot-Platzierung an. `.rethrow` oder `.rt` wiederholt die eigene zuletzt geworfene Granate, ohne den Spieler zu teleportieren. Wurfhistorie und Colored Smokes sind weiterhin nicht verfügbar.

Im Practice-Modus einem Team beitreten, spawnen und `css_training` ausführen. Ohne installierte HUD-Dateien kann das Plugin keine sichtbare Oberfläche garantieren. Einmalige Bind-Einrichtung: [Feste Keybinds](../training-hud/README.md#feste-keybinds). Freie Tastenzuweisungen und Navigation über W/S/Use sind entfernt. Bestehende Favoriten werden beim Laden alter Profile erhalten.

## Hauptmenü

1. **Granaten-Bibliothek:** Typ auswählen, dann Favoriten, Offiziell, Must Know oder Alle. „Alle“ enthält sämtliche Spieleraufnahmen auf dieser Map, auch ungeprüfte.
2. **Must Know:** direkter Einstieg in die vom Plattform-Admin ausgewählten Grundlagen dieser Map.
3. **Trainingswerkzeuge:** letzten Wurf wiederholen, zum letzten Abwurfpunkt, Position merken/laden, Granaten entfernen, Bots, Trainingshilfen, Positionsdiagnose und **Zuletzt trainiert** mit den fünf zuletzt geladenen Lineups dieser Map.
4. **Neue Nade aufnehmen:** Aufnahme starten, innerhalb von drei Minuten werfen, Wirkung abwarten, mit KP_0 zurück ins HUD und speichern. Ein automatischer Name wird vergeben; der Ersteller bleibt als Steam-ID erhalten.
5. **Favoriten:** persönlich gemerkte Granaten auf dieser Map. Die Identität ist Owner + Map + interner Name; Umbenennen des Anzeigenamens verliert keine Favoriten.
6. **Competitive-Spawns:** CT- oder T-Startposition wählen und dorthin teleportieren.
7. **Map wechseln:** eine Map vorschlagen oder in einer laufenden Abstimmung Ja/Nein wählen.
8. **Keybinds:** die festen acht Tasten und die Bind-Befehle anzeigen.
9. **Panel ausblenden:** mit KP_DEL wieder anzeigen. KP_0 wechselt zwischen Bedienung und freiem Spielen.

Im Nades- und MatchZy-Practice-Modus enthält **Bots** stehenden Bot, duckenden Bot und Bots entfernen. Im Nades-Modus sind dafür auch `.bot`, `.crouchbot` / `.cbot` und `.nobots` verfügbar. Bots spawnen im gegnerischen Team und behalten beim Respawn ihre Position und ihren Duckzustand. **Trainingshilfen** enthält Flugbahnvorschau, Einschläge, Flashschutz und God Mode. Die Beschriftung zeigt „einschalten“ oder „ausschalten“ entsprechend dem tatsächlichen Zustand. MatchZys God Mode wird anhand seiner Lebenspunkte-Logik erkannt. Gemeinsame Trainingsaktionen werden sofort ausgeführt; die Beschreibung kennzeichnet ihre Wirkung auf alle Spieler. Im MatchZy-Modus behält MatchZy seine zusätzliche Berechtigungsprüfung. Beide Implementierungen verwenden denselben Playbook-Chat-Präfix.

## Aufnahme bearbeiten, löschen und prüfen lassen

Alle Aufnahmen sind sofort für alle sichtbar. Nur der Ersteller einer noch nicht offiziellen Aufnahme sieht im Ingame-Menü **Lineup bearbeiten**, **Zum Review freigeben** und **Eigene Aufnahme löschen**. Plattform-Admins können auf der Website alle Aufnahmen löschen, auch importierte Aufnahmen mit Owner `default`, offizielle Aufnahmen und Must-Know-Lineups. Match-Admins haben diese zusätzliche Löschberechtigung nicht. Unter **Lineup-Einstellungen** bleiben nur Seite, Startposition und Endposition bearbeitbar. `abbrechen` beendet die Chat-Eingabe; nach zwei Minuten läuft sie ab.

„Zum Review freigeben“ markiert die Aufnahme als **[Review]**. Plattform-Admins finden diese über **All lineups → Review-Status → Review angefragt** und können sie freigeben oder ablehnen. Änderungen mit **Save nades** speichern. **Offiziell** kennzeichnet geprüfte Lineups; **Must Know** ist die besonders wichtige Auswahl und schaltet zugleich Offiziell ein. Nach Freigabe kann der Ersteller die Granate nicht mehr verändern oder löschen. Eine bewusste Neuaufnahme oder Änderung an Seite und Positionsnamen setzt einen alten Review-Antrag zurück; danach erneut einreichen. Kartenmarker bleiben davon unabhängig korrigierbar.

Spieleranfragen werden mit authentifizierter Steam-ID und Versionsstand über `savednades.requests` an den Dashboard-Sync übergeben. Der Sync prüft Besitzer, Freigabe und Version erneut. Eine veraltete Anfrage überschreibt keine neuere Admin-Änderung. Ohne laufenden Sync bleiben Anfragen ausstehend. Erfolg oder Ablehnung wird nach Verarbeitung im Spiel gemeldet. Zielerfassung findet ausschließlich bei einer neuen Aufnahme oder einer bewussten Neuaufnahme statt. Trainingswürfe verändern keine gespeicherten Lineups.

## Map-Abstimmung

Jeder lebende Spieler in Practice darf eine Abstimmung starten. Zur Auswahl stehen lokal vorhandene Standard-Map-VPKs und im angewendeten Dashboard konfigurierte Workshop-Maps. Mapnamen und Workshop-IDs werden geprüft; freie Befehle sind nicht zulässig.

Die Abstimmung dauert 30 Sekunden. Auch der Initiator muss ausdrücklich mit Ja oder Nein abstimmen. Es gilt `floor(Anzahl / 2) + 1`: bei vier Spielern sind drei Ja-Stimmen nötig. Gezählt werden alle beim Start verbundenen menschlichen Spieler inklusive Zuschauer, ohne Bots oder HLTV. Jeder hat eine Stimme. Spätere Beitritte stimmen nicht mit; Disconnects verkleinern den Nenner nicht, Enthaltungen sind keine Ja-Stimmen.

Abstimmen im Chat mit `.y` für Ja und `.n` für Nein, im Panel unter **Map wechseln** oder in der Konsole mit `css_training_vote yes` / `css_training_vote no`. `.mapja` und `.mapnein` bleiben als Chat-Kürzel gültig. Bei erreichter Mehrheit wird gewechselt; ohne Mehrheit bleibt die Map. Zwischen Vorschlägen liegen mindestens 60 Sekunden. Practice-Ende, Map-Ende und Plugin-Unload verwerfen die Abstimmung.

## Abnahmestand

Dieser Stand ergänzt Regressionstests für verzögerte Initialisierung, Entladen vor dem ersten World-Update und erneutes Laden. Ein Test führt die verwaltete World-Update-Warteschlange von CounterStrikeSharp aus. Diese Tests ersetzen keinen Kaltstart auf einem echten CS2-Server. Valves Panorama-Compiler und die Workshop-Auslieferung müssen auf Windows geprüft werden. Die tatsächliche Darstellung, MatchZy-Zustandsanbindung, Mapwechsel und Mehrspielerabläufe müssen auf einem Entwicklungsserver im Spiel abgenommen werden. Ein lokaler Layout-Build aktualisiert keine Server-Plugin-Funktionen.

## Architektur

`InGameMenu` verwaltet Seiten und History. `ScreenPanel` erstellt eine private `custom_hud_layout`-Entity pro offener Sitzung und setzt Texte, CSS-Klassen und Cursorzustand. `CheckTransmit` hält die Entity von anderen Spielern fern. Es gibt keine World-Text-Entities oder Kameratransformationen mehr. Eine neue Entity pro Sitzung verhindert das Wiederverwenden alter Slot-Texte in API 374. Die pro Spieler gespeicherten Werte liegen getrennt davon in `PlayerPanelSettingsStore`.

`TrainingMenu` und `PanelSettingsMenu` definieren die Inhalte; `PanelControls` prüft die Tasten und routet Maus-/Tastaturaktionen. Texte werden niemals als beliebige Serverbefehle ausgeführt. Im Nades-Modus führt Playbook die Trainingsaktionen selbst aus. Im MatchZy-Modus laufen MatchZy-Befehle weiterhin im Spieler-Kontext. Native Eingaben, Layout-Compiler und Darstellung müssen im Spiel geprüft werden; die Unit-Tests prüfen Daten, Navigation und Persistenz.

## Direkte Zifferntasten 1–9

Die Standard-Zifferntasten sind im CS2-Client Waffenslots. Für direkte Menüauswahl gibt es deshalb die optionale [nades-menu.cfg](nades-menu.cfg):

1. Eigene Zifferntasten-Binds sichern, falls vorhanden.
2. Die Datei auf deinem Gaming-PC nach `Counter-Strike Global Offensive/game/csgo/cfg/nades-menu.cfg` kopieren.
3. In der CS2-Konsole `exec nades-menu` ausführen.

Danach wählen **1–9** die neun sichtbaren Einträge. Zurück und Seitenwechsel nutzen die eigenen Buttons oder die Hotkeys aus training-menu.cfg; **Home** springt ins Hauptmenü. Außerhalb des Menüs bleiben die Standard-Waffenslots nutzbar. Der Server verändert keine Client-Binds automatisch. In der CFG stehen auch optionale Schnellzugriffe und Befehle zum Wiederherstellen der Standardbelegung.

## Training und Daten

Die Auswahl setzt die gespeicherte Standposition und Blickrichtung und stoppt vorhandene Bewegung. Ab Version **1.0.2** korrigiert das Plugin außerdem einen bekannten CS2-Teleportfehler: Der vertikale Blickwinkel kann auf den gesamten Spielerkörper übertragen werden. Das kippt das Modell und beeinträchtigt Lineups (siehe [MatchZy #393](https://github.com/shobhit-pathak/MatchZy/issues/393) und den [entsprechenden Upstream-Fix](https://github.com/sivert-io/MatchZy-Enhanced/pull/13)). Die Korrektur setzt nur Neigung und seitliche Drehung des Körpers auf null. Blickrichtung, horizontale Körperdrehung und gespeicherte Position bleiben erhalten; die Bibliothek wird nicht verändert.

Beim erfolgreichen Laden wird normale Laufbewegung aktiviert und Noclip beendet. Das ist relevant, weil MatchZy `.savenade` mit einem Z-Aufschlag von 4 Units speichert: Ohne Schwerkraft im Noclip bleibt die Figur dort in der Luft. Vor dem Wurf kurz landen lassen. Das bloße Schließen eines Menüs ohne Laden behält weiterhin den vorherigen Bewegungsmodus bei.

Fehlt die passende Granate im Inventar, gibt das Plugin sie dem Spieler und wählt den Granaten-Slot aus. Bei Molly-Lineups verwendet es für CTs eine Incendiary und für Ts einen Molotov. Im Chat erscheint der erkannte Ablauf, etwa „Stehend ausrichten → W halten → Nach 0,44 s (73 Units) Linksklick loslassen und gleichzeitig springen“; ohne aufgezeichnete Spur die gespeicherte Beschreibung. `.nades last` setzt dich erneut an den Lineup-Punkt.

Solange MatchZy Practice aktiv ist, prüft das Plugin in jedem Tick die Körperneigung lebender Spieler beider Teams. Dadurch greift die Korrektur auch nach MatchZys `.loadnade`, `.last` und `.loadpos`, ohne dessen DLL zu verändern. Spieler mit einer übergeordneten Scene-Node werden ausgelassen. Bei bereits aufrechten Spielern wird kein Zustand geschrieben. `.nades check` zeigt Position, beide Bewegungsmodi sowie Blick- und Körperwinkel für die Fehlersuche. Das vorhandene MatchZy-Format speichert den Duckzustand nicht; bei Duck-Lineups muss weiterhin selbst geduckt werden.

Der eigentliche Wurf wird von dir ausgeführt. Die vorhandenen MatchZy-Daten enthalten Position, Winkel, Typ und Beschreibung, aber keine vollständige Abfolge von Laufbewegung, Ducken, Sprung oder Wurfstärke. Das Menü spielt deshalb keine automatischen Beispielwürfe ab. Bei **Ohne Typ** musst du die Granate selbst wählen; den Typ kannst du im Dashboard nachtragen. MatchZys Flugbahnvorschau und Practice-Funktionen bleiben nutzbar.

Sichtbar sind alle gültigen Aufnahmen der aktuellen Map, unabhängig vom Owner. Der Owner bleibt für Bearbeitungsrechte und Favoriten erhalten. Eine Aufnahme mit Review-Antrag trägt [Review]; Offiziell und Must Know werden zusätzlich in eigenen Sammlungen angeboten.

Bei jedem Öffnen, unmittelbar vor dem Laden und alle zwei Sekunden bei offenen Sitzungen liest das Plugin die Bibliothek. Änderungen im Dashboard erscheinen nach dem bestehenden Live-Sync automatisch. Das Menü behält seine ausgewählte Granate anhand von Owner, Map und internem Namen, auch nach Umbenennung oder Umsortierung. Verschwindet ein geöffnetes Lineup, geht es zur zugehörigen Kategorie zurück; leere Seiten werden abgefangen. Die Keybind-Hilfeseite wird nicht neu aufgebaut. Bei vorübergehend unlesbaren Dateien bleibt das letzte gültige Menü erhalten. Gelöschte, auf andere Maps verschobene Einträge werden beim Laden abgewiesen. Defekte Einzelzeilen werden übersprungen; bei einer unlesbaren Datei erscheint eine Fehlermeldung. Bearbeitungen laufen über die geprüfte Anfragewarteschlange des Dashboard-Syncs.

## Anzeigenamen und automatische Zielerfassung (1.2.0)

Den Anzeigenamen vergibt der Ersteller beim Speichern einer neuen Aufnahme, beispielsweise `Fenster-Smoke vom T-Spawn`. Website, Karten-Tooltip, Kategorien, Detailseite und Ladebestätigung verwenden diesen Titel. Die interne `id` und der MatchZy-Schlüssel `name` bleiben erhalten; `.loadnade window_smoke` lädt ausschließlich zum Training. Anzeigename und automatisch gemessene Wurfdaten lassen sich anschließend im Web nicht bearbeiten.

Eine Aufnahme startet über **Neue Nade aufnehmen → Aufnahme starten** oder `.nades save`. Bestehende Würfe lassen sich ausschließlich über **Lineup bearbeiten → Wurf neu aufnehmen** bewusst ersetzen. Das Laden oder Wiederholen eines gespeicherten Lineups aktiviert keine Zielerfassung.

1. Practice einschalten, `.nades save` in den Chat eingeben und die Chat-Bestätigung abwarten.
2. In den nächsten drei Minuten den gewünschten Wurf ausführen: Jumpthrow, Duckthrow, Duck-Setup mit anschließendem Aufstehen, Walkthrow oder Anlauf mit normalem Wurf.
3. **Wurf erkannt** bestätigt Typ und Abwurf. Bei der Smoke-Entstehung, Flash-/HE-Explosion, Molotov-Zündung oder Decoy-Aktivierung meldet der Server **Ziel erfasst** und fragt danach im Chat nach einem Titel. Zum Abbrechen `abbrechen` schreiben.
4. Den gewünschten lesbaren Titel eingeben, zum Beispiel `Mirage Fenster Smoke vom T Spawn`. Das Plugin erstellt daraus einen technischen `.loadnade`-Namen, verwendet die Steam-ID des Erstellers als Owner und legt den Eintrag in der Dashboard-Bibliothek ab. Der Dateisync stellt ihn auch MatchZy und dem Ingame-Menü bereit.

Während die Aufnahme bereit ist, protokolliert das Plugin maximal die letzten acht Sekunden vor dem Wurf: Position, Geschwindigkeit, Blickrichtung und gedrückte Tasten etwa alle 0,03 Sekunden. Der Landepunkt stammt aus den Spielereignissen. Aus dieser Eingabespur wird der Wurf in drei Schritte zerlegt:

1. **Lineup:** Das Ende des letzten Stillstands (mindestens 0,2 Sekunden) vor dem Loslassen, mit Haltung (stehend oder hockend) und Blickrichtung. Bei Würfen aus dem Stand ist das der Abwurfpunkt, bei Jumpthrows der Boden vor dem Sprung.
2. **Bewegung:** gehaltene Tasten (W, A, S, D und Kombinationen), Tempo (laufen, mit Shift schleichen, hockend), Dauer und Strecke bis zum Loslassen, ein Haltungswechsel (aufstehen oder ducken). Weniger als 24 Units Strecke gelten als Schrittwurf („antippen“).
3. **Abwurf:** die während des letzten Drucks überwiegend gehaltene Maustaste, die Haltung beim Abwurf und das Sprung-Timing: gleichzeitig (höchstens 0,12 Sekunden Abstand), vorher in der Luft oder danach.

`lineupPos` und `lineupAng` sind dieser Lineup-Punkt; `.loadnade`, die Abwurfsicht und der Startmarker auf dem Radar verwenden ihn. Nach einem Anlauf oder Sprung speichert das Dashboard den tatsächlichen Abwurf zusätzlich als `releasePos` und `releaseAng`. Das Radar zeigt dann den Anlauf als durchgezogene Linie und den Flug gestrichelt ab dem Abwurfpunkt. Steht der Werfer vor dem Anlauf nicht still, bleibt der Abwurfpunkt gespeichert, und die Anleitung weist darauf hin.

Die Lineup-Seite zeigt die drei Schritte, etwa „Stehend ausrichten · W halten · Nach 0,44 s (73 Units) Linksklick loslassen und gleichzeitig springen“, und darunter eine Tastenfolge relativ zum Loslassen. Im Panel stehen sie unter **Ablauf ansehen** und in der Chatmeldung beim Laden. Dieselben Regeln sind im Plugin (`ThrowMotion.cs`) und im Dashboard (`shared/throw-motion.ts`) umgesetzt; beide prüfen dieselben Testfälle in `server-plugin/Playbook.Tests/Fixtures/throw-motion.json`. Die vollständige Spur bleibt unter **Aufgezeichnete Tasten und Bewegung** einsehbar. Körperpose oder Sprunghöhe als echte Animation werden nicht aufgezeichnet.

Bestehende Aufnahmen wurden beim ersten Start dieser Version einmalig aus ihrer Spur umgestellt. Vorher fehlende Wurfattribute wurden ergänzt; gespeicherte Attribute bleiben unverändert, auch wenn die Spur etwas anderes zeigt. Der vorherige Stand liegt in MongoDB unter `nades` mit der ID `before-throw-setup-v1`.

`.nades save` gilt für einen Wurf pro Aufnahme und läuft nach drei Minuten ab. Ein Spieler muss bis zur Detonation verbunden sein. Wenn **Wurf erkannt** fehlt, Practice aktivieren und genau eine Smoke, Flash, HE, Molotov/Incendiary oder Decoy werfen. Der Server nimmt zum Zeitpunkt des Wurfs die tatsächliche Spielerposition und Blickrichtung auf; MatchZys Namensspeicher wird nicht als Eingabe missbraucht. Nach der Chat-Namenseingabe zieht das Dashboard die Datei automatisch ein. Bereits geöffnete Karten- und Detailansichten übernehmen neue Daten automatisch ohne Neuladen.

Startposition und Blickwinkel werden während der Aufnahme direkt am echten Abwurf erfasst. Das Ziel stammt aus dem Smoke-Effekt, der Flash-/HE-Explosion, der Molotov-Zündung oder der Decoy-Aktivierung. Fehlende Endkoordinaten lassen sich aus Position und Blickwinkel allein nicht zuverlässig rückwirkend rekonstruieren; dafür das Lineup bewusst neu aufnehmen. Disconnect, Runden-/Mapwechsel oder Training-Ende verwerfen offene Erfassungen. Der Tod nach dem Abwurf unterbricht die Messung nicht. Synthetische Rethrows ohne echten Spielerwurf aktivieren keine Erfassung.

### Einstellungen und Wurfattribute im Panel (2.2.0)

Unter **Alle → Aufnahme → Lineup-Einstellungen** sind die gespeicherten Wurfdaten für alle lesbar. Nur der Ersteller einer noch nicht offiziellen Aufnahme kann Seite und Positionsnamen im Chat ändern. Flugzeit, Granatentyp, Blickwinkel, Spielkoordinaten, Maustaste und Wurfattribute bleiben fest gespeichert. Dasselbe gilt im Web: Nur Startposition, Endposition und Seite lassen sich ändern. Kartenmarker bleiben unabhängig davon für Ersteller und Plattform-Admins korrigierbar, auch bei offiziellen Aufnahmen; dabei bleiben Wurfdaten und Freigaben erhalten.

| Einstellung | Chat-Eingabe |
| --- | --- |
| Seite | `ct`, `t` oder `beide` |
| Startposition / Endposition | Freier Name, etwa `T-Spawn` oder `Fenster`; `-` leert den Namen |

**Lineup laden & trainieren**, `.loadnade` und wiederholte Trainingswürfe verändern keine gespeicherten Daten. Soll ein besserer Wurf dasselbe Lineup ersetzen, wählt der Ersteller **Lineup bearbeiten → Wurf neu aufnehmen**. Der Server lädt den bisherigen Startpunkt; danach können Position und Wurf bewusst angepasst werden. Der nächste echte Wurf misst Start, Blickwinkel, Wurfattribute, Endposition und Flugzeit vollständig neu. Im selben Menü anschließend **Aufnahme speichern** oder **Aufnahme verwerfen** wählen. Diese Aktionen sind auch unter **Neue Nade aufnehmen** erreichbar. Bis zum Speichern bleibt der bisherige Wurf erhalten. Das Speichern ersetzt alle Wurfdaten gemeinsam und setzt Review sowie die bisherigen Medien zurück. Bei einer zwischenzeitlichen Änderung oder Freigabe wird die Ersetzung abgelehnt und im Spiel gemeldet.

Neue Aufnahmen benötigen gültige Endkoordinaten und eine gemessene Flugzeit. Die Messung verwendet den Zeitpunkt des erfassten echten Wurfs und dessen Wirkung; sie bleibt auch bei vertauschter Reihenfolge von Projektil- und Wurfereignissen eindeutig. Ein bereits abgeworfener Wurf wird auch nach dem Tod des Werfers zu Ende gemessen. Langsam wirkende Dropper-Smokes behalten ihre Zuordnung bis zu drei Minuten. Disconnect, Mapwechsel und Training-Ende verwerfen die Erfassung. Die kompakte Darstellung mit neun Listenplätzen pro Seite gilt weiterhin.

Neue Aufnahmen speichern `is_jumpthrow`, `is_crouch`, `is_walking`, `is_running` und `is_stepping` als Booleans sowie `click_type` als `left`, `right` oder `both`. Sie folgen aus den drei Schritten oben: Eine Bewegung zwischen Lineup und Loslassen mit 4 bis unter 24 Units Strecke ist ein Schrittwurf, mit Shift oder hockend Gehen, sonst Laufen. Ohne Bewegung gilt Stand. CS2 meldet Shift als Taste `Speed`. Geduckt beschreibt die Haltung beim Abwurf, Jumpthrow einen Sprung, der das Loslassen umschließt oder bis zum Abflug der Granate beginnt. Alte widersprüchliche Bewegungsattribute werden beim Einlesen mit Vorrang für Schrittwurf, dann Gehen, dann Laufen auf eine Auswahl reduziert. Für die Maustaste zählt die Kombination, die während des letzten Drucks am längsten gehalten wurde; kurzes Loslassen einer der beiden Tasten zählt nicht. Diese Erkennung kann im Panel und auf der Website korrigiert werden. Alte Aufnahmen ohne Attribute werden im Panel als offen angezeigt.

`flightDuration` enthält automatisch gemessene Sekunden vom echten `grenade_thrown` bis zur Explosion, Smoke-Entstehung, Molotov-Zündung oder Decoy-Aktivierung. Gemessen wird mit der Server-Simulationszeit. Diese Zeit erscheint im Panel und in den Lineup-Details der Website. Ersteller können sie bei eigenen, noch nicht offiziellen Aufnahmen dort ändern oder leeren. Eine manuelle Website-Erstellung unterstützt ebenfalls die Eingabe. Eine neue Messung ersetzt den alten Wert. Bei geänderter Startkoordinate, Blickrichtung oder geändertem Granatentyp entfällt die alte Messung bis zum nächsten Wurf. Mehrere gleichzeitig fliegende Projektile werden über ihre Entity-ID getrennt. Fehlt eine eindeutige Zuordnung, wird keine Zeit erfunden. Bei Molotov-Ereignissen ohne Entity-ID bleibt die Zeit offen, wenn mehrere passende Würfe desselben Spielers in der Luft sind.

Im eigenständigen Nades-Training meldet Playbook außerdem die Flugzeit, Blenddauer pro getroffenem Spieler sowie den tatsächlichen Granatenschaden und verbleibende HP im Chat. Das gilt auch für Trainingsbots als Ziele und für Schaden durch die Molotov-Feuerfläche. Blenddauer und Schaden sind Rückmeldungen des jeweiligen Versuchs und hängen von Position, Blickrichtung und Schutz der Ziele ab. Sie werden nicht als feste Lineup-Attribute gespeichert. In MatchZy Practice zeigt MatchZy diese Rückmeldungen bereits an; Playbook misst die Flugzeit weiter, ohne die Chatmeldungen zu verdoppeln. Verwendete Server-Events: [Blendung](https://docs.cssharp.dev/api/CounterStrikeSharp.API.Core.EventPlayerBlind.html), [Schaden](https://docs.cssharp.dev/api/CounterStrikeSharp.API.Core.EventPlayerHurt.html).

### Automatische Kartenmarker

Die Kartenansicht gruppiert nahezu gleiche Zielpositionen innerhalb von 1 % der längeren Bildkante. Dadurch bleiben benachbarte Landepunkte wie die einzelnen Smokes einer Outside Wall getrennt sichtbar. Nahe Startpositionen verwenden weiterhin 3,5 %. Alle Punkte einer Gruppe müssen untereinander innerhalb des jeweiligen Radius liegen; eine Kette benachbarter Positionen wird nicht zu einem großen Marker zusammengefasst. Die Gruppierung verändert keine gespeicherten Wurf- oder Kartenkoordinaten.

Die mitgelieferten CSNADES-Bilder sind unterschiedlich zugeschnitten. Für 23 mitgelieferte Karten ist deshalb eine feste, gegen das jeweilige Spielradar geprüfte Umrechnung hinterlegt. Sie benötigt keine manuelle Referenz und wird durch vorhandene Marker nicht verändert. Die übrigen Karten verwenden gespeicherte manuelle Marker mit zugehörigen Weltkoordinaten als Kartenreferenzen. Dafür werden mindestens zwei genaue Referenzpunkte benötigt, die **in beiden Achsen** auseinanderliegen (mindestens 256 Welt-Units und 10 % der Bildbreite/-höhe). Am besten zwei weit auseinanderliegende **Startpositionen** von gespeicherten Lineups auf der Karte markieren. Alternativ kann eine Route mit bekanntem Start und gemessenem Ziel als Referenz dienen. Anschließend Lineups speichern.

| Karten | Automatische Positionen |
| --- | --- |
| Mirage, Dust II, Nuke, Inferno, Ancient, Anubis, Cache | Fest kalibriert, ohne manuelle Referenzen |
| Overpass, Train, Vertigo, Office, Italy | Fest kalibriert, ohne manuelle Referenzen |
| Baggage, Shoots, Shoots (Nacht), Ancient (Nacht), Shelter, Boulder, Debris, El Dorado, Fachwerk, Poseidon, Training | Fest kalibriert, ohne manuelle Referenzen |
| Agency, Grail, Jura, Thera, Mills, Contact | Manuelle Referenzen erforderlich; verlässliche Overview-Koordinaten fehlen in der verwendeten Quelle |
| Pool Day | Kein Radarbild hinterlegt; Aufnahmen sind in der Liste verfügbar |

Die Kalibrierungen gelten nur für die hinterlegten Bildpfade und Bildgrößen. Eigene oder ausgetauschte Kartenbilder brauchen eigene Referenzen. Die Abgleichsdaten mit Bildprüfsummen und unabhängigen Bildpunkten liegen in `admin-panel/test/radar-calibration-evidence.ts`. Mit `pnpm run build:server` und anschließend `python tools/calibrate-radars.py --write` im Verzeichnis `admin-panel` lässt sich der Abgleich gegen die [extrahierten CS2-Radars und Overview-Daten](https://github.com/MurkyYT/cs2-map-icons) wiederholen. Das Werkzeug benötigt Python, NumPy und OpenCV; der Betrieb der Website benötigt diese Pakete nicht.

Train, Vertigo und Boulder bilden beide Ebenen im vorhandenen Einzelbild ab. Die Umrechnung wählt je nach Höhe die passende Bildposition, für Start und Ziel getrennt. Baggage hat zusätzlich eine untere Radaransicht; der vorhandene Umschalter `1`/`2` wählt die Ebene. Die Höhengrenzen stammen aus den Overview-Daten: Train `−50`, Vertigo `11700`, Boulder `62,757324` und Baggage `−5`. Manuelle Kartenmarker behalten ihre XY-Positionen.

Aus diesen Referenzen werden neue Start- und Zielmarker automatisch abgeleitet. Bereits vorhandene manuelle Marker haben Vorrang. **Automatische Positionen** entfernt die manuellen Marker des bearbeiteten Lineups; die Referenz-Lineups sollten ihre Marker behalten. Bei widersprüchlichen Referenzen, fehlenden Koordinaten oder Punkten außerhalb des Bildes wird kein automatischer Marker erfunden. Die vorhandenen gebogenen Verbindungslinien zeigen nur die Richtung, keine aufgezeichnete Flugbahn. Start-/Zielbezeichnungen wie `T Spawn` bleiben optionale Texte.

**Nuke:** Die Website zeigt jeweils eine Ebene in voller Breite. Der kompakte Umschalter rechts oben wählt `1` (obere Ebene) oder `2` (untere Ebene). Auf der Karte erscheinen nur die Marker der ausgewählten Ebene; die Liste enthält weiterhin alle passenden Aufnahmen. Eine ausgewählte Position bleibt beim Ebenenwechsel erhalten, sodass Gegenpositionen auf der anderen Ebene erreichbar sind. Verbindungslinien werden nur zwischen Positionen derselben sichtbaren Ebene gezeichnet. Beide mitgelieferten Bilder sind fest kalibriert; manuelle Referenzen sind dafür nicht erforderlich. Start und Ziel werden unabhängig voneinander anhand ihrer gespeicherten Z-Koordinate zugeordnet: unter `−495` auf die untere Ebene, ab `−495` auf die obere. Damit werden auch Würfe zwischen Ebenen dargestellt. Diese Grenze stammt aus den [aktuellen CS2-Overview-Daten](https://github.com/MurkyYT/cs2-map-icons/blob/main/data/radar_info/de_nuke.txt). Das Verfahren folgt dem Prinzip der höhenabhängigen Kartenabschnitte in [Boltobserv](https://github.com/boltgolt/boltobserv/blob/master/src/renderers/_global.js) und den höhenabhängigen Ebenen im [Lexogrine-HUD](https://github.com/lexogrine/cs2-react-hud/blob/main/src/HUD/Radar/LexoRadar/maps/index.ts); deren Code und Assets werden nicht übernommen.

Die Nuke-Bilder stammen von CSNADES: [obere Ebene](https://assets.csnades.gg/nuke_game_radar_9276ffd1a4.webp), [untere Ebene](https://assets.csnades.gg/nuke_game_radar_lower_b42d4863bf.webp). Die Bildregistrierung gegen die [extrahierten Spielradars](https://github.com/MurkyYT/cs2-map-icons/tree/main/images/radars) ergibt für die obere Ebene 15 übereinstimmende Merkmale mit maximal 3,36 Pixeln Achsenabweichung, für die untere neun mit maximal 2,35 Pixeln. Die daraus abgeleiteten Transformationen stehen in `nade-radar.ts` und gelten nur für diese Bilder mit je 1558 × 848 Pixeln. Ausgetauschte Nuke-Bilder werden nicht mit dieser Kalibrierung projiziert.

Manuelle Nuke-Marker behalten ihre bisherigen normierten XY-Koordinaten relativ zum jeweiligen Einzelbild. Bei alten Markern ohne Ebenenangabe wird nur die Ebene aus der Höhe ergänzt. Ein Klick im Positionierungseditor speichert zusätzlich `level: "upper"` beziehungsweise `level: "lower"`; so lässt sich die Ebene bei Übergängen, Schächten oder in der Luft explodierenden Granaten manuell korrigieren. „Automatische Positionen“ entfernt diese manuellen Korrekturen. Ohne gemessene Zielkoordinaten wird weiterhin kein automatischer Zielmarker angezeigt.

Andere Kartenbilder müssen nordorientiert sein und einen einheitlichen Maßstab pro Achse haben. Nach Austausch eines Kartenbildes die Referenzen neu setzen.

### Daten und Kompatibilität

`savednades.json` behält MatchZys Owner-/Namensstruktur. `DisplayName` und `LandingPos` werden als optionale Strings exportiert; Kartenmarker und Bilder bleiben im Panel. Zusätzlich schreibt das Dashboard `cfg/MatchZy/savednades.metadata.json`, damit Anzeigenamen auch nach MatchZy-Schreibvorgängen erhalten bleiben. Das Plugin schreibt ausschließlich seine atomare `savednades.captures.json` mit den vollständig gemessenen neuen Aufnahmen (bis zu 2000 Lineups), niemals MatchZys Bibliothek. Der Panel-Sync liest diese Datei auch dann, wenn `savednades.json` unverändert ist.

Jede Messung enthält Owner, Map, technischen Namen, Startposition, Blickwinkel, Endposition, Wurfattribute und Flugzeit. Bestehende Aufnahmen werden ausschließlich durch eine ausdrücklich angeforderte, vollständige Neuaufnahme mit passendem Versionsstand ersetzt. Gewöhnliche Trainingsmessungen und veraltete MatchZy-Snapshots überschreiben keine Wurfdaten. Der Sync stellt den gespeicherten Stand auch in der Spielbibliothek wieder her. Neue Aufnahmen verwenden `savednades.captures.json`; bewusste Ersetzungen laufen über `savednades.requests` mit dauerhafter Verarbeitungsquittung und Rückmeldung im Spiel.

Die Webansicht empfängt Änderungen über `/api/nades/events` direkt nach der Datenbank-Speicherung. Neue Aufnahmen, Änderungen, Reviews und Löschungen erscheinen ohne Neuladen in Kartenübersicht, Details und Review. Die vorhandene Dateisynchronisation vom Spielserver läuft standardmäßig alle zwei Sekunden. Nach einer unterbrochenen Verbindung liefert der Ereignisstrom den vollständigen aktuellen Stand. Offene Eingaben bleiben erhalten; ein zwischenzeitlich geänderter Versionsstand verhindert veraltetes Speichern.

Für die fest kalibrierten Karten aus der Tabelle oben werden neue Endpositionen auch ohne vorherige manuelle Referenzen eingezeichnet. Die Anubis-Kalibrierung berücksichtigt den Zuschnitt des Kartenbildes anhand des [extrahierten Spielradars und seiner Overview-Daten](https://github.com/MurkyYT/cs2-map-icons/blob/main/data/radar_info/de_anubis.txt). Manuelle Marker behalten für das jeweilige Lineup Vorrang, verändern aber nicht die feste Kalibrierung für weitere Aufnahmen. Bei Karten ohne feste Kalibrierung gelten die oben beschriebenen Referenzen.

Dashboard- und CS2-Image neu bauen und deployen. Ein Ingame-Test mit mindestens zwei Spielern, mehreren gleichzeitig fliegenden Granaten und einer in der Luft explodierenden Flash bleibt erforderlich; Unit-Tests ersetzen die nativen CS2-Ereignisse nicht. API-Referenzen: [Smoke-Effekt](https://docs.cssharp.dev/api/CounterStrikeSharp.API.Core.EventSmokegrenadeDetonate.html), [Flash-Explosion](https://docs.cssharp.dev/api/CounterStrikeSharp.API.Core.EventFlashbangDetonate.html), [echter Spielerwurf](https://docs.cssharp.dev/api/CounterStrikeSharp.API.Core.EventGrenadeThrown.html).

## Prüfen

```sh
dotnet test server-plugin/Playbook.Tests/Playbook.Tests.csproj --configuration Release
docker build -f cs2/Dockerfile --target nades-tests .
```

Die automatischen Tests prüfen das MatchZy-Dateiformat, Map-Filter und Besitzerrechte, doppelte Namen verschiedener Owner, Koordinaten, Granatentypen, Pagination, Navigationshistorie, leere Kategorien, Practice-Sperren, Löschbestätigung, feste Keybinds, Practice-Zustand, Review-Versionierung, Mehrheiten und Befehlszuordnung, sichere Textdarstellung und Statusdateien. Die native Körperrotation, Panorama-Darstellung und deren private Übertragung, MatchZy-Berechtigungen und echten Spielereingaben brauchen zusätzlich einen CS2-Client; diese Tests belegen den Ingame-Fix nicht.

Ab Plugin **1.0.2** ein Lineup mit steilem Blickwinkel nach oben oder unten nahe einer Wand über `.nades`, `.nades last` und MatchZys `.loadnade` laden. Auch `.last` und `.loadpos` prüfen. In Ego-Perspektive und mit einem zweiten Spieler kontrollieren, dass der Körper aufrecht bleibt und die Zielrichtung stimmt. `.nades check` muss für die Neigung und seitliche Drehung des Körpers null anzeigen, während der Blickwinkel erhalten bleibt. Ein Lineup nach aktivem Noclip über `.nades` laden und normales Landen/Bewegen prüfen. Nach dem Update das CS2-Image neu bauen und im Dashboard die Plugin-Version kontrollieren.

Für die neue HUD-Abnahme die [Ingame-Prüfliste](../training-hud/README.md#abnahme-im-spiel) verwenden. Zusätzlich Lineups mit privaten Einträgen, MatchZy-Berechtigungen, leere Bibliothek und Practice-Wechsel prüfen.

Die verwendeten API-Einstiegspunkte sind in den offiziellen CounterStrikeSharp-Quellen dokumentiert: [Spieleraktionen und HTML-Ausgabe](https://github.com/roflmuffin/CounterStrikeSharp/blob/main/managed/CounterStrikeSharp.API/Core/Model/CCSPlayerController.cs). Dateiformat und Slot-Auswahl entsprechen [MatchZys PracticeMode](https://github.com/shobhit-pathak/MatchZy/blob/main/PracticeMode.cs).

## Lineups im Dashboard löschen

In der Map-Galerie und unter **All lineups** entfernt **Delete** nach Bestätigung einen Eintrag aus dem Entwurf. Erst **Save lineups** bzw. **Save nades** schreibt die Änderung auf den Server. Das offene Ingame-Menü übernimmt sie automatisch. Bereits verarbeitete Aufnahme-IDs werden in `savednades.capture-receipts.json` neben der Bibliothek gespeichert, damit alte `savednades.captures.json`-Dateien gelöschte Einträge auch nach einem Neustart nicht wieder anlegen. Eine neue Aufnahme mit neuer ID bleibt möglich. Speichern und Sync-Polling laufen im Dashboard nacheinander, damit sie sich nicht gegenseitig überschreiben.


## Competitive-Spawns (1.9.0)

Im Hauptmenü **Competitive-Spawns → CT-Spawns / T-Spawns → Spawn** wählen. Das Plugin liest die `info_player_counterterrorist`- und `info_player_terrorist`-Entities direkt aus der geladenen Map. Es verwendet pro Seite die aktivierten Punkte mit dem kleinsten numerischen Prioritätswert, entsprechend dem Grundprinzip in [MatchZys Spawn-Erfassung](https://github.com/shobhit-pathak/MatchZy/blob/main/PracticeMode.cs). Die beiden Teams werden getrennt ausgewertet, damit auch unterschiedliche Prioritäten auf Custom-Maps funktionieren. Es wird keine feste Anzahl von fünf Spawns vorausgesetzt.

Die Nummerierung folgt den Entity-Indizes der geladenen Map. Der Teleport prüft den Spawn erneut, setzt Position und Blickrichtung, stoppt Bewegung und beendet Noclip. Er ist nur für lebende Spieler im Training verfügbar und ändert nicht das Team. Besetzte oder inzwischen deaktivierte Spawnpunkte werden mit einer Meldung abgewiesen. Die tatsächlichen Teleports müssen im laufenden CS2 auf den verwendeten Maps geprüft werden.

## Map-Katalog und Abstimmung ab 1.9.0

Dashboard und Server-Plugin gemeinsam aktualisieren. `css_plugins list` muss **Playbook 2.3.0** anzeigen; die früheren Korrekturen hatten noch dieselbe Versionsnummer 1.8.0.

Das Dashboard schreibt den gemeinsamen Katalog als `map-catalog.json` neben die angewendeten Einstellungen. Das Plugin ermittelt installierte VPK-Maps und aktivierte Workshop-IDs und veröffentlicht `savednades.maps.json` neben der Granatenbibliothek. Nach **Refresh** verwendet der Web-Atlas genau diese Kategorien und Verfügbarkeiten. Ohne Serverbestand kennzeichnet die Website die Ladbarkeit als unbestätigt.

- **Active Duty:** Mirage, Dust II, Nuke, Inferno, Ancient, Anubis, Cache (Valve Season Five).
- **Reserve & Community:** die bisherigen Reserve-/Community-Referenzen, sofern auf dem Server vorhanden oder als aktivierte Workshop-Version hinterlegt.
- **Others:** weitere installierte Maps und sonstige konfigurierte Workshop-Maps.
- **Nicht verfügbar:** Katalogeinträge ohne installierte oder aktivierte Workshop-Version; vorhandene Lineups bleiben erhalten.

Vanity-, Workshop-Vorschau-, Grafiktest- und Lobby-Kulissen erscheinen nicht als ladbare Maps. Das Ingame-Menü startet eine 30-sekündige Ja/Nein-Abstimmung. Der Vorschlagende hat keine automatische Stimme; auch allein muss er ausdrücklich zustimmen. Für lebende Spieler wird die Abstimmungsseite im HUD eingeblendet, ohne freies Zielen zu sperren. Mit KP_0 kann man sie bedienen; Zuschauer stimmen im Chat mit `.y`/`.n` ab. Ein administrativer RCON-Mapwechsel auf der Website bleibt ein direkter Admin-Befehl.

Review-Anfragen verwenden stabile IDs für identische Änderungen. Das Dashboard hält Verarbeitungsbelege unter `savednades.requests/processed` vor, damit eine übrig gebliebene Anfrage nicht nochmals ausgeführt wird. Benachrichtigungen hängen nicht davon ab, ob der Spielprozess eine vom Dashboard erzeugte Ergebnisdatei löschen darf.

Zusätzliche Radaransichten für Baggage, Shoots, Shoots (Nacht), Ancient (Nacht), Shelter, Boulder, Debris, El Dorado, Fachwerk, Poseidon und Training stammen aus den extrahierten Valve-/Map-Autoren-Assets unter https://github.com/MurkyYT/cs2-map-icons/tree/main/images/radars (abgerufen am 30.09.2026). Sie liegen unverändert als PNG unter `admin-panel/client/public/maps`; jeweils die Hauptansicht, keine automatische Ebenenauswahl. Für Pool Day wurde dort keine Radaransicht gefunden; hier bleibt die neutrale Darstellung. Vorhandene CSNADES-Radare bleiben unverändert.

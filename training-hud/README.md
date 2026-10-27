# Playbook Trainings-HUD

Das Layout ist ein einziges Panorama-Panel, rechts und vertikal mittig am Bildschirm. Es wird vom Client gerendert und hat keine Verbindung zu Weltposition oder Kamerabewegung. `ScreenPanel` überträgt ausschließlich Inhalte, Auswahl und Fokus. Navigation ist per Maus sowie festen Console-Binds möglich.

Admin, Match Admin und die Rolle **Trainingsspieler** öffnen es im eigenständigen Nades-Training oder in MatchZy Practice per `.nades`. Die Mausbedienung braucht keine Binds. Trainingsspieler sehen im Web nur Maps und Lineups; sie dürfen den Server nicht verwalten und keine Lineups ändern. Shortcuts sind freiwillig und müssen lokal gesetzt werden.

Das bestehende Workshop-Item ist **3810441722**. Auf Windows im Projekt-Root [hud.cmd](../hud.cmd) doppelklicken: Das Skript lädt den aktuellen Git-Stand, baut und installiert das lokale Panorama-Panel, testet und baut die Electron-App und öffnet anschließend die frisch gebaute Playbook-Version. Der Standardaufruf benötigt keinen Installer und keine Workshop-Rückfrage. Ein Workshop-Release erfolgt separat mit `hud.cmd -Mode release`. Einrichtung und Workshop Manager als Alternative sind in der [Veröffentlichungsanleitung](workshop-release.md) beschrieben. Rollen und Panel-Funktionen kommen aus dem Server-Plugin; ein Workshop-Upload allein aktualisiert diese nicht.

## Aktuelle Anzeige

Neun feste Listenplätze ohne Zeilennummern und ohne Mengenzähler rechts. Seitenpunkte beziehungsweise bei mehr als fünf Seiten die Seitenzahl stehen ausschließlich in der Navigation. Über der Beschreibung erscheinen nur fachliche Statusangaben, keine erneute Anzahl der Einträge oder Seiten. Tasten-Chips, Seitenangaben wie CT/T und Review-Status bleiben sichtbar.

## Aufbau ab Plugin 1.8.0

Mittige Überschrift, engere Breadcrumb und neun feste Listenplätze, Zurück/Seitenwechsel/Seitenzahl/Home sowie drei Beschreibungszeilen. Footer-Hinweise und Modusindikator sind entfernt. Die Bibliothek und Zustände werden alle zwei Sekunden aktualisiert. Die ausgewählte Granate bleibt bei Änderungen möglichst erhalten. Das Panel ist im eigenständigen Nades-Training und im tatsächlichen MatchZy-Practice-Modus verfügbar.

Für die Playbook-Überschrift die aktuellen Assets auf Windows neu kompilieren. Plugin und Workshop-Addon gemeinsam aktualisieren und CS2 danach ganz neu starten. Die Ingame-Abnahme der eigenständigen Trainingsfunktionen steht noch aus.

## Stand und Voraussetzungen

Die Quellen heißen `playbook_training.xml` und `playbook_training.css`; der Build verwendet das Addon `playbook_training_hud`. Plugin 2.4.0 benötigt diese neu kompilierten Assets. Die frühere lokale Anzeige wurde bereits im CS2-Client geprüft. Für die umbenannten Assets stehen der echte Windows-Build, die Workshop-Auslieferung und die Mehrspieler-Abnahme noch aus. [Umstieg bestehender Installationen](../docs/migration-playbook.md) und [Workshop-Release](workshop-release.md).

- CounterStrikeSharp API **374** oder neuer, passendes Metamod und aktuelles CS2.
- Zum Bauen: CS2 Workshop Tools mit `game/bin/win64/resourcecompiler.exe`.
- Zum Verteilen an Mitspieler: lokales HUD-Paket oder eigenes Workshop-Addon und kompatibler MultiAddonManager. Die Spieler brauchen keine Workshop Tools.

## Bauen und installieren

Auf dem Mac entwickeln und pushen. Auf Windows CS2 beenden und im Projektordner `hud.cmd` doppelklicken. Alternativ in Git Bash:

```bash
./hud.sh
```

Beim ersten Aufruf wird das CS2-Verzeichnis erkannt oder abgefragt und lokal gespeichert. Git, PowerShell 7, Node.js 22 oder neuer einschließlich npm, .NET 10 SDK und CS2 Workshop Tools müssen installiert sein. Das Skript führt `git pull --ff-only` aus und verwendet danach die heruntergeladenen Panorama- und App-Quellen. Laufende Reviews vorher beenden und CS2 vollständig schließen; bei laufendem CS2 wartet das Skript auf dessen Ende. Playbook-Fenster werden regulär geschlossen, damit ihre Dateien für den Build frei sind. Nach dem Update öffnet sich `playbook-desktop/dist/win-unpacked/Playbook.exe`. Dort **Server → Reviews** wählen, CS2 starten und das Spielbild freigeben. SteamCMD wird erst bei einem separat gestarteten und bestätigten Release eingerichtet; Passwort und Steam Guard gibst du bei Bedarf direkt dort ein. Details stehen in der [Veröffentlichungsanleitung](workshop-release.md).

Für einen reinen Compilerlauf:

```powershell
./training-hud/build.ps1 -Cs2 'D:/SteamLibrary/steamapps/common/Counter-Strike Global Offensive'
```

Das Skript kopiert ausschließlich die zwei Projektquellen in `content/csgo_addons/playbook_training_hud`, ruft Valves Compiler auf und legt die kompilierten Dateien direkt im zuvor mit den Workshop Tools angelegten Addon `game/csgo_addons/playbook_training_hud` sowie unter `training-hud/dist` ab. Es verändert weder Tastaturbelegungen noch Dateien unter `game/csgo` und veröffentlicht nichts.

Für einen lokalen Entwicklungstest installiert `hud.cmd` die beiden kompilierten Dateien aus `dist/panorama` unter den gleichen relativen Pfaden in `game/csgo/panorama` und prüft ihre SHA-256-Hashes. Anschließend CS2 für den Review aus der geöffneten Playbook-App starten oder für einen reinen Panel-Test normal über Steam. Der Workshop-Tools-Client läuft mit `-insecure` und kann keinem VAC-gesicherten Server beitreten. Zum Testen braucht der Server das aktuelle Plugin und aktiviertes Trainings-HUD in den Servereinstellungen von Playbook. Vor dem anschließenden Download-Test mit `hud.cmd -Mode live` die lokalen Testdateien sichern und entfernen, damit sie das Workshop-Addon nicht überdecken.

In der Webübersicht unter **Server → Trainings-HUD** einstellen und mit **Apply & restart** übernehmen:

| Verwendung | Trainings-HUD aktivieren | HUD über Workshop ausliefern | HUD-Workshop-ID |
| --- | --- | --- | --- |
| Lokale Entwicklung | An | Aus | Darf gespeichert bleiben |
| Workshop-Auslieferung | An | An | Veröffentlichte ID erforderlich |
| Panel ausschalten | Aus | Beliebig | Darf gespeichert bleiben |

Die Einstellung gilt für den gesamten Server. Ohne Workshop-Auslieferung werden keine HUD-Dateien an Spieler verteilt; jeder Testclient braucht die lokalen Dateien. Die lokale Arbeitskopie wird nicht direkt gelesen: `panel-source.ps1 local` kompiliert und installiert XML/CSS, danach CS2 vollständig neu starten und erneut verbinden. Lokale Overrides können auch eine ausgelieferte Workshop-Version überdecken; für einen Live-Test zusätzlich `panel-source.ps1 live` ausführen.

Die HUD-Konfiguration erfolgt über die Servereinstellungen in Playbook. Bei der ersten Übernahme **Trainings-HUD aktivieren** ausdrücklich setzen; die Voreinstellung ist aus. Für Workshop-Auslieferung zusätzlich **HUD über Workshop ausliefern** aktivieren und die eigene Workshop-ID eintragen.

Der Bootstrap installiert den bereits verwendeten MultiAddonManager bei Bedarf und schreibt die HUD-ID nach `mm_client_extra_addons`. Vorhandene Server-/Map-Addons bleiben in `mm_extra_addons`. Die aktivierte Panel-Einstellung schaltet das Ingame-Panel frei. Bei rein lokalen Tests wird keine Addon-ID benötigt, aber der Testclient muss die Dateien installiert haben. Ohne Assets erscheint sonst trotz erfolgreich erstellter Server-Entity kein HUD. Für API/Metamod/AddonManager eine zusammen kompatible Version benutzen; keine ungetestete pauschale Versionserhöhung des gesamten Servers.

## Lokalen Stand an Freunde weitergeben

Jedes erfolgreiche Panorama-Update mit `hud.cmd` erzeugt automatisch `training-hud/dist/Playbook-HUD-local.zip` und den gleichnamigen Ordner. Das Paket enthält nur die beiden kompilierten Panel-Dateien, einen Installer und eine kurze Anleitung. Der Export erfolgt vor dem App-Build, sodass das Paket auch bei einem anschließenden App-Buildfehler bereitliegt. Für einen erneuten Export bereits kompilierter Dateien genügt auf Windows `./training-hud/export-local.ps1`.

Die ZIP an deinen Freund schicken. Er beendet CS2 vollständig, entpackt sie und doppelklickt `Installieren.cmd`. Der Installer erkennt die Steam-Bibliotheken und fragt bei Bedarf nach dem CS2-Verzeichnis. Er braucht nur das in Windows enthaltene Windows PowerShell, sichert vorherige lokale HUD-Dateien und prüft die kopierten Dateien mit SHA-256. Git, Workshop Tools und die Playbook-App braucht dein Freund nicht.

Alternativ kann er den enthaltenen `game`-Ordner direkt in seinen CS2-Installationsordner kopieren und zusammenführen. Diesen Ordner findet er in Steam unter **CS2 → Eigenschaften → Installierte Dateien → Durchsuchen**. Vorhandene gleichnamige Dateien dabei selbst sichern. Danach CS2 normal über Steam starten, mit dem Trainingsserver verbinden und `.nades` eingeben.

Der Server braucht weiterhin das passende Plugin. Für den gemeinsamen lokalen Test **Trainings-HUD aktivieren** einschalten und **HUD über Workshop ausliefern** ausschalten, dann **Apply & restart** ausführen. Das gilt serverweit; jeder Spieler braucht dann das lokale Paket. Dadurch entfällt nur der Workshop-Download des HUDs. Andere Workshop-Maps oder Addons bleiben davon unabhängig.

Ein einmal installiertes Paket bleibt lokal verfügbar. Bei Änderungen schickst du eine neue ZIP, die dein Freund bei beendetem CS2 installiert. Das Paket aktualisiert sich nicht selbst aus dem Internet. Für den Wechsel zurück zur Workshop-Auslieferung bei beendetem CS2 im entpackten Paket `./install-local.ps1 -Mode live` ausführen und die Workshop-Auslieferung auf dem Server wieder aktivieren.

## Zwischen lokaler Entwicklung und Live wechseln

CS2 vollständig beenden und im Projektordner in PowerShell ausführen:

```powershell
$cs2Path = 'D:/SteamLibrary/steamapps/common/Counter-Strike Global Offensive'
./training-hud/panel-source.ps1 local -Cs2 $cs2Path
./training-hud/panel-source.ps1 live -Cs2 $cs2Path
./training-hud/panel-source.ps1 status -Cs2 $cs2Path
```

Die drei Zeilen sind Alternativen: `local` baut die aktuellen XML-/CSS-Quellen und installiert die beiden lokalen Overrides. Mit `-SkipBuild` werden stattdessen die bereits kompilierten Dateien unter `dist` verwendet. `live` entfernt ausschließlich diese beiden Overrides; vorhandene Dateien werden vorher unter `<CS2>/playbook-hud-backups/<ID>` gesichert. `status` prüft nur die Dateien auf der Festplatte und funktioniert auch bei laufendem Spiel. Die installierte Workshop-Version wird nicht verändert.

Nach einem Wechsel CS2 normal über Steam starten. Das Skript beendet oder startet das Spiel nicht automatisch. Für `live` muss das veröffentlichte Workshop-Addon bereits vom Server bereitgestellt werden; das Entfernen lokaler Dateien allein lädt kein Addon herunter. Die Workshop-Auslieferung dieses Projekts ist noch nicht abgenommen.

Das ist ein **PowerShell-Befehl, kein CS2-Konsolenbefehl**. Das Plugin bestimmt den Layoutpfad; der Client löst diesen über seine geladenen Dateien auf. Ein verlässlicher Wechsel der Quelle innerhalb einer laufenden Sitzung ist hier nicht verfügbar: Panorama hält Layouts im Cache, auch über einen Reconnect hinweg ([technische Referenz](https://github.com/nvmxre/cs2-ui-kit/blob/master/docs/GOTCHAS.md#changes-to-the-layout-do-not-show-up)).

Damit lassen sich Layout und Styles ohne Workshop-Veröffentlichung und ohne Serveränderung entwickeln, solange Panel-IDs und Variablen zur installierten Plugin-Version passen. Menüpunkte, Favoriten, Spawns und andere C#-Funktionen kommen weiterhin vom Server-Plugin. Zum Testen neuer Funktionen ist eine aktualisierte Plugin-Version auf einem Entwicklungsserver nötig.

## Feste Keybinds

### Panel bleibt unsichtbar oder die Bewegung ist gesperrt

Das Server-Plugin schreibt beim Öffnen über `KP_0` beziehungsweise `css_tk 0`, beim Ein-/Ausblenden und beim Wechsel der Panel-Steuerung Diagnosemeldungen mit dem Präfix `[Playbook-HUD]` in die Client-Konsole und das Serverlog. Die Meldungen enthalten den Spielmodus, Trainingsstatus, HUD-Aktivierung, Berechtigung, Sitzung, Sichtbarkeit, Fokus, Entity-ID, Eingabeübernahme und Bewegungszustand. Das Serverlog enthält zusätzlich Steam-ID, Map und Layoutpfad. Ablehnungen durch Rollen- oder Spielmodusprüfung werden ebenfalls protokolliert. Die regelmäßigen Panel-Aktualisierungen erzeugen keine wiederholten Diagnosemeldungen.

Mit `css_training_debug` kann ein Trainingsspieler den aktuellen Zustand samt Installationshinweis erneut ausgeben. Zum Sammeln eines Fehlerfalls in der CS2-Konsole `css_tk 0`, danach `css_training_debug` ausführen und die `[Playbook-HUD]`-Zeilen zusammen mit Panorama-/Resource-Fehlern aus der Client-Konsole weitergeben. Mit `css_nades close` wird die Panel-Steuerung freigegeben; alternativ `KP_0` erneut drücken. Diese Diagnose erfordert das aktualisierte Server-Plugin.

Eine gültige Server-Entity bestätigt nur die Erstellung auf dem Server. Die HUD-API liefert keine Bestätigung, dass der Client das Layout geladen oder angezeigt hat. Die Protokolle kennzeichnen die Client-Anzeige deshalb ausdrücklich als unbestätigt. Bei einem unsichtbaren Panel trotz aktiver Eingabeübernahme die lokalen Dateien beziehungsweise Workshop-Auslieferung prüfen und CS2 vollständig neu starten.

Unter **Keybinds** stehen die unveränderlichen Tasten. Alte persönliche Belegungen und Spielaktions-Navigation werden beim Laden ignoriert; Favoriten bleiben erhalten.

| Aktion | Taste |
| --- | --- |
| HUD bedienen / frei spielen | KP_0 |
| HUD anzeigen / verstecken | KP_DEL |
| Auswahl hoch / runter | UPARROW / DOWNARROW |
| Bestätigen | ENTER |
| Zurück | BACKSPACE |
| Vorherige / nächste Seite | LEFTARROW / RIGHTARROW |

Auswahl und Seitenwechsel laufen im Kreis. Hoch beim ersten Eintrag wählt den letzten Eintrag auf der letzten Seite; runter beim letzten Eintrag wählt den ersten auf der ersten Seite. Links auf der ersten Seite führt zur letzten, rechts auf der letzten zur ersten. Jede Seite reserviert weiterhin neun Listenplätze. Zurück bleibt auf Home stehen und hält die Panelbedienung aktiv, auch bei wiederholtem Drücken. Mit KP_0 oder dem Spielen-Button wechselst du zur Spielsteuerung.

Der erste Eintrag unter **Keybinds**, **Alle Keybinds in Konsole ausgeben**, schreibt ausschließlich zwei kopierbare Befehlszeilen in die Client-Konsole. Das geht auch direkt mit `css_training_binds`. Die erste Zeile enthält alle acht Panel-Binds, mit Semikolon getrennt. Der kurze Plugin-Befehl `css_tk` hält die gesamte Zeile unter 240 UTF-8-Bytes, damit sie in der Client-Konsole angezeigt werden kann. Dafür muss auch das Server-Plugin aktualisiert sein. Die zweite lautet `bind "n" "noclip"` und ist optional: `n` darf durch eine selbst gewählte, freie Taste ersetzt werden. Noclip benötigt `sv_cheats 1`. Jede gewünschte Zeile einzeln kopieren und ausführen.

Alternativ [playbook_training.cfg](playbook_training.cfg) nach `game/csgo/cfg` kopieren und einmal `exec playbook_training` in CS2 ausführen. Die CFG wird nicht automatisch geladen; auch das Server-Plugin lädt keine lokale Spieler-CFG. Die optionale Noclip-Zeile ist in der Datei auskommentiert.

**Bisherige Belegungen wiederherstellen:** Vor dem Ausführen für jede betroffene Taste beispielsweise `bind "KP_0"` beziehungsweise `bind "n"` in der Konsole eingeben. Die angezeigten bisherigen Befehle als `bind "TASTE" "BISHERIGER BEFEHL"` in einer eigenen Datei `training_restore.cfg` unter `game/csgo/cfg` sichern. Für zuvor unbelegte Tasten dort `unbind "TASTE"` eintragen. Nach dem Training `exec training_restore` ausführen. Ohne vorherige Sicherung kennt das Plugin die überschriebenen Belegungen nicht; `unbind` allein stellt sie nicht wieder her.

Der Server kann Client-Binds weder setzen noch auslesen und auch keine nur auf diesen Server begrenzten Binds erzwingen. Vorher eigene Belegungen sichern. Binds gelten clientweit; nach dem Training die eigene gesicherte CFG manuell laden. Das Plugin verarbeitet seine Aktionen nur in Practice, aber dadurch werden die alten Client-Belegungen nicht automatisch wiederhergestellt. Alte F6/F7/F8-Binds bei Bedarf selbst zurücksetzen. `css_training_bind` ändert keine Belegungen mehr; `css_training` und `css_training_visible` bleiben als Zugang ohne CFG erhalten.

## Bibliothek, Review und Map-Abstimmung

Siehe [Bedienung der Trainingszentrale](../docs/nades-menu.md). Alle Aufnahmen sind für alle Spieler sichtbar. Nur der Ersteller kann seine noch nicht offiziellen Aufnahmen bearbeiten, löschen oder zum Review einreichen. Offizielle Freigaben und Must Know werden von Plattform-Admins in der Webübersicht gespeichert.

## Abnahme im Spiel

1. Compilerlauf ohne Fehler; Layout mit 16:9 und 4:3 prüfen, auch lange Titel und Beschreibungen.
2. Schnell drehen, laufen, springen und zoomen: Rahmen bleibt am Bildschirmrand.
3. Maus: alle neun Einträge, Zurück, Seitenwechsel und Home testen. KP_0/KP_DEL prüfen. Beschreibungen müssen die volle Breite nutzen und nach höchstens vier Zeilen mit Auslassungspunkten enden, wenn der Text länger ist. Nach Verlassen darf kein Cursor/Sperrzustand bleiben.
4. Zwei Spieler mit eigenen Favoriten; alle Aufnahmen sind sichtbar, Bearbeitung bleibt dem Ersteller vorbehalten. Reconnect mit wiederverwendetem Slot und Serverneustart prüfen.
5. Alte Tastenprofile laden: feste Belegung verwenden, Favoriten erhalten. Navigation im passiven/versteckten Zustand darf keine Aktion auslösen.
6. Aufnahme, Name/Beschreibung per Chat, Review, Admin-Freigabe, Löschen und Sync-Konflikte testen.
7. .prac und .exitprac sowie Competitive-Start testen: außerhalb Practice darf keine Panelaktion funktionieren.
8. Map-Abstimmung mit Ja/Nein, Enthaltungen, Disconnect und Zuschauern testen; bei Practice-Ende abbrechen.

Technische Referenzen: [CounterStrikeSharp HUD-API](https://github.com/roflmuffin/CounterStrikeSharp/blob/main/managed/CounterStrikeSharp.API/Modules/Extensions/CCSCustomHudLayoutExtensions.cs), [CS2UIKit Erkenntnisse zu Panorama](https://github.com/nvmxre/cs2-ui-kit/blob/master/docs/GOTCHAS.md). Dieses Projekt bindet CS2UIKit nicht als Laufzeitabhängigkeit ein.

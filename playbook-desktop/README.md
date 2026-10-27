# Playbook für Windows

Die App öffnet die über `PLAYBOOK_DESKTOP_URL` konfigurierte Playbook-Website und ergänzt den Medien-Review um lokale CS2-Steuerung. Website-Updates erscheinen ohne Neuinstallation. Neue Windows-Versionen werden im Hintergrund geladen; installiert wird erst über den Update-Button nach dem Review.

Die Vorgabe `https://playbook.example.com` ist ein Platzhalter. Vor dem Start `PLAYBOOK_DESKTOP_URL` auf die eigene HTTPS-Adresse ohne Pfad setzen. Die Adresse gilt auch für die Freigabe der lokalen Desktop-Funktionen.

```powershell
$env:PLAYBOOK_DESKTOP_URL = "https://playbook.example.com"
```

## Benutzen

1. Den Windows-Installer `Playbook-Setup-<Version>.exe` aus den GitHub-Releases installieren. Es sind keine Administratorrechte nötig.
2. Playbook öffnen und mit dem eigenen Steam-Konto anmelden. Die vorhandenen Berechtigungen gelten auch hier.
3. Beim Lineup **Review öffnen** wählen. Die eigene Review-Seite enthält den Stepper und alle Aufnahmen. Plattform-Admins öffnen direkt **Server → Reviews**. Dort bleiben CS2-Start und Spielbild-Freigabe über der eingeklappten Liste **Reviews und Filter** sichtbar. Nach der einmaligen Freigabe folgt die Seite automatisch dem Lineup und Schritt im Ingame-Panel desselben Steam-Kontos, auch beim Wechsel zum nächsten Review. Die einzelne Review-Seite bleibt ebenfalls verfügbar. CS2 über **CS2 für Review ohne VAC starten** starten; dieselbe Aktion ist im Playbook-Menü verfügbar. Wenn CS2 schon läuft, vorher regulär beenden. Playbook erstellt zuerst zwei lokale Command-Pipes und startet dann die installierte Steam-Anwendung mit `-applaunch 730 -console -insecure -concommandpipe <lokale Pipes>`. Die App prüft bis zu einer Minute, ob das Spiel eine echte Konsolenvariable bestätigt. Eine Startabfrage in Steam gegebenenfalls bestätigen. Gespeicherte Steam-Startoptionen werden nicht verändert. Der Trainingsserver muss ohne VAC laufen. Für Matchmaking CS2 anschließend vollständig beenden und regulär über Steam starten.
4. Mit dem Trainingsserver verbinden. In CS2 vorzugsweise **Vollbild im Fenster** verwenden. **Spielbild verbinden** erkennt genau das CS2-Fenster; ein Bildschirm-Auswahldialog entfällt.
5. Die vier Fotos und das Video über die Website oder als Plattform-Admin über das bestehende Ingame-Panel aufnehmen. Das Server-Plugin steuert weiterhin Position, Frontkamera, Panel und Review-Schritte. Die App übernimmt HUD, Waffe, Fadenkreuz, Fensterausschnitt und Upload über die bestehende Website.
6. Das Video mit **F8** beenden. Dafür muss kein Bind in CS2 gespeichert werden. Nach dem Upload abschließend prüfen und einreichen bzw. als Plattform-Admin freigeben.

Bei Fotos wird das ausgewählte weiße, statische CS2-Fadenkreuz mit schwarzer halber Kontur eingestellt: Länge 22, Stärke 3, Abstand 9, ohne Mittelpunkt, T-Stil und Rückstoßbewegung. Für Zielfernrohr-Leuchtpunkte bleibt die eigene Fadenkreuzfarbe ausgeschaltet, die Leuchtpunktgröße ist 1,00. Die Referenzhöhe wird aus dem aktuellen CS2-Spielbereich in physischen Pixeln bestimmt, damit die neue automatische Auflösungsskalierung die angeforderten Größen nicht verändert. Es wird im Spiel gerendert und nicht auf das Foto gezeichnet. Vorderansicht und Wirkung haben kein Fadenkreuz. Geldanzeige, HUD, Telemetrie und Viewmodel sind auf Fotos ausgeblendet. Videos behalten die Waffe, damit der Wurf sichtbar bleibt. Steam- und andere Fremd-Overlays müssen geschlossen sein. Ton wird nicht aufgenommen; das vorhandene Limit von zwei Minuten und 128 MB gilt weiter.

Ab Version 0.1.9 nimmt die Vorderansicht den echten Spieler in Third Person auf. Die App sichert die Kamera-Cvars und setzt `c_minyaw -180`, `c_maxyaw 180`, `cam_idealyaw 180`, `cam_idealpitch <negativer Spieler-Pitch>` und die Pitch-Grenzen `c_minpitch -89`, `c_maxpitch 89` sowie Kollisionsprüfung und ausgeblendete Kamera-Debuganzeige. Anschließend aktiviert sie `thirdperson`. Nach Foto, Fehler oder Wiederherstellung wechselt sie mit `firstperson` zur Ego-Ansicht zurück und stellt die Kamera-Cvars wieder her. Ein vorheriger Third-Person-Modus wird nicht ermittelt. Der Trainingsserver muss diese eingebauten CS2-Befehle erlauben. Server-Plugin 2.3.4 und die aktuelle Website werden benötigt. `thirdperson_mayamode` und `m_pitch` werden nicht verändert.

Die App liest alle Einstellungen, die sie verändert, und schreibt vor der Änderung eine lokale Wiederherstellungsdatei. Nach der Aufnahme stellt sie die gelesenen Werte wieder her und prüft sie. Bei einer Verbindungsunterbrechung bleibt die Sicherung erhalten; die App versucht die Wiederherstellung erneut. Ein ungeplanter Prozessabbruch lässt sich nicht synchron behandeln, deshalb wird beim nächsten App-Start aus der Datei wiederhergestellt. Die Datei und persönliche Fadenkreuzwerte werden nicht hochgeladen. Während einer Aufnahme Einstellungen nicht parallel in CS2 ändern.

Die Browser-Variante verwendet dieselben sichtbaren Fadenkreuz-Einstellungen über kopierbare Konsolenbefehle und funktioniert weiterhin ohne Windows-App. Ein fest hinterlegter Share-Code ist nicht mehr nötig. Im Browser müssen die persönlichen Einstellungen vorab selbst gesichert und anschließend wiederhergestellt werden.

Video-Start und -Stopp über die Website und F8 laufen bei Plattform-Admins über die Spielserver-Vorbereitung. Das Ingame-Panel wird beim Start ausgeblendet und nach Aufnahmeende noch vor dem Upload wiederhergestellt. Auch ein Zeitlimit oder das Beenden der Freigabe gibt das Panel frei. Fotos und Videos verwenden denselben Ausschnitt: Die App erkennt ihn automatisch, im Browser wird er einmal bestätigt. Kurze Aussetzer im Spielbild werden bis zu fünf Sekunden überbrückt; ein kurz fehlgeschlagener Serverabruf beendet die Freigabe nicht. Für diesen Ablauf müssen Website, Server-Plugin und Windows-App gemeinsam aktualisiert werden.

Die Steam-Anmeldung erfolgt weiterhin im App-Fenster. Browser und App haben getrennte Sitzungen; eine Anmeldung im Browser würde die App ohne zusätzliche sichere Übergabe nicht anmelden.

Zeigt die App **„Noch kein App-Update veröffentlicht“**, gibt es im GitHub-Release-Verzeichnis noch kein Paket für den automatischen Updater. Die App bleibt benutzbar; lokale Builds werden bis dahin über `playbook.cmd` aktualisiert. Netzwerkfehler werden weiterhin separat gemeldet.

Bei Verbindungsproblemen **Playbook → CS2-Verbindung prüfen** öffnen. Der Bericht unterscheidet fehlenden Spielprozess, fehlende Startoptionen, noch nicht verbundene Command-Pipes, fehlenden Antwortkanal, falschen Portbesitzer und ausbleibende Protokollantworten. Er zeigt Prozess-ID, Fensterstatus, Laufzeit, ausgewählte Startoptionen, TCP-Listener und den ursprünglichen Fehlercode. Über **Diagnose kopieren** lässt sich der Bericht weitergeben. **Playbook → CS2-Diagnose kopieren** kopiert auch den letzten automatisch erstellten Fehlerbericht. Die Verbindung wird durch das Lesen von `crosshair` geprüft; ein offener Port allein reicht nicht.

Das lokale Protokoll unter `%APPDATA%\Playbook\logs\startup.log` enthält Zeitstempel, Schweregrad, Bereich, Verbindungsversuche, Fehlercodes, Laufzeiten sowie empfangene Antwortzeilen und Start-/Endmarkierungen. Start, Verbindung, Aufnahme und Wiederherstellung sind getrennt erkennbar. Über **Playbook → Startprotokoll öffnen** lässt es sich öffnen. Bei 512 KiB wird es nach `startup.log.previous` verschoben; es bleibt eine vorherige Datei erhalten. Die Diagnose liest Windows-Prozess- und Portinformationen über die mitgelieferte PowerShell. Fehler dieser Abfrage erscheinen separat, ohne den ursprünglichen Verbindungsfehler zu ersetzen. Vollständige Spielbefehlszeilen, Passwörter, rohe Konsolenausgaben und persönliche Fadenkreuzwerte werden nicht protokolliert oder hochgeladen.

Version 0.1.5 behebt die Verbindung der Version 0.1.4: Aktuelles CS2 hat `-netconport` entfernt; die Startoption stand zwar in der Prozessbefehlszeile, öffnete aber keinen Listener. Auch [Hammer5Tools dokumentiert diese Umstellung](https://hammer5tools.github.io/). Playbook sendet jetzt Befehle über `-concommandpipe` und liest deren Bestätigungen über den lokalen VConsole-Antwortkanal auf Port 29000. Dieser Spielstart benötigt `-insecure`, aber kein `-tools`. Die Antwortverarbeitung unterstützt sowohl die bisherigen 16-Bit-Pakete als auch die großen `CVRB`-Startpakete und `EFUL`-Pakete beim Mapwechsel mit 32-Bit-Längen. Die Pipes müssen vor dem Spielstart existieren. Nach einem Playbook-Absturz deshalb auch CS2 regulär beenden und über Playbook neu starten; eine vorgemerkte Wiederherstellung bleibt lokal gesichert.

## Demos aus einem lokalen Ordner importieren

Öffne die Windows-App, melde dich mit Steam an und wähle **Analyse → Matchimporte**. Unter **Demos aus einem Ordner importieren** kannst du einen Ordner auswählen oder einen vollständigen Windows-Pfad eingeben. Wähle den privaten oder Team-Arbeitsbereich sowie die Herkunft der Demos und klicke auf **Ordner importieren**. Der Pfad bleibt lokal in der App gespeichert. Die App prüft den Ordner ausschließlich auf deinen Klick; es gibt keine automatische Ordnerüberwachung.

Unterstützt werden `.dem`, `.dem.gz` und `.dem.bz2` sowie solche Demo-Dateien innerhalb von ZIP-, RAR- und 7z-Archiven. Dateien in Unterordnern des ausgewählten Ordners werden nicht durchsucht. Archive werden lokal in einen temporären Ordner entpackt; andere Archivdateien werden nicht hochgeladen. Passwortgeschützte Archive werden nicht unterstützt. Pro Datei oder Archiv gilt das Uploadlimit von 1 GiB; ein Archiv darf bis zu 100 Demos enthalten und höchstens 3 GiB entpackte Demo-Dateien erzeugen.

Vor dem Upload berechnet die App den SHA-256-Fingerabdruck der Datei und sucht ihn im gewählten Arbeitsbereich. Bereits vorhandene Inhalte werden übersprungen, auch wenn sich der Dateiname geändert hat oder eine frühere Uploadbestätigung verloren ging. Die Originaldateien bleiben in deinem Ordner. Fehler einzelner Dateien erscheinen im Ergebnis; weitere Dateien werden geprüft. Bei belegten Importplätzen oder Uploadlimits wartet die App. **Abbrechen** beendet den Lauf; ein erneuter Klick prüft noch offene Dateien erneut. Während des Imports muss die App geöffnet bleiben.

FACEIT-Demos mit einer Match-ID im Dateinamen werden über den eingerichteten Data-API-Zugang einem Match zugeordnet, wenn das Match genau eine Map enthält. Bei einem Archiv mit genau einer Demo wird zusätzlich der Archivname geprüft. Für Serien mit mehreren Maps bleibt die Zuordnung manuell. Dieser Ablauf benötigt keinen FACEIT-Downloads-Token, weil du die Datei selbst im Matchroom herunterlädst.

Im Browser funktioniert derselbe Ablauf unter **Analyse → Matchimporte** über **Ordner auswählen** und **Ordner importieren**. Ein eingetippter lokaler Pfad reicht dort nicht: Der Browser benötigt eine ausdrückliche Ordnerfreigabe. Browser mit `showDirectoryPicker` speichern den ausgewählten Ordner lokal und lesen ihn beim nächsten Import erneut ein; gegebenenfalls muss die Lesefreigabe erneut bestätigt werden. Andere Browser verwenden die normale Ordnerauswahl. Dort muss der Ordner neu ausgewählt werden, um hinzugefügte Dateien einzulesen. Archive werden im Browser entpackt, vorhandene Inhalte im gewählten Arbeitsbereich übersprungen. Während des Imports muss die Seite geöffnet bleiben.

Die Browser-Fixture `admin-panel/client/test/browser-demo-folder.html` prüft mit echten Browser-Workern ZIP-/RAR-Extraktion, SHA-256, wiederholten Import, Abbruch, Kontowechsel und Ordnerauswahl. Die API wird simuliert; es werden keine Testdateien auf den Server hochgeladen. Bei laufendem Client-Entwicklungsserver die Seite öffnen und `await checkBrowserDemoFolder()` ausführen.

## Entwickeln und ausliefern

Voraussetzungen: Windows 10/11 x64, Node.js 22+, .NET SDK 10. Die App benötigt Internet für Playbook und UploadThing, Steam und einen laufenden Trainingsserver mit dem aktuellen Review-Plugin. `r_drawviewmodel` benötigt die auf dem Trainingsserver erlaubten Cheats; die App ändert keine globalen Serverregeln.

Für den vollständigen lokalen Review-Stand unter Windows genügt ein Doppelklick auf **[`hud.cmd`](../hud.cmd)** im Projekt-Root. Die Datei führt `git pull --ff-only` auf dem aktuellen Branch aus, baut und installiert das Panorama-Panel, installiert die App-Abhängigkeiten, testet und baut Playbook und öffnet die frisch gebaute Electron-App direkt. Es ist kein Installationsschritt nötig. Die App liegt unter `playbook-desktop/dist/win-unpacked/Playbook.exe`. Vorher laufende Reviews beenden und CS2 vollständig schließen. In der geöffneten App **Server → Reviews** wählen, CS2 starten und das Spielbild freigeben.

Dieser vollständige Ablauf benötigt zusätzlich PowerShell 7 und die CS2 Workshop Tools. Nur die App als installierte Windows-Version aktualisieren: **[`playbook.cmd`](../playbook.cmd)** ausführen. Dieser Aufruf holt ebenfalls den Git-Stand, testet und baut den Windows-Installer und öffnet ihn anschließend. Nach der Installation startet Playbook automatisch.

Git for Windows, Node.js 22 oder neuer inklusive npm und das **.NET SDK 10** müssen installiert sein. Das Skript verwendet die in Windows enthaltene PowerShell; PowerShell 7 ist dafür nicht nötig. Bei Fehlern bleibt das Fenster mit der Fehlermeldung offen. Ein fehlgeschlagenes Update oder ein Build-Fehler startet keinen älteren Installer.

Vor dem App-Build und vor dem Öffnen der App bzw. der Installation schließt das Skript laufende Playbook-Fenster regulär und wartet bis zu 30 Sekunden auf das Ende aller Playbook-Prozesse. So kann die App ihre CS2-Einstellungen wiederherstellen. Falls Prozesse weiterlaufen oder bereits ein Installer offen ist, hält das Skript vor dem nächsten Schritt an und nennt die Blockade. Eine Rückfrage in Playbook muss gegebenenfalls noch beantwortet werden. Ein fehlgeschlagener Build öffnet keine ältere App.

Erscheint bei einer älteren Version im Installer **„Playbook kann nicht geschlossen werden“**, zuerst den laufenden Review beenden und Playbook schließen. Bleiben danach Prozesse ohne sichtbares Fenster übrig, im Windows-Task-Manager unter **Details** die Prozesse `Playbook.exe` beenden und im Installer **Wiederholen** wählen. Playbook und das Update-Skript unter demselben Windows-Konto und normalerweise ohne Administratorrechte starten.

Läuft eine ältere App nur als Hintergrundprozess ohne Fenster, diese Prozesse vor dem Update einmal im Task-Manager beenden. Der korrigierte Start wartet erst nach Abschluss des JavaScript-Modulladens auf Electron. Der Build prüft mit echtem Electron, dass tatsächlich ein sichtbares Fenster entsteht. Startfehler erscheinen als Dialog; das lokale Protokoll liegt unter `%APPDATA%\Playbook\logs\startup.log` und lässt sich in der App über **Playbook → Startprotokoll öffnen** aufrufen.

```powershell
cd playbook-desktop
npm ci
npm run build:native
npm start
# App ohne Installer bauen, einschließlich Tests
npm run build:app
# Installer, einschließlich Tests
npm run dist
```

Die GitHub-Aktion **Playbook für Windows** kann manuell gestartet werden. Sie erstellt einen Installer als Workflow-Artefakt, ohne ihn zu veröffentlichen. Für ein reguläres Update die Paketversion erhöhen, beide Paketdateien committen und einen passenden Tag pushen:

```sh
cd playbook-desktop
npm version patch --no-git-tag-version
git add package.json package-lock.json
git commit -m "Playbook-Version erhöhen"
git tag "playbook-v$(node -p 'require("./package.json").version')"
git push origin HEAD --tags
```

Ein Tag `playbook-v<Version>` baut den Installer auf Windows und veröffentlicht EXE, Blockmap und `latest.yml` gemeinsam als GitHub-Release. Bereits installierte Apps finden dieses Update automatisch. Website- und Plugin-Änderungen werden weiterhin über deren bestehenden Weg ausgerollt; sie stecken nicht im Installer. Vor dem ersten Einsatz muss die Website mit der Desktop-Anbindung veröffentlicht sein.

Optional die Repository-Secrets `WINDOWS_CSC_LINK` und `WINDOWS_CSC_KEY_PASSWORD` für ein Authenticode-Zertifikat hinterlegen. Ohne Zertifikat ist der Installer unsigniert; Windows kann beim ersten Start eine SmartScreen-Abfrage anzeigen. Es wird keine Signaturprüfung abgeschaltet. Für öffentliche Verteilung ist ein dauerhaft verwendeter Publisher sinnvoll.

## Grenzen und Prüfung

- Kein Zugriff auf CS2-Speicher, keine DLL-Injektion, keine Änderung an Steam-Konfigurationsdateien. Befehle laufen über lokale Command-Pipes, Antworten über `127.0.0.1:29000`. Vor dem Verbinden prüft Playbook, dass CS2 mit der passenden Pipe-ID und `-insecure` läuft und den Antwortport besitzt. Den Antwortport nicht im Router oder in der Firewall für andere Rechner freigeben. Eine externe VConsole-App kann den Antwortkanal belegen und muss vor dem Review geschlossen werden.
- Der Windows-Prozess liest Fenstergeometrie und Prozessidentität. Auf Anforderung startet er außerdem Steam mit festen CS2-Startoptionen. Das Bild kommt aus Electron/Chromium-Fensteraufnahme. Bei unklarer Geometrie wird abgebrochen, statt einen Fensterrand zu schätzen. Minimiertes CS2 oder ein Größenwechsel während des Videos bricht die Aufnahme ab.
- `npm test` prüft Paketfragmentierung einschließlich großer Startpakete, echte lokale Windows-Pipes mit simuliertem Spiel, Konsolenantworten, Timeout-Diagnosen, Schutz persönlicher Werte im Log, abweichend übernommene Einstellungen, simulierte Fadenkreuz-Skalierung bei 720p, 1080p, 1440p und 2160p, exakte Wiederherstellung, Abbruch und Neustart, Herkunftsprüfung und Fensterausschnitte. Die Browser-Fixture `admin-panel/client/test/review-desktop.html` prüft den vollständigen Aufnahmeablauf mit simuliertem Spiel und der echten Review-Oberfläche.
- Die ausdrücklich gestarteten Windows-Live-Tests benötigen installiertes Steam/CS2 und das gebaute Hilfsprogramm. CS2 und Playbook vorher regulär schließen. `npm run test:cs2` startet echtes CS2 ohne VAC, lädt eine lokale Mirage-Map, liest alle 35 Einstellungen und prüft für alle fünf Profile die exakte Wiederherstellung. `npm run test:desktop` prüft zusätzlich den echten Electron-Einstieg, die Renderer-Anbindung, Fensteraufnahme, einen kurzen Video-Stream und das Beenden über F8; die Seite ist eine lokale Testseite unter der erlaubten Herkunft. Es werden keine Reviews hochgeladen. Beide Tests beenden ihr gestartetes CS2 nach erfolgreicher Wiederherstellung; bei Fehlern bleiben Diagnose und nötige Wiederherstellungsdateien erhalten. Alte Wiederherstellungsdateien mit 33 Einstellungen bleiben lesbar.

Technische Referenzen: [Electron-Fensteraufnahme](https://www.electronjs.org/docs/latest/api/desktop-capturer), [Electron-Sicherheitsmodell](https://www.electronjs.org/docs/latest/tutorial/security), [electron-builder Auto-Update](https://www.electron.build/v26/docs/features/auto-update/), [CS2-Command-Pipe und Antwortkanäle](https://github.com/dertwist/Hammer5Tools/blob/main/Hammer5ToolsGUI/gui/other/cs2_netcon.py), [VConsole-Protokoll](https://github.com/theokyr/CS2RemoteConsole/tree/master/libvconsole), [aktuelle CS2-Konsolenvariablen](https://github.com/SteamDatabase/GameTracking-CS2/blob/master/DumpSource2/convars.txt).

Die lokalen Browser-Prüfungen testen echte JPEG- und WebM-Aufnahmen mit simuliertem Spielbild, denselben Fensterausschnitt für Fotos und Videos, Wiederherstellung vor dem Upload sowie die Review-Seiten mit Mapfilter, Rollenprüfung und Desktop-/Mobilansicht. Sie verwenden unsichtbare Electron-Fenster und laden keine Dateien hoch. Nach Installation der Abhängigkeiten in `admin-panel` und `playbook-desktop` ausführen:

```powershell
cd admin-panel
$env:ELECTRON_RUN_AS_NODE = $null
..\playbook-desktop\node_modules\.bin\electron.cmd test/review-browser.cjs
```

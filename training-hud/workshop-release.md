# Trainingspanel lokal testen und im Steam Workshop veröffentlichen

Dieses Projekt aktualisiert das bestehende [Workshop-Item 3810441722](https://steamcommunity.com/sharedfiles/filedetails/?id=3810441722). Entwicklung, Dashboard und Server können auf einem separaten Rechner laufen. Für das Kompilieren mit Valves Windows-Werkzeugen, den Spieltest und den Upload verwendest du deine Windows-Arbeitskopie. Git verbindet beide Rechner; ein GitHub-Actions-Runner oder GitHub-Secrets sind für diesen Ablauf nicht erforderlich.

HUD-Dateien und Server-Plugin werden getrennt aktualisiert. Das Skript veröffentlicht Layout und Styles im Workshop. Änderungen an Menüs, Rollen, Favoriten und Trainingsaktionen erfordern zusätzlich ein aktuelles CS2-Image mit dem Plugin und gegebenenfalls ein neues Dashboard-Image. In Coolify aus dem passenden Commit bauen und bereitstellen, dann Einstellungen mit **Apply & restart** übernehmen.

## Windows einmal einrichten

1. Git for Windows installieren und das Repository klonen, falls die Arbeitskopie noch nicht existiert. Dieser Projektordner darf beispielsweise auf dem Desktop liegen. Er muss eine Git-Arbeitskopie sein; ein ZIP-Download reicht für das automatische Update nicht aus.
2. CS2 einschließlich Workshop Tools installieren oder aktualisieren. Unter dem CS2-Installationsverzeichnis muss `game/bin/win64/resourcecompiler.exe` existieren. Das Addon `playbook_training_hud` einmal in den Workshop Tools anlegen, falls dieser Rechner es noch nicht kennt.
3. PowerShell 7 und das .NET 10 **SDK** installieren. In Windows PowerShell:

   ```powershell
   winget install --id Microsoft.PowerShell --source winget
   winget install --id Microsoft.DotNet.SDK.10 --exact
   ```

   Anschließend ein neues Terminal verwenden, damit die Programme im Suchpfad verfügbar sind. Die mit Windows mitgelieferte PowerShell 5.1 und eine reine .NET-Runtime reichen nicht aus.

SteamCMD installiert das Skript beim ersten Upload direkt von Valve unter `training-hud/.local/steamcmd/`. Eine bestehende Installation kannst du mit `-SteamCmd 'C:/steamcmd/steamcmd.exe'` verwenden. Melde dich mit dem Steam-Anmeldenamen des Workshop-Erstellers an, nicht mit Anzeigename oder Steam64-ID. Passwort und Steam Guard werden bei Bedarf direkt von SteamCMD abgefragt. Die Anmeldung im normalen Steam-Client ersetzt die SteamCMD-Anmeldung nicht.

`training-hud/.local/settings.json` merkt sich CS2-Pfad, SteamCMD-Pfad, Steam-Anmeldename und die zuletzt gewählte Sichtbarkeit. Passwort und Guard-Code werden vom Skript nicht gespeichert. SteamCMD verwaltet seinen eigenen Login-Token. Das gesamte `.local`-Verzeichnis und die Build-Ausgaben unter `dist` sind von Git ausgeschlossen und bleiben auf diesem Windows-PC. Für eine erneute Einrichtung die lokalen Einstellungen bearbeiten oder `settings.json` entfernen.

## Mit einer Datei aktualisieren und optional veröffentlichen

Auf dem Mac die Änderungen committen und pushen. Dann auf Windows CS2 vollständig beenden und im Projekt-Root **[hud.cmd](../hud.cmd) doppelklicken**. Das Skript funktioniert unabhängig davon, aus welchem Verzeichnis es gestartet wurde. Alternativ in Git Bash:

```bash
./hud.sh
```

Der Ablauf ist bei jeder normalen Ausführung derselbe:

1. Die Git-Arbeitskopie wird mit `git pull --ff-only` auf den Stand ihres eingestellten Upstream-Branches gebracht, beim normalen Klonen also `origin/main`. Ein fehlgeschlagenes Update bricht den Ablauf vor dem HUD-Build ab. Lokale Änderungen und eigene Commits werden nicht zurückgesetzt. Nach dem Pull wird das heruntergeladene Release-Skript verwendet.
2. Beim ersten Start erkennt es CS2 über die Steam-Bibliotheken oder fragt nach dem Installationsverzeichnis. Beispiel: `D:/SteamLibrary/steamapps/common/Counter-Strike Global Offensive`. Leerzeichen im Pfad sind erlaubt.
3. Es kompiliert die zwei Panorama-Dateien, erstellt mit ValvePak das Workshop-VPK und prüft dessen Inhalt nach erneutem Öffnen. Die vorherigen lokalen HUD-Dateien werden gesichert; anschließend wird der neue Build in `game/csgo/panorama` und im Addon `playbook_training_hud` installiert.
4. Es prüft die installierten Panorama-Dateien, installiert die App-Abhängigkeiten mit `npm ci`, testet und baut die Electron-App samt Windows-Hilfsprogramm. Die frisch gebaute App unter `playbook-desktop/dist/win-unpacked/Playbook.exe` wird direkt geöffnet. Ein Installer und eine Workshop-Rückfrage sind dafür nicht nötig. Für den Review in Playbook **Server → Reviews** öffnen, CS2 starten und das Spielbild freigeben.

Zum vollständigen Update müssen Git for Windows, PowerShell 7, Node.js 22 oder neuer einschließlich npm, .NET SDK 10 und die CS2 Workshop Tools installiert sein. Laufende Reviews vorher beenden. Ein fehlgeschlagener Pull oder Build öffnet keine ältere App. Das Workshop-Paket bleibt für einen späteren, ausdrücklich gestarteten Release vorbereitet.

Mit `hud.cmd -Mode release` fragt das Skript: **Diesen HUD-Stand auch im Steam Workshop veröffentlichen?** Nach `j` folgen Änderungsnotiz und Sichtbarkeit. `public` ist beim ersten Release die Vorgabe; `keep` erhält die bestehende Sichtbarkeit. Der Steam-Anmeldename wird nur beim ersten Release abgefragt. SteamCMD wird bei Bedarf installiert und meldet dich an. Passwort und Steam Guard direkt dort beantworten. Anschließend wird das vorbereitete VPK auf Item **3810441722** hochgeladen, ohne das HUD oder Playbook erneut zu bauen. Erfolg muss durch SteamCMD für diese Item-ID bestätigt werden.

Wenn Commit, HUD-Quellen, kompilierte Dateien, VPK oder lokale Overrides nach dem Build geändert wurden, stoppt der Release. Erneut `hud.cmd` ausführen und das lokale HUD aktualisieren. Bei einem reinen Login- oder Upload-Fehler bleibt das vorbereitete Paket für einen erneuten Versuch erhalten. Ein abgebrochener Upload kann bereits Daten an Steam übertragen haben; vor einem erneuten Versuch das Änderungsdatum auf der Workshop-Seite prüfen.

## Das lokale HUD bei Bedarf testen

Im Dashboard unter **Server → Trainings-HUD** das HUD aktivieren und **HUD über Workshop ausliefern** ausschalten. Mit **Apply & restart** übernehmen. CS2 für den Review über Playbook starten oder für einen reinen Panel-Test normal über Steam, den Trainingsserver betreten und `.nades` verwenden. Neue Server-Funktionen brauchen auch das aktuelle Plugin auf dem Server.

Im eigenständigen Nades-Training oder in MatchZy Practice neun Listenplätze, Mausnavigation, Seitenwechsel, Lineup laden, Favoriten und Ausblenden prüfen. Die Rolle **Trainingsspieler** kann anhand der Steam64-ID im Dashboard freigeschaltet werden. Anschließend CS2 vollständig beenden und bei Bedarf den unten beschriebenen späteren Release verwenden.

## Später veröffentlichen oder die Workshop-Version testen

Die folgenden Befehle in PowerShell oder Eingabeaufforderung sind Alternativen zur normalen Aktualisierung:

```powershell
# Den zuletzt gebauten und lokal installierten Stand nach Spieltest veröffentlichen:
./hud.cmd -Mode release

# Lokale Overrides sichern und entfernen, damit das Workshop-HUD sichtbar wird:
./hud.cmd -Mode live

# Nur den Zustand der lokalen Dateien prüfen, auch bei laufendem CS2:
./hud.cmd -Mode status
```

`release` fragt erneut nach der Veröffentlichung und verwendet das vorhandene Paket. Es zieht keinen neuen Git-Stand und baut nichts neu, damit der zuvor lokal installierte Stand erhalten bleibt. `live` veröffentlicht nichts und benötigt keine SteamCMD-Anmeldung. `status` prüft die Dateien auf der Festplatte; ein laufender Client kann noch ein älteres Layout im Cache halten. Diese drei Modi führen keinen Pull aus. In Git Bash funktionieren dieselben Modi als `./hud.sh release`, `./hud.sh live` und `./hud.sh status`.

Für einen Workshop-Test zusätzlich im Dashboard **HUD über Workshop ausliefern** aktivieren, ID **3810441722** hinterlegen und **Apply & restart** ausführen. CS2 anschließend normal über Steam starten und erneut verbinden. Das Entfernen lokaler Overrides allein lädt noch kein Workshop-Addon herunter.

Mit einem zweiten Spieler testen, der keine lokalen HUD-Dateien hat und nicht mit dem Workshop-Ersteller befreundet ist. Er muss das öffentliche Addon herunterladen können. Er braucht keine Workshop Tools und keine Binds. Ein erfolgreicher Upload beweist noch nicht, dass alle Clients das neue Addon geladen haben.

Direkt in PowerShell 7 funktioniert derselbe Ablauf ohne Git Bash:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File ./training-hud/update-local.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File ./training-hud/update-local.ps1 -Mode release
```

Für abweichende Pfade oder ein anderes Erstellerkonto können `-Cs2`, `-SteamCmd` und `-SteamUsername` übergeben werden. Beispiel in Git Bash:

```bash
./hud.sh update -Cs2 'D:/SteamLibrary/steamapps/common/Counter-Strike Global Offensive' -SteamCmd 'C:/steamcmd/steamcmd.exe' -SteamUsername 'DEIN_STEAM_ANMELDENAME'
```

## Titel, Beschreibung und Workshop Manager

Titel, Beschreibung und Vorschaubild werden beim Skript-Upload erhalten. Diese Angaben über die Besitzerverwaltung der Workshop-Seite ändern. Als Titel „Playbook Training HUD“ verwenden. Titel, Beschreibung, Vorschaubild und Sichtbarkeit ändern die Workshop-ID nicht.

Vorschlag für die Beschreibung:

```text
Trainingspanel für CS2-Communityserver mit Playbook und MultiAddonManager.

Zeigt Granaten-Lineups, persönliche Favoriten und Trainingswerkzeuge in einem kompakten Panel. Der Server liefert Menüs und Funktionen. Mit einer freigeschalteten Rolle im Practice-Modus .nades in den Chat eingeben und das Panel mit der Maus bedienen.

Dieses Addon enthält Client-Dateien, keine spielbare Map und keinen eigenständigen Trainingsmodus. Es benötigt einen Server mit kompatiblem Playbook-Plugin und MultiAddonManager. Spieler brauchen keine Workshop Tools. Zusätzliche Tastaturbelegungen sind freiwillig und müssen lokal eingerichtet werden.

Communityprojekt, keine offizielle Valve-Veröffentlichung.
```

Falls SteamCMD den Upload für App 730 oder das Erstellerkonto ablehnt, das bestehende Addon `playbook_training_hud` in den Workshop Tools öffnen. Im Asset Browser unter **Tools → Counter-Strike 2 Workshop Manager** den bestehenden Eintrag **3810441722** aktualisieren. Die neuen kompilierten Dateien liegen bereits unter `game/csgo_addons/playbook_training_hud/panorama/`. Keine neue Submission erstellen. Vor dem Upload prüfen, dass der Manager diese Dateien einpackt, und anschließend den erfolgreichen Upload bestätigen lassen. Eventuell verlangte Workshop-Vereinbarungen mit dem Erstellerkonto abschließen.

Das Vorschaubild bei Bedarf mit `create-workshop-preview.ps1` erzeugen oder im Workshop Manager ersetzen.

## Release-Nachweis und automatisierte Tests

`training-hud/dist/release.json` enthält Commit, Build-Zeitpunkt, SHA-256 des Pakets sowie Hashes von Quellen und kompilierten Dateien. Ein bestätigter Upload ergänzt `publishedAtUtc`. Das Upload-Verzeichnis enthält ausschließlich `3810441722.vpk`. `dist/workshop-upload.vdf` verwendet absolute Pfade und gilt nur auf dem Rechner, der es erzeugt hat. Diese Dateien enthalten keine Steam-Anmeldedaten.

Die Release-Prüfungen und der interaktive Ablauf lassen sich ohne Valve-Compiler, Spiel, Steam-Konto oder Netzwerk testen:

```powershell
pwsh -NoProfile -File ./training-hud/test-release.ps1
pwsh -NoProfile -File ./training-hud/test-local-release.ps1
pwsh -NoProfile -File ./training-hud/test-update-local.ps1
```

Diese Tests simulieren Compiler und SteamCMD. Der Git-Test arbeitet mit echten lokalen Repositories und prüft das Update sowie den Abbruch bei einem fehlgeschlagenen Pull. Der echte Ablauf einschließlich Ingame-Test und SteamCMD-Upload muss auf dem Windows-PC noch abgenommen werden.

Quellen: [Valve zum Aktualisieren bestehender Workshop-Items](https://partner.steamgames.com/doc/features/workshop/implementation#SteamCmd), [Valve zur Wiederverwendung der SteamCMD-Anmeldung](https://partner.steamgames.com/doc/sdk/uploading#5), [Microsoft zur Installation von PowerShell](https://learn.microsoft.com/en-us/powershell/scripting/install/install-powershell-on-windows), [Microsoft zur Installation des .NET SDK](https://learn.microsoft.com/en-us/dotnet/core/install/windows), [ValvePak](https://github.com/ValveResourceFormat/ValvePak).

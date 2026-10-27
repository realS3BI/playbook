namespace Playbook;

public static class TrainingMenu
{
    public static InGameMenu Create(IReadOnlyList<NadeLineup> library, string map, bool practice,
        NadeLineup? last, string libraryError = "", PlayerPanelSettings? settings = null,
        IReadOnlyList<CompetitiveSpawn>? spawns = null, TrainingToggles? toggles = null,
        MenuPage? maps = null, string steamId = "", bool canWriteNades = true, bool standalone = false)
    {
        MenuItem Action(string title, TrainingAction action, string hint) => new(title, hint, Request: new(action));
        settings ??= new();
        spawns ??= [];
        toggles ??= new();
        MenuItem Toggle(string title, TrainingAction action, bool active, string hint) =>
            Action($"{title} {(active ? "ausschalten" : "einschalten")}", action, $"Aktuell {(active ? "an" : "aus")}. {hint}");
        static string SideLabel(string team) => team switch { "ct" => "CT", "t" => "T", "both" => "Beide", _ => "" };
        MenuItem Lineup(NadeLineup n)
        {
            var own = canWriteNades && n.Owner == steamId && n.Owner != "default" && !n.Official;
            var pending = n.ReviewStatus == "pending";
            var status = n.Official ? "Offiziell" : pending ? "Im Review" : "Aufnahme";
            var steps = n.ThrowSteps is { Length: 3 } recorded ? recorded : null;
            var items = new List<MenuItem> {
                new("Lineup laden & trainieren", "Teleportiert dich zum Lineup-Punkt, stellt die Blickrichtung ein und rüstet die passende Granate aus. Danach selbst werfen." +
                    (steps != null ? $" Ablauf: {string.Join(" → ", steps)}." : ""), Request: new(TrainingAction.LoadLineup, n)),
                new(settings.IsFavorite(n) ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen", "Speichert diese Granate in deiner persönlichen Favoritenliste für diese Map.", Request: new(TrainingAction.ToggleFavorite, n))
            };
            if (steps != null) items.Add(new("Ablauf ansehen", $"{string.Join(" → ", steps)}.", Page: new("Ablauf", "Aus der Aufnahme erkannt: wo du ausrichtest, wie du dich bewegst und wann du loslässt.",
                steps.Select((step, index) => new MenuItem($"{index + 1}. {step}", $"{new[] { "Lineup", "Bewegung", "Abwurf" }[index]}: {step}.", Enabled: false)).ToArray(),
                Key: $"steps:{n.Owner}:{n.Map}:{n.Name}")));
            if (canWriteNades && !n.Official) items.Add(new("Medien-Review", "Vier Fotos und ein Video aufnehmen, anschließend prüfen und freigeben. Verbinde vorher das Spielbild auf der Lineup-Seite im Browser.", Page: ReviewMenu.Create(n, own)));
            if (own)
            {
                items.Add(new("Lineup bearbeiten", "Nimmt den Wurf bewusst neu auf. Position, Blickwinkel, Wurfattribute, Endposition und Flugzeit werden gemeinsam ersetzt, sobald du die Aufnahme speicherst.",
                    Page: new("Lineup bearbeiten", "Der bisherige Wurf bleibt bis zum Speichern erhalten. Ein neuer Wurf setzt Review und Medien zurück.", [
                        new("Wurf neu aufnehmen", "Lädt das Lineup. Passe den Wurf an und wirf genau eine Granate. Danach in diesem Menü speichern oder verwerfen.", Request: new(TrainingAction.EditLineup, n)),
                        new("Aufnahme speichern", "Ersetzt den gespeicherten Wurf durch die fertig gemessene Neuaufnahme. Review und bisherige Medien werden zurückgesetzt.", Request: new(TrainingAction.SaveCapture)),
                        new("Aufnahme verwerfen", "Verwirft die Neuaufnahme. Der bisherige Wurf bleibt erhalten.", Request: new(TrainingAction.CancelCapture)),
                        new("Abbrechen", "Behält die gespeicherten Wurfdaten.", Request: new(TrainingAction.Back))], Key: $"edit:{n.Owner}:{n.Map}:{n.Name}")));
                items.Add(new(pending ? "Review angefragt" : "Zum Review freigeben", pending ? "Ein Plattform-Admin prüft deine Aufnahme. Nach seiner Freigabe erscheint sie zusätzlich unter Offiziell." : "Reicht deine Aufnahme zur Prüfung ein. Unter Alle bleibt sie sichtbar; Offiziell erfordert die Admin-Freigabe.", Request: new(TrainingAction.RequestReview, n), Enabled: !pending));
                items.Add(new("Eigene Aufnahme löschen", "Löscht ausschließlich diese eigene, noch nicht veröffentlichte Aufnahme. Du bestätigst im nächsten Schritt.", Page: new("Aufnahme löschen", n.Title, [
                    new("Abbrechen", "Behält die Aufnahme und geht zurück.", Request: new(TrainingAction.Back)),
                    new("Aufnahme endgültig löschen", "Entfernt diese Aufnahme aus deiner Bibliothek. Das kann nicht rückgängig gemacht werden.", Request: new(TrainingAction.DeleteLineup, n), Danger: true)], Key: $"delete:{n.Owner}:{n.Map}:{n.Name}", Danger: true)));
            }
            MenuItem Setting(string field, string label, string value) => new($"{label}: {value}",
                own ? LineupEditFields.Prompt(field) : "Gespeicherte Angabe.",
                Request: own ? new(TrainingAction.EditField, n, Setting: field) : null, Enabled: own);
            MenuItem Fact(string label, string value) => new($"{label}: {value}", "Automatisch erfasst. Änderungen sind nur über Lineup bearbeiten und eine neue Aufnahme möglich.", Enabled: false);
            var attributes = n.Attributes;
            var fields = new List<MenuItem> {
                Setting("team", "Seite", n.Team switch { "ct" => "CT", "t" => "T", "both" => "Beide", _ => "Offen" }),
                Setting("throwFromTitle", "Startposition", string.IsNullOrEmpty(n.ThrowFromTitle) ? "Offen" : n.ThrowFromTitle),
                Setting("throwToTitle", "Endposition", string.IsNullOrEmpty(n.ThrowToTitle) ? "Offen" : n.ThrowToTitle),
            };
            fields.AddRange(LineupEditFields.Flags.Select(flag => Fact(flag.Value, attributes == null ? "Offen" : attributes.Flag(flag.Key) ? "Ja" : "Nein")));
            fields.Add(Fact("Bewegung", attributes?.MovementLabel ?? "Offen"));
            fields.Add(Fact("Maustaste", attributes?.ClickType switch { "left" => "Links", "right" => "Rechts", "both" => "Beide", _ => "Offen" }));
            fields.Add(Fact("Flugzeit", n.FlightDuration is { } secondsValue ? FormattableString.Invariant($"{secondsValue:0.00} s") : "Noch nicht erfasst"));
            fields.Add(Fact("Granatentyp", NadeCatalog.Label(n.Kind)));
            fields.Add(new("Koordinaten ansehen", "Automatisch gespeicherte Spielkoordinaten.", Page: new("Koordinaten", "Diese Wurfdaten bleiben beim Training erhalten.", [
                Fact("Start", NadeCaptureFile.Vector(n.Position)), Fact("Blickwinkel", NadeCaptureFile.Vector(n.Angles)),
                Fact("Ende", n.LandingPosition is { } target ? NadeCaptureFile.Vector(target) : "Noch nicht erfasst")], Key: $"coordinates:{n.Owner}:{n.Map}:{n.Name}")));
            items.Add(new("Lineup-Einstellungen", "Gespeicherte Wurfdaten ansehen. Der Ersteller kann Startposition, Endposition und Seite ergänzen.",
                Page: new("Lineup-Einstellungen", "Wurfdaten werden automatisch erfasst und bleiben fest gespeichert.", fields, Key: $"attributes:{n.Owner}:{n.Map}:{n.Name}")));
            items.Add(Fact("Flugzeit", n.FlightDuration is { } duration ? FormattableString.Invariant($"{duration:0.00} s") : "Noch nicht erfasst"));
            var description = string.IsNullOrWhiteSpace(n.Description) ? "Noch keine Beschreibung." : n.Description;
            var facts = new List<string>();
            if (n.Team.Length > 0) facts.Add(n.Team switch { "ct" => "CT", "t" => "T", _ => "Beide Seiten" });
            if (n.ThrowFromTitle.Length > 0 || n.ThrowToTitle.Length > 0) facts.Add($"{n.ThrowFromTitle} → {n.ThrowToTitle}");
            var technique = new List<string>();
            if (n.Attributes is { } a) {
                technique.AddRange(LineupEditFields.Flags.Where(flag => a.Flag(flag.Key)).Select(flag => flag.Value));
                technique.Add(a.MovementLabel);
                technique.Add(a.ClickType switch { "right" => "Rechtsklick", "both" => "Beide Maustasten", _ => "Linksklick" });
            }
            facts.AddRange(technique);
            if (n.FlightDuration is { } seconds) facts.Add(FormattableString.Invariant($"Flugzeit {seconds:0.00} s"));
            if (facts.Count > 0) description = string.Join(" · ", facts) + ". " + description;
            // Status line (A8): what the row is, in the order a player scans it.
            var statusParts = new List<string> { status, NadeCatalog.Label(n.Kind) };
            if (SideLabel(n.Team) is { Length: > 0 } sideLabel) statusParts.Add(sideLabel);
            statusParts.AddRange(technique);
            if (n.FlightDuration is { } flight) statusParts.Add(FormattableString.Invariant($"{flight:0.00} s"));
            var side = n.Team is "t" or "ct" ? n.Team : "";
            return new(n.Title, $"{status}. {description}",
                Page: new(n.Title, description, items, Key: $"lineup:{n.Owner}:{n.Map}:{n.Name}"),
                Meta: SideLabel(n.Team), Kind: n.Kind, Side: side, Favorite: settings.IsFavorite(n), Review: pending, Official: n.Official,
                Status: string.Join(" · ", statusParts), Lineup: n, MustKnow: n.MustKnow);
        }
        MenuPage Lineups(string title, IEnumerable<NadeLineup> entries, string key, string? emptyHint = null, NadeKind? kind = null) => new(title,
            libraryError.Length > 0 ? libraryError : entries.Any() ? "Granate auswählen, Beschreibung lesen und zum Abwurfpunkt springen."
                : emptyHint ?? "Noch keine Granaten in dieser Auswahl. Eigene Würfe über Neue Nade aufnehmen speichern.", entries.Select(Lineup).ToArray(), Key: key, Kind: kind);
        MenuItem Filter(NadeKind kind, string title, Func<NadeLineup, bool> predicate, string key, string hint)
        {
            var entries = library.Where(n => n.Kind == kind && predicate(n)).ToArray();
            return new(title, hint, Page: Lineups(title, entries, $"filter:{kind}:{key}", kind: kind), Kind: kind);
        }
        var categories = Enum.GetValues<NadeKind>().Where(k => k != NadeKind.Other || library.Any(n => n.Kind == k))
            .Select(kind => new MenuItem(NadeCatalog.Label(kind),
                $"{NadeCatalog.Label(kind)} auf {map}: Favoriten, geprüfte offizielle Lineups, Must Know oder alle verfügbaren Aufnahmen.",
                Page: new(NadeCatalog.Label(kind), "Wähle eine Sammlung für diesen Granatentyp.", [
                    Filter(kind, "Favoriten", settings.IsFavorite, "favorites", "Deine persönlich gemerkten Granaten dieses Typs auf dieser Map."),
                    Filter(kind, "Offiziell", n => n.Official, "official", "Vom Plattform-Admin geprüfte und für alle freigegebene Lineups."),
                    Filter(kind, "Must Know", n => n.MustKnow, "must-know", "Vom Admin ausgewählte Grundlagen, die du auf dieser Map beherrschen solltest."),
                    Filter(kind, "Alle", _ => true, "all", "Alle für dich verfügbaren Granaten: alle Spieleraufnahmen und offizielle Lineups.")
                ], Key: $"category:{kind}", Kind: kind), Kind: kind)).ToArray();
        if (canWriteNades) categories = [..categories, new("Medien-Reviews", "Aufnahmen dieser Map dokumentieren und prüfen. Eingereichte Reviews stehen zuerst.",
            Page: Lineups("Medien-Reviews", library.Where(n => !n.Official).OrderByDescending(n => n.ReviewStatus == "pending"), "reviews"))];
        var favoriteEntries = library.Where(settings.IsFavorite).ToArray();
        var mustKnow = library.Where(n => n.MustKnow).ToArray();
        // Recently loaded lineups in training order, newest first (B3).
        var recent = settings.Recent.Select(reference => library.FirstOrDefault(n => NadeReference.From(n) == reference))
            .Where(n => n != null).Select(n => n!).ToArray();
        var spawnMenu = new MenuPage("Competitive-Spawns", "CT- oder T-Seite wählen. Teleportiert dich, ohne dein Team zu ändern.",
            new[] { 3, 2 }.Select(team => {
                var name = team == 3 ? "CT" : "T";
                var points = spawns.Where(s => s.Team == team).ToArray();
                return new MenuItem($"{name}-Spawns", $"Startpositionen der {name}-Seite für ein Competitive-Match auf dieser Map.",
                    Page: new($"{name}-Spawns", points.Length == 0 ? "Keine aktiven Competitive-Spawns gefunden." : "Spawn wählen. Belegte Positionen werden nicht benutzt.",
                        points.Select((spawn, index) => new MenuItem($"{name}-Spawn {index + 1:00}",
                            $"Teleportiert dich zu {name}-Startposition {index + 1} mit deren Blickrichtung. Dein Team bleibt unverändert.",
                            Request: new(TrainingAction.TeleportSpawn, Spawn: spawn), Side: team == 3 ? "ct" : "t")).ToArray(), Key: $"spawns:{team}"), Side: team == 3 ? "ct" : "t");
            }).ToArray(), Key: "spawns");
        var bots = new MenuPage("Bots", "Trainingsziele platzieren oder die Trainingsbots entfernen.", [
            Action("Bot hier platzieren", TrainingAction.Bot, "Platziert einen stehenden Trainingsbot an deiner Position und mit deiner Blickrichtung."),
            Action("Duckenden Bot platzieren", TrainingAction.CrouchBot, "Platziert einen duckenden Trainingsbot an deiner Position, etwa als Ziel für eine Flash."),
            Action("Bots entfernen", TrainingAction.RemoveBots, "Entfernt sofort alle Trainingsbots. Betrifft alle Spieler auf dem Server.")], Key: "bots");
        var switches = new MenuPage("Trainingshilfen", "Beschriftungen zeigen die nächste Aktion; die Beschreibung zeigt den aktuellen Zustand.", [
            Toggle("Flugbahnvorschau", TrainingAction.Trajectory, toggles.Trajectory, "Zeigt die Vorschau der Granatenflugbahn. Gilt für den gesamten Server."),
            Toggle("Einschläge", TrainingAction.Impacts, toggles.Impacts, "Markiert Geschosseinschläge. Gilt für den gesamten Server."),
            Toggle("Flashschutz", TrainingAction.NoFlash, toggles.NoFlash, "Verhindert Blendung durch Flashbangs für dich."),
            Toggle("God Mode", TrainingAction.God, toggles.God, standalone
                ? "Verhindert Schaden vollständig. Ohne God Mode bekommst du Schaden und wirst beim tödlichen Treffer sofort auf 100 HP zurückgesetzt."
                : "Schaltet deinen Schutz vor Schaden ein oder aus.")], Key: "toggles");
        var tools = new MenuPage("Trainingswerkzeuge", "Würfe wiederholen, Positionen merken und Trainingshilfen bedienen.", [
            Action("Letzten Wurf wiederholen", TrainingAction.Rethrow, "Wirft deine zuletzt geworfene Granate erneut mit derselben Flugbahn; du kannst die Wirkung von anderswo beobachten."),
            Action("Zum letzten Abwurfpunkt", TrainingAction.LastThrow, "Bringt dich an die Position deiner zuletzt geworfenen Granate zurück."),
            Action("Position merken", TrainingAction.SavePosition, "Merkt deine aktuelle Position und Blickrichtung für Gemerkte Position laden."),
            Action("Gemerkte Position laden", TrainingAction.LoadPosition, "Teleportiert dich zur zuvor gemerkten Position und stellt deine Blickrichtung wieder her."),
            Action("Granaten entfernen", TrainingAction.ClearGrenades, "Entfernt sofort aktive Granaten und ihre Effekte. Betrifft das Training aller Spieler."),
            new("Bots", "Stehenden oder duckenden Bot platzieren oder Trainingsbots entfernen.", Page: bots),
            new("Trainingshilfen", "Flugbahnvorschau, Einschläge, Flashschutz und God Mode ein- oder ausschalten.", Page: switches),
            Action("Position & Blickwinkel prüfen", TrainingAction.CheckPosition, "Zeigt deine aktuellen Koordinaten und Blickwinkel im Beschreibungsbereich."),
            new("Zuletzt trainiert", "Die letzten fünf Lineups, die du auf dieser Map geladen hast. Das neueste steht oben.",
                Page: Lineups("Zuletzt trainiert", recent, "recent", "Noch nichts trainiert. Lade ein Lineup aus der Bibliothek; es erscheint danach hier."))], Key: "tools");
        var home = new List<MenuItem> {
            new("Granaten-Bibliothek", $"{library.Count} verfügbare Granaten auf {map}. Wähle zuerst den Granatentyp und danach deine Sammlung. {libraryError}", Page: new("Granaten-Bibliothek", "Granatentyp auswählen.", categories), Enabled: practice),
            new("Must Know", "Starte hier: wichtige Lineups für diese Map, vom Plattform-Admin ausgewählt.", Page: Lineups("Must Know", mustKnow, "must-know"), Enabled: practice),
            new("Trainingswerkzeuge", "Würfe wiederholen, Positionen merken, Bots platzieren, Trainingshilfen einstellen und zuletzt trainierte Lineups erneut laden.", Page: tools, Enabled: practice),
            new("Neue Nade aufnehmen", "Aufnahme starten, eine Granate werfen und nach ihrer Wirkung speichern. Sie erscheint unter Alle und ist noch nicht offiziell geprüft.",
                Page: new("Nade aufnehmen", "Nach dem Wurf mit KP_0 zurück ins Panel wechseln und Aufnahme speichern wählen.", [
                    Action("Aufnahme starten", TrainingAction.StartCapture, "Wirf innerhalb von drei Minuten eine Granate. Abwurfpunkt, Blickwinkel, Jumpthrow, Ducken, Bewegung, Maustaste, Ziel und Flugzeit werden automatisch erfasst."),
                    Action("Aufnahme speichern", TrainingAction.SaveCapture, "Speichert die fertige Aufnahme mit einem automatischen Namen. Unter Alle kannst du Name und Beschreibung bearbeiten und einen Review anfragen."),
                    Action("Aufnahme verwerfen", TrainingAction.CancelCapture, "Verwirft die laufende oder noch ungespeicherte Aufnahme. Bereits gespeicherte Granaten bleiben erhalten.")]), Enabled: practice),
            new("Favoriten", "Deine gemerkten Granaten auf dieser Map. Über den Stern in der Liste oder die Detailansicht hinzufügen oder entfernen.", Page: Lineups("Favoriten", favoriteEntries, "favorites"), Enabled: practice),
            new("Competitive-Spawns", "Startpositionen der CT- oder T-Seite auswählen und direkt dorthin teleportieren.", Page: spawnMenu, Enabled: practice),
            new("Map wechseln", "Startet eine 30-Sekunden-Abstimmung. Mehr als die Hälfte der beim Start verbundenen Spieler muss zustimmen; Bots zählen nicht.", Page: maps ?? new("Map wechseln", "Keine Maps verfügbar.", [], Key: "maps"), Enabled: practice),
            Action("Keybinds", TrainingAction.Settings, "Feste Tastenbelegung nachlesen und Bind-Befehle für die einmalige Einrichtung in deiner Konsole anzeigen."),
            Action("Panel ausblenden", TrainingAction.Close, "Blendet das Panel aus und gibt die Spielsteuerung frei. Mit .nades im Chat erneut öffnen.")
        };
        if (!canWriteNades) home.RemoveAll(item => item.Label == "Neue Nade aufnehmen");
        if (canWriteNades) {
            var pending = library.Where(n => n.Map == map && !n.Official && n.ReviewStatus == "pending").ToArray();
            home.Insert(7, new("Reviews", "Ausstehende Reviews dieser Map öffnen, Angaben und Medien prüfen und anschließend freigeben.",
                Page: Lineups("Ausstehende Reviews", pending, "home-reviews"), Enabled: practice, Review: pending.Length > 0));
        }
        return new(new("Playbook", "Practice-Werkzeuge und Granaten für die aktuelle Map.", home), map);
    }

    // Fixed allowlist only. Never execute labels, descriptions or library data as commands.
    // Run in the player's context so MatchZy's own permission checks remain authoritative.
    public static string? Command(TrainingAction action) => action switch
    {
        TrainingAction.StartPractice => "css_prac",
        TrainingAction.Rethrow => "css_rethrow", TrainingAction.LastThrow => "css_last",
        TrainingAction.ClearGrenades => "css_clear", TrainingAction.SavePosition => "css_savepos",
        TrainingAction.LoadPosition => "css_loadpos", TrainingAction.Noclip => "noclip",
        TrainingAction.Bot => "css_bot", TrainingAction.CrouchBot => "css_crouchbot",
        TrainingAction.RemoveBots => "css_nobots", TrainingAction.Trajectory => "css_traj",
        TrainingAction.Impacts => "css_impacts", TrainingAction.NoFlash => "css_noflash",
        TrainingAction.God => "css_god", TrainingAction.BestSpawn => "css_bestspawn",
        TrainingAction.WorstSpawn => "css_worstspawn", _ => null
    };

    public static string ActionHint(TrainingAction action) => action switch
    {
        TrainingAction.StartPractice => "Training wird nach erfolgreicher Aktivierung hier freigeschaltet.",
        _ => "Du kannst weiterspielen. Mit .nades im Chat das Panel erneut öffnen. MatchZy meldet Details weiterhin im Chat."
    };
}

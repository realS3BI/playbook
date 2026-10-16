using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using Microsoft.Extensions.Logging;

namespace Playbook;

public sealed partial class PlaybookPlugin
{
    private readonly NadeCaptureTracker _capture = new();
    private readonly GrenadeFlightTracker _flightTimes = new();
    private sealed record DraftNameRequest(string Owner, NadeKind Kind, string Map,
        Coordinates Start, Coordinates Angles, Coordinates Target, string Technique, string Trace,
        ThrowAttributes Attributes, string Team, float FlightDuration, NadeLineup? Original = null);
    private readonly Dictionary<int, float> _saveRequests = [];
    private readonly Dictionary<int, List<ThrowSample>> _saveSamples = [];
    private readonly Dictionary<int, DraftNameRequest> _draftNameRequests = [];
    private readonly Dictionary<int, NadeLineup> _captureEdits = [];

    private void RegisterCapture()
    {
        RegisterListener<Listeners.OnEntitySpawned>(CaptureProjectile);
        RegisterListener<Listeners.OnEntityDeleted>(LogRethrowDeletion);
        RegisterEventHandler<EventGrenadeThrown>((e, _) =>
        {
            var player = e.Userid;
            if (player == null || !TrainingEnabled) return HookResult.Continue;
            var kind = ThrownKind(e.Weapon);
            if (kind == NadeKind.Fire) _fireEffectOrigins.Begin(player.SteamID, Server.CurrentTime);
            if (StandaloneTraining)
                Logger.LogInformation("[Rethrow] grenade_thrown empfangen: SteamID={SteamId}, Waffe={Weapon}, Typ={Type}, Simulationszeit={Time}",
                    player.SteamID, e.Weapon, kind, Server.CurrentTime);
            _flightTimes.Thrown(player.Slot, player.SteamID, kind, Server.CurrentTime);
            if (_saveRequests.TryGetValue(player.Slot, out var saveExpires))
            {
                if (saveExpires < Server.CurrentTime) _saveRequests.Remove(player.Slot);
                else if (kind == NadeKind.Other)
                {
                    Tell(player, $"Granatentyp nicht erkannt: {MenuRenderer.Plain(e.Weapon, 60)}. Die Aufnahme bleibt bereit.");
                    Logger.LogWarning("Unbekannte Waffenkennung bei grenade_thrown während der Aufnahme: {Weapon}", e.Weapon);
                    return HookResult.Continue;
                }
                else if (player.PlayerPawn.Value is { IsValid: true } pawn && pawn.AbsOrigin is { } origin)
                {
                    _saveRequests.Remove(player.Slot);
                    var start = new Coordinates(origin.X, origin.Y, origin.Z + 4);
                    var angles = new Coordinates(pawn.EyeAngles.X, pawn.EyeAngles.Y, pawn.EyeAngles.Z);
                    var samples = _saveSamples.GetValueOrDefault(player.Slot) ?? [];
                    AddSample(samples, player, pawn);
                    var motion = ThrowMotion.Analyze(samples);
                    // Anlauf and jumpthrows are loaded where the player stood and aimed, not where the grenade left.
                    if (motion is { Setup.Found: true } && motion.Setup.Index != samples.Count - 1)
                        (start, angles) = (motion.Setup.Position, motion.Setup.View);
                    var trace = ThrowTechnique.Serialize(samples);
                    var owner = player.SteamID.ToString(System.Globalization.CultureInfo.InvariantCulture);
                    _capture.Forget(player.Slot);
                    var draft = new NadeLineup(owner, $"capture_{Guid.NewGuid():N}", Server.MapName,
                        kind, "", start, angles, "", trace, Team: player.TeamNum switch { 3 => "ct", 2 => "t", _ => "" },
                        Attributes: motion?.Attributes ?? new());
                    _capture.Arm(player.Slot, player.SteamID, draft, Server.CurrentTime);
                    _capture.Thrown(player.Slot, player.SteamID, kind, Server.CurrentTime);
                    _saveSamples.Remove(player.Slot);
                    Tell(player, $"Wurf erkannt: {NadeCatalog.Label(kind)}. Warte auf die Explosion.");
                    return HookResult.Continue;
                }
            }
            var expected = _capture.ArmedKind(player.Slot, player.SteamID, Server.CurrentTime);
            var matched = _capture.Thrown(player.Slot, player.SteamID, kind, Server.CurrentTime);
            if (expected.HasValue && !matched)
                Tell(player, $"Erfassung erwartet {NadeCatalog.Label(expected.Value)}, geworfen wurde {NadeCatalog.Label(kind)}. Lineup erneut laden und passende Granate werfen.");
            else if (matched) Tell(player, "Wurf erkannt. Das Ziel wird bei der Explosion gespeichert.");
            return HookResult.Continue;
        });
        RegisterEventHandler<EventSmokegrenadeDetonate>((e, _) => CompleteCapture(e.Entityid, e.Userid, NadeKind.Smoke, new(e.X, e.Y, e.Z)));
        RegisterEventHandler<EventFlashbangDetonate>((e, _) => CompleteCapture(e.Entityid, e.Userid, NadeKind.Flash, new(e.X, e.Y, e.Z)));
        RegisterEventHandler<EventHegrenadeDetonate>((e, _) => CompleteCapture(e.Entityid, e.Userid, NadeKind.HE, new(e.X, e.Y, e.Z)));
        RegisterEventHandler<EventMolotovDetonate>((e, _) => CompleteFireCapture(e.Userid, new(e.X, e.Y, e.Z)));
        RegisterEventHandler<EventDecoyStarted>((e, _) => CompleteCapture(e.Entityid, e.Userid, NadeKind.Decoy, new(e.X, e.Y, e.Z)));
        RegisterNadeFeedback();
        RegisterEventHandler<EventRoundStart>((_, _) => { ResetCapture(); return HookResult.Continue; });
        RegisterEventHandler<EventPlayerDeath>((e, _) => {
            // A released dropper smoke must still finish measuring after the thrower dies.
            if (e.Userid is { } p && !_capture.HasThrown(p.Slot)) ClearCapture(p.Slot);
            return HookResult.Continue;
        });
    }

    private static NadeKind ProjectileKind(string name) => name switch
    {
        "smokegrenade_projectile" => NadeKind.Smoke,
        "flashbang_projectile" => NadeKind.Flash,
        "hegrenade_projectile" => NadeKind.HE,
        "molotov_projectile" or "incendiary_projectile" => NadeKind.Fire,
        "decoy_projectile" => NadeKind.Decoy,
        _ => NadeKind.Other
    };

    private static NadeKind ThrownKind(string weapon)
    {
        var name = weapon.Trim().ToLowerInvariant();
        if (name.StartsWith("weapon_", StringComparison.Ordinal)) name = name[7..];
        // The incendiary weapon is incgrenade, but uses a molotov projectile.
        return name switch
        {
            "molotov" or "incgrenade" or "incendiary" => NadeKind.Fire,
            _ => ProjectileKind(name + "_projectile")
        };
    }

    private static void AddSample(List<ThrowSample> samples, CCSPlayerController player, CCSPlayerPawn pawn)
    {
        if (pawn.AbsOrigin is not { } origin) return;
        var velocity = pawn.AbsVelocity;
        samples.Add(new(Server.CurrentTime, NadeCaptureFile.Vector(new(origin.X, origin.Y, origin.Z)),
            NadeCaptureFile.Vector(new(velocity.X, velocity.Y, velocity.Z)),
            FormattableString.Invariant($"{pawn.EyeAngles.X:0.##} {pawn.EyeAngles.Y:0.##} {pawn.EyeAngles.Z:0.##}"), player.Buttons.ToString()));
    }

    // Remaining capture window for the panel countdown (docs/ingame-panel-ux.md, D4).
    private float? CaptureSecondsLeft(int slot) =>
        _saveRequests.TryGetValue(slot, out var expires) && expires > Server.CurrentTime ? expires - Server.CurrentTime : null;

    private void ArmNewLineupCapture(CCSPlayerController player)
    {
        if (!CanWriteNades(player)) return;
        ReleaseControl(player.Slot);
        if (_draftNameRequests.ContainsKey(player.Slot))
        { Tell(player, "Es gibt eine ungespeicherte Aufnahme. Zuerst Aufnahme speichern oder verwerfen wählen."); return; }
        ClearCapture(player.Slot);
        _saveSamples[player.Slot] = [];
        if (player.PlayerPawn.Value is { IsValid: true } pawn) AddSample(_saveSamples[player.Slot], player, pawn);
        _saveRequests[player.Slot] = Server.CurrentTime + 180;
        Tell(player, "Aufnahme bereit. Wirf genau eine Granate; Position, Blickwinkel und Tastenfolge werden erfasst.");
    }

    private void RecordSaveInputs()
    {
        foreach (var (slot, expires) in _saveRequests.ToArray())
        {
            var player = Utilities.GetPlayers().FirstOrDefault(p => p is { IsValid: true } && p.Slot == slot);
            if (expires < Server.CurrentTime || player is not { IsValid: true, PawnIsAlive: true } || player.PlayerPawn.Value is not { IsValid: true } pawn)
            {
                _saveRequests.Remove(slot);
                _saveSamples.Remove(slot);
                if (player is { IsValid: true }) Tell(player, "Aufnahme abgelaufen. Im Panel erneut starten.");
                continue;
            }
            if (!_saveSamples.TryGetValue(slot, out var samples)) _saveSamples[slot] = samples = [];
            if (samples.Count == 0 || Server.CurrentTime - samples[^1].Time >= 0.02f) AddSample(samples, player, pawn);
            samples.RemoveAll(sample => Server.CurrentTime - sample.Time > 8f);
            if (samples.Count > 512) samples.RemoveRange(0, samples.Count - 512);
        }
    }

    private bool TrySaveNameFromChat(CCSPlayerController? player, string rawText)
    {
        if (!CanWriteNades(player)) return false;
        if (!TrainingEnabled || player is not { IsValid: true } || !_draftNameRequests.TryGetValue(player.Slot, out var request)) return false;
        var displayName = rawText.Trim().Trim('"').Trim();
        if (displayName.Equals("cancel", StringComparison.OrdinalIgnoreCase) || displayName.Equals("abbrechen", StringComparison.OrdinalIgnoreCase) ||
            displayName.Equals(".cancel", StringComparison.OrdinalIgnoreCase))
        {
            _draftNameRequests.Remove(player.Slot);
            Tell(player, "Nade-Aufnahme verworfen.");
            return true;
        }
        if (displayName.StartsWith('.') || displayName.StartsWith('!')) return false;
        if (request.Original != null)
        { Tell(player, "Ersetzte Aufnahme im Panel speichern oder verwerfen. Der Lineup-Name bleibt erhalten."); return true; }
        displayName = new string(displayName.Where(c => !char.IsControl(c)).Take(120).ToArray()).Trim();
        var name = System.Text.RegularExpressions.Regex.Replace(displayName.ToLowerInvariant(), "[^a-z0-9_-]+", "-").Trim('-', '_');
        if (displayName.Length == 0 || name.Length == 0)
        {
            Tell(player, "Bitte einen Namen mit mindestens einem Buchstaben oder einer Zahl eingeben (oder 'abbrechen').");
            return true;
        }
        name = name[..Math.Min(name.Length, 64)];
        var used = new HashSet<string>((ReadLibrary(player, quiet: true) ?? []).Where(n => n.Owner == request.Owner && n.Map == request.Map)
            .Select(n => n.Name), StringComparer.OrdinalIgnoreCase);
        var baseName = name;
        for (var suffix = 2; used.Contains(name); suffix++) name = $"{baseName[..Math.Min(baseName.Length, 58)]}-{suffix}";
        try
        {
            NadeCaptureFile.Write(Path.Combine(Path.GetDirectoryName(_libraryPath)!, "savednades.captures.json"),
                NadeCaptureFile.CreateNew(request.Owner, name, displayName, request.Map, request.Kind,
                    request.Start, request.Angles, request.Target, request.Technique, request.Trace, request.Attributes, request.Team, request.FlightDuration));
            _draftNameRequests.Remove(player.Slot);
            Tell(player, $"{MenuRenderer.Plain(displayName, 100)} gespeichert. Dashboard und Ingame-Bibliothek übernehmen das Lineup automatisch.");
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.Text.Json.JsonException)
        {
            Logger.LogWarning(error, "Could not persist newly captured nade");
            Tell(player, "Lineup konnte nicht gespeichert werden. Aufnahme bleibt erhalten; Speichern erneut versuchen.");
        }
        return true;
    }

    private void SavePanelCapture(CCSPlayerController player)
    {
        if (!_draftNameRequests.TryGetValue(player.Slot, out var request))
        {
            Tell(player, "Noch keine fertige Aufnahme. Aufnahme starten, werfen und Explosion abwarten.");
            return;
        }
        if (request.Map != Server.MapName)
        { ClearCapture(player.Slot); Tell(player, "Die Aufnahme gehört zu einer anderen Map. Bitte erneut aufnehmen."); return; }
        if (request.Original is { } original)
        {
            var current = ReadLibrary(player)?.FirstOrDefault(n => n.Owner == original.Owner && n.Map == original.Map && n.Name == original.Name);
            if (current == null || current.Official || current.Revision != original.Revision || current.Owner != player.SteamID.ToString())
            { Tell(player, "Das Lineup wurde inzwischen geändert oder freigegeben. Aufnahme verwerfen und erneut bearbeiten."); return; }
            try
            {
                var capture = NadeCaptureFile.CreateReplacement(original, request.Kind, request.Start, request.Angles, request.Target,
                    request.Technique, request.Trace, request.Attributes, request.FlightDuration);
                var value = System.Text.Json.JsonSerializer.SerializeToElement(capture,
                    new System.Text.Json.JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase });
                if (QueueLineupRequest(player, original, "replace", value)) _draftNameRequests.Remove(player.Slot);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.Text.Json.JsonException)
            { Logger.LogWarning(error, "Could not persist lineup replacement"); Tell(player, "Lineup konnte nicht gespeichert werden. Bitte erneut versuchen."); }
            return;
        }
        // A unique suffix also prevents collisions with captures awaiting dashboard sync.
        var name = $"{NadeCatalog.Label(request.Kind)} {request.Map} {DateTime.UtcNow:yyyyMMdd-HHmmss} {Guid.NewGuid().ToString("N")[..6]}";
        TrySaveNameFromChat(player, name);
    }

    private void ArmLineupEdit(CCSPlayerController player, NadeLineup selected)
    {
        var lineup = ReadLibrary(player)?.FirstOrDefault(n => n.Owner == selected.Owner && n.Map == selected.Map && n.Name == selected.Name);
        if (!CanWriteNades(player) || !TrainingEnabled || lineup == null || lineup.Owner != player.SteamID.ToString() || lineup.Official)
        { Tell(player, "Nur deine eigenen, noch nicht offiziellen Lineups können neu aufgenommen werden."); return; }
        if (_draftNameRequests.ContainsKey(player.Slot))
        { Tell(player, "Zuerst die laufende Aufnahme speichern oder verwerfen."); return; }
        if (string.IsNullOrEmpty(lineup.Revision))
        { Tell(player, "Das Lineup wird noch synchronisiert. Bitte kurz warten."); return; }
        LoadLineup(player, lineup);
        ArmNewLineupCapture(player);
        _captureEdits[player.Slot] = lineup;
        Tell(player, "Lineup bearbeiten: Passe Position und Wurf an. Die nächste Granate wird vollständig neu gemessen. Danach unter Lineup bearbeiten bewusst speichern oder verwerfen.");
    }

    private void CaptureProjectile(CEntityInstance entity)
    {
        // Clear stale identities on index reuse, while preserving a synthetic projectile
        // whose spawn callback is delivered after its creation method returns.
        var index = (int)entity.Index;
        var handle = entity.EntityHandle.Raw;
        if (_syntheticProjectiles.TryGetValue(index, out var previous) && previous != handle)
            _syntheticProjectiles.Remove(index);
        if (_rethrowObservations.TryGetValue(index, out var observation) && observation.Handle != handle)
            _rethrowObservations.Remove(index);
        var kind = ProjectileKind(entity.DesignerName);
        if (!TrainingEnabled || kind == NadeKind.Other) return;
        // The thrower is assigned after spawn; grenade_thrown identifies a real player throw.
        Server.NextFrame(() =>
        {
            if (!TrainingEnabled || !entity.IsValid)
            {
                if (StandaloneTraining)
                    Logger.LogWarning("[Rethrow] Projektil im nächsten Frame nicht erfasst: Training={Training}, EntityGültig={Valid}", TrainingEnabled, entity.IsValid);
                return;
            }
            var projectile = new CBaseCSGrenadeProjectile(entity.Handle);
            if (projectile.Globalname == GrenadeRethrowHistory.Marker) return;
            var player = projectile.Thrower.Value?.Controller.Value?.As<CCSPlayerController>();
            if (player is { IsValid: true, IsBot: false }) {
                if (StandaloneTraining) RememberGrenade(player, projectile);
                _capture.Projectile((int)entity.Index, player.Slot, player.SteamID, kind, Server.CurrentTime);
                _flightTimes.Projectile((int)entity.Index, player.Slot, player.SteamID, kind, Server.CurrentTime);
            }
            else if (StandaloneTraining)
                Logger.LogWarning("[Rethrow] Wurf nicht gespeichert: Entity={Entity}, Typ={Type}, Grund=kein gültiger menschlicher Werfer im nächsten Frame, Thrower={Thrower}",
                    entity.Index, projectile.DesignerName, projectile.Thrower.Raw);
        });
    }

    private HookResult CompleteCapture(int entityId, CCSPlayerController? player, NadeKind kind, Coordinates target)
    {
        var current = Utilities.GetEntityFromIndex<CBaseCSGrenadeProjectile>(entityId);
        var synthetic = _syntheticProjectiles.TryGetValue(entityId, out var expectedHandle) &&
            (current is not { IsValid: true } || current.EntityHandle.Raw == expectedHandle);
        LogRethrowEffect(entityId, kind, target);
        if (synthetic) return HookResult.Continue;
        if (player is not { IsValid: true } && _capture.Thrower(entityId) is { } thrower)
            player = Utilities.GetPlayers().FirstOrDefault(p => p.IsValid && p.Slot == thrower.Slot && p.SteamID == thrower.SteamId);
        if (!TrainingEnabled || player is not { IsValid: true } ||
            !float.IsFinite(target.X) || !float.IsFinite(target.Y) || !float.IsFinite(target.Z)) return HookResult.Continue;
        CompleteFlightTime(entityId, player, kind);
        var captured = _capture.CompleteMeasured(entityId, player.Slot, player.SteamID, kind, Server.MapName, Server.CurrentTime)
            ?? _capture.CompleteMeasuredByThrower(player.Slot, player.SteamID, kind, Server.MapName, Server.CurrentTime);
        if (captured == null) return HookResult.Continue;
        return CompleteNamedCapture(player, captured.Value.Lineup, target, captured.Value.Seconds);
    }

    private HookResult CompleteNamedCapture(CCSPlayerController player, NadeLineup lineup, Coordinates target, float? flightDuration)
    {
        if (!CanWriteNades(player)) return HookResult.Continue;
        if (!float.IsFinite(target.X) || !float.IsFinite(target.Y) || !float.IsFinite(target.Z)) return HookResult.Continue;
        if (lineup.Name.StartsWith("capture_", StringComparison.Ordinal))
        {
            if (flightDuration is not { } measured || !float.IsFinite(measured) || measured < 0)
            { ClearCapture(player.Slot); Tell(player, "Die Flugzeit konnte nicht eindeutig erfasst werden. Bitte die Aufnahme erneut starten und genau eine Granate werfen."); return HookResult.Continue; }
            var samples = System.Text.Json.JsonSerializer.Deserialize<ThrowSample[]>(lineup.ThrowTrace) ?? [];
            var technique = ThrowTechnique.Summarize(samples);
            var steps = ThrowMotion.Analyze(samples)?.Describe(lineup.Attributes);
            _draftNameRequests[player.Slot] = new(lineup.Owner, lineup.Kind, lineup.Map,
                lineup.Position, lineup.Angles, target, technique, lineup.ThrowTrace,
                lineup.Attributes ?? ThrowAttributes.Detect(samples), lineup.Team, measured,
                _captureEdits.Remove(player.Slot, out var original) ? original : null);
            var duration = FormattableString.Invariant($" Flugzeit: {measured:0.00} s.");
            Tell(player, $"Ziel erfasst: {steps?.Summary ?? technique}.{duration} Panelbedienung aktivieren und unter " +
                (original != null ? "Lineup bearbeiten die Neuaufnahme speichern oder verwerfen." : "Neue Nade aufnehmen die Aufnahme speichern oder verwerfen. Optional einen eigenen Namen im Chat eingeben."));
            return HookResult.Continue;
        }
        return HookResult.Continue;
    }

    private HookResult CompleteFireCapture(CCSPlayerController? player, Coordinates target)
    {
        if (!TrainingEnabled || player is not { IsValid: true }) return HookResult.Continue;
        var route = _fireEffectOrigins.Complete(player.SteamID, Server.CurrentTime);
        if (route.Origin == FireEffectOrigin.Synthetic)
        {
            if (route.Attempt is { } attempt)
            {
                var synthetic = _rethrowObservations.Values.FirstOrDefault(o => o.Id == attempt);
                if (synthetic != null) synthetic.EffectLogged = true;
            }
            Logger.LogInformation("[Rethrow] Molotov-Wirkung eines Wiederholungswurfs: Versuch={Attempt}, SteamID={SteamId}, Position={Position}. Ohne Projektil-ID; Zuordnung nur bei einzelnem offenen Wurf.",
                route.Attempt, player.SteamID, RethrowCoordinates(target));
            return HookResult.Continue;
        }
        if (route.Origin != FireEffectOrigin.Real)
        {
            Logger.LogWarning("[Rethrow] Molotov-Ereignis nicht eindeutig: Herkunft={Origin}, SteamID={SteamId}, Position={Position}. Keine Aufnahme oder Flugzeit abgeschlossen.",
                route.Origin, player.SteamID, RethrowCoordinates(target));
            if (route.Origin == FireEffectOrigin.Ambiguous)
                Tell(player, "Überlappende Molotov-Würfe: Wirkung nicht eindeutig zuordenbar. Für die Aufnahme genau einen Wurf verwenden.");
            return HookResult.Continue;
        }
        CompleteFlightTime(null, player, NadeKind.Fire);
        // Molotov detonation does not expose a projectile entity id in the CS# event.
        var captured = _capture.CompleteMeasuredByThrower(player.Slot, player.SteamID, NadeKind.Fire, Server.MapName, Server.CurrentTime);
        return captured == null ? HookResult.Continue : CompleteNamedCapture(player, captured.Value.Lineup, target, captured.Value.Seconds);
    }

    private void ClearCapture(int slot)
    {
        _capture.Forget(slot);
        _saveRequests.Remove(slot);
        _saveSamples.Remove(slot);
        _draftNameRequests.Remove(slot);
        _captureEdits.Remove(slot);
    }
    private void ResetCapture()
    {
        _capture.Clear();
        _flightTimes.Clear();
        _fireEffectOrigins.Clear();
        _syntheticProjectiles.Clear();
        _saveRequests.Clear();
        _saveSamples.Clear();
        _draftNameRequests.Clear();
        _captureEdits.Clear();
    }
}

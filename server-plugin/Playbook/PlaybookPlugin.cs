using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using CounterStrikeSharp.API.Modules.Commands;
using CounterStrikeSharp.API.Modules.Menu;
using CounterStrikeSharp.API.Modules.Timers;
using CounterStrikeSharp.API.Modules.Utils;
using Microsoft.Extensions.Logging;
using System.Globalization;
using System.Text.Json;

namespace Playbook;

[MinimumApiVersion(374)]
public sealed partial class PlaybookPlugin : BasePlugin
{
    public override string ModuleName => "Playbook";
    public override string ModuleVersion => "2.4.1";
    public override string ModuleAuthor => "Playbook";
    public override string ModuleDescription => "Playbook für CS2: Training, Lineups, Reviews und Rollenprüfung.";

    private readonly Dictionary<int, MenuSession> _menus = [];
    private readonly Dictionary<int, NadeLineup> _last = [];
    private string _libraryPath = "";
    private NadeRuntimeStatus? _runtimeStatus;
    private readonly PluginStartup _startup = new();
    private string _runtimeMap = "";
    private bool _statusWriteFailed;
    private PlayerPanelSettingsStore _settingsStore = null!;

    private sealed class MenuSession(CCSPlayerController player, InGameMenu menu, bool practice)
    {
        public CCSPlayerController Player { get; } = player;
        public CCSPlayerPawn Pawn { get; } = player.PlayerPawn.Value!;
        public InGameMenu Menu { get; set; } = menu;
        public bool Practice { get; set; } = practice;
        public MoveType_t MoveType { get; set; }
        public MoveType_t ActualMoveType { get; set; }
        public float NextAttack { get; set; }
        public MenuInput Input { get; set; } = new(player.Buttons);
        public float LastInput { get; set; } = Server.CurrentTime;
        public float NextDraw { get; set; }
        public float AttackLock { get; set; }
        public bool Visible { get; set; } = true;
        public bool Focused { get; set; }
        public bool OwnsFreeze { get; set; }
        public PlayerPanelSettings Settings { get; set; } = new();
        public IReadOnlyList<NadeLineup>? Library { get; set; }
        public ScreenPanel Panel { get; } = new(player);
    }

    public override void Load(bool hotReload)
    {
        _libraryPath = Path.Combine(Server.GameDirectory, "csgo", "cfg", "MatchZy", "savednades.json");
        _settingsStore = new(Path.Combine(ModuleDirectory, "data", "players"));
        AddCommandListener(null, GuardCommand, HookMode.Pre);
        RegisterCapture();
        AddCommandListener("say", OnSay, HookMode.Pre);
        AddCommandListener("say_team", OnSay, HookMode.Pre);
        RegisterListener<Listeners.OnTick>(OnTick);
        RegisterListener<Listeners.OnCustomHudClicked>(OnPanelClicked);
        RegisterListener<Listeners.CheckTransmit>(infoList =>
        {
            foreach (var (info, recipient) in infoList)
                foreach (var session in _menus.Values)
                    if (recipient?.Slot != session.Player.Slot) session.Panel.ExcludeFrom(info);
        });
        RegisterListener<Listeners.OnMapEnd>(Reset);
        RegisterEventHandler<EventPlayerDisconnect>((e, _) => { Forget(e.Userid); return HookResult.Continue; }, HookMode.Pre);
        RegisterEventHandler<EventPlayerDeath>((e, _) => { if (e.Userid is { } p) Close(p.Slot); return HookResult.Continue; }, HookMode.Pre);
        RegisterEventHandler<EventPlayerSpawn>((e, _) => { if (e.Userid is { } p) Close(p.Slot); return HookResult.Continue; });
        RegisterEventHandler<EventRoundStart>((_, _) => { CloseAll(); return HookResult.Continue; });
        _runtimeStatus = new NadeRuntimeStatus(Path.Combine(ModuleDirectory, "data", "status.json"), ModuleVersion);
        // Player and map natives need CS2's global variables. World updates also
        // run while hibernating and cover both a cold start and a plugin reload.
        _startup.Schedule(Server.NextWorldUpdate, () => StartRuntime(hotReload));
    }

    private void StartRuntime(bool hotReload)
    {
        RegisterStandaloneTraining(hotReload);
        SyncPermissions();
        AddTimer(2f, SyncPermissions, TimerFlags.REPEAT);
        WriteRuntimeStatus(true);
        AddTimer(5f, () => WriteRuntimeStatus(true), TimerFlags.REPEAT);
        AddTimer(2f, SyncOpenLibraries, TimerFlags.REPEAT);
        AddTimer(0.5f, ReadReviewResults, TimerFlags.REPEAT);
        Logger.LogInformation("Playbook {Version} loaded: .nades / !nades / css_nades", ModuleVersion);
    }

    public override void Unload(bool hotReload)
    {
        _startup.Cancel();
        CloseAll();
        StopStandaloneTraining();
        Reset();
        _practiceReady = false;
        WriteRuntimeStatus(false);
        Logger.LogInformation("Playbook unloaded");
    }

    private void WriteRuntimeStatus(bool loaded)
    {
        try
        {
            // Unload can run during a failed load, before globals are available.
            if (loaded) _runtimeMap = Server.MapName;
            _runtimeStatus?.Write(loaded, loaded && TrainingEnabled, _runtimeMap);
            if (loaded) WriteMapInventory();
            _statusWriteFailed = false;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            if (!_statusWriteFailed) Logger.LogWarning(error, "Could not write Playbook runtime status");
            _statusWriteFailed = true;
        }
    }

    private HookResult OnSay(CCSPlayerController? player, CommandInfo command)
    {
        if (GuardCommand(player, command) == HookResult.Stop) return HookResult.Stop;
        if (TryEditFromChat(player, command.ArgString)) return HookResult.Stop;
        if (TryMapVoteFromChat(player, command.ArgString)) return HookResult.Stop;
        if (TrySaveNameFromChat(player, command.ArgString)) return HookResult.Stop;
        var words = command.ArgString.Trim().Trim('"').Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        if (StandaloneTraining && words.Length > 0 && words[0].StartsWith('.') &&
            PlaybookCommands.TrainingCommands.Contains(PlaybookCommands.Normalize(words[0])))
        {
            RunTrainingCommand(player, PlaybookCommands.Normalize(words[0]), string.Join(" ", words.Skip(1)));
            return HookResult.Stop;
        }
        if (words.Length == 0 || !words[0].Equals(".nades", StringComparison.OrdinalIgnoreCase)) return HookResult.Continue;
        Handle(player, words.Length > 1 ? words[1] : "");
        return HookResult.Stop;
    }

    [ConsoleCommand("css_nades", "Open grenade lineups for this map; last repeats the selected lineup")]
    public void OnNades(CCSPlayerController? player, CommandInfo command) =>
        Handle(player, command.ArgCount > 1 ? command.GetArg(1) : "");

    [ConsoleCommand("css_training", "Toggle panel control (bind to any key)")]
    public void OnTraining(CCSPlayerController? player, CommandInfo command)
    {
        LogPanelState(player, "css_training empfangen");
        TogglePanelControl(player);
        LogPanelState(player, "css_training verarbeitet");
    }

    private void TogglePanelControl(CCSPlayerController? player)
    {
        if (!CanControl(player) || !Alive(player)) return;
        if (_reviewPhotos.ContainsKey(player!.SteamID)) CancelReview(player);
        if (!TrainingEnabled) { Close(player!.Slot); Tell(player, "Das Panel ist nur im Training verfügbar. Im Webpanel den Modus Nades wählen."); return; }
        if (_menus.TryGetValue(player!.Slot, out var session))
        {
            session.Visible = true;
            SetFocus(session, !session.Focused);
        }
        else Open(player);
    }

    [ConsoleCommand("css_training_visible", "Show/hide panel without losing selection")]
    public void OnPanelVisible(CCSPlayerController? player, CommandInfo command) => TogglePanelVisible(player);

    private void TogglePanelVisible(CCSPlayerController? player)
    {
        if (!CanControl(player) || !Alive(player)) return;
        if (_reviewPhotos.ContainsKey(player!.SteamID)) CancelReview(player);
        if (!TrainingEnabled) { Close(player!.Slot); Tell(player, "Das Panel ist nur im Training verfügbar. Im Webpanel den Modus Nades wählen."); return; }
        if (_menus.TryGetValue(player!.Slot, out var session))
        {
            if (session.Visible) Hide(session);
            else { session.Visible = true; session.NextDraw = 0; }
        }
        else Open(player, focus: false);
    }

    [ConsoleCommand("css_nades_select", "Select menu option 1-9 (optional number key bind)")]
    public void OnSelect(CCSPlayerController? player, CommandInfo command)
    {
        if (player is not { IsValid: true } || !_menus.TryGetValue(player.Slot, out var session) ||
            !session.Visible || !session.Focused) return;
        Handle(player, command.ArgCount > 1 ? command.GetArg(1) : "");
    }

    [ConsoleCommand("css_nades_last", "Return to your last selected lineup")]
    public void OnLast(CCSPlayerController? player, CommandInfo command) => Handle(player, "last");

    private void Tell(CCSPlayerController player, string message)
    {
        if (_menus.TryGetValue(player.Slot, out var session))
        {
            session.Menu.Notice = message;
            session.NextDraw = 0;
        }
        player.PrintToChat(ChatMessage(message));
    }
    private static bool Alive(CCSPlayerController? player) => player is { IsBot: false } && AlivePawn(player);
    private static bool AlivePawn(CCSPlayerController? player) => player is { IsValid: true, PawnIsAlive: true }
        && player.TeamNum is 2 or 3 && player.PlayerPawn.Value is { IsValid: true, MovementServices: not null, WeaponServices: not null };
    private bool TrainingEnabled => StandaloneTraining ? _practiceReady : _serverMode == "matchzy" && MatchZyState.IsPractice(MatchZyState.LoadedInstance());

    private void Handle(CCSPlayerController? player, string action)
    {
        if (!CanControl(player)) return;
        if (action.Equals("close", StringComparison.OrdinalIgnoreCase))
        { if (_menus.TryGetValue(player.Slot, out var open)) Hide(open); LogPanelState(player, "css_nades close verarbeitet"); return; }
        if (!Alive(player)) { Close(player.Slot); Tell(player, "Bitte zuerst einem Team beitreten und spawnen."); return; }
        if (action.Length == 0) { Open(player); return; }
        if (int.TryParse(action, out var key)) { Select(player, key); return; }
        if (!TrainingEnabled) { Tell(player, "Das Panel ist nur im Training verfügbar. Im Webpanel den Modus Nades wählen."); return; }
        if (action.Equals("save", StringComparison.OrdinalIgnoreCase)) { ArmNewLineupCapture(player); return; }
        if (action.Equals("check", StringComparison.OrdinalIgnoreCase))
        {
            ReleaseControl(player.Slot);
            CheckPlacement(player);
            return;
        }
        if (action.Equals("last", StringComparison.OrdinalIgnoreCase))
        {
            if (_last.TryGetValue(player.Slot, out var last)) LoadLineup(player, last);
            else Tell(player, "Zuerst mit .nades ein Lineup auswählen.");
            return;
        }
        Tell(player, ".nades | .nades 1-9 | .nades last | .nades save | .nades check | .nades close");
    }

    private IReadOnlyList<NadeLineup>? ReadLibrary(CCSPlayerController player, bool quiet = false)
    {
        try
        {
            var metadataPath = Path.Combine(Path.GetDirectoryName(_libraryPath)!, "savednades.metadata.json");
            string? metadata = null;
            try
            {
                if (File.Exists(metadataPath))
                {
                    metadata = File.ReadAllText(metadataPath);
                    using var check = JsonDocument.Parse(metadata);
                }
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
            { metadata = null; /* Optional panel titles must not block the MatchZy library. */ }
            return NadeCatalog.Parse(File.ReadAllText(_libraryPath), Server.MapName, player.SteamID.ToString(CultureInfo.InvariantCulture), metadata);
        }
        catch (FileNotFoundException) { if (!quiet) Tell(player, "Noch keine Bibliothek. Lineups im Webpanel oder mit .nades save aufnehmen."); }
        catch (DirectoryNotFoundException) { if (!quiet) Tell(player, "Noch keine Bibliothek. Lineups im Webpanel oder mit .nades save aufnehmen."); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
        {
            Logger.LogWarning(error, "Could not read saved grenade library");
            if (!quiet) Tell(player, "Bibliothek gerade nicht lesbar. Bitte Menü erneut öffnen.");
        }
        return null;
    }

    private InGameMenu BuildMenu(CCSPlayerController player)
    {
        var library = ReadLibrary(player, quiet: true);
        return TrainingMenu.Create(library ?? [], Server.MapName, TrainingEnabled,
            _last.GetValueOrDefault(player.Slot), library == null ? "Bibliothek nicht verfügbar; im Dashboard prüfen." : "",
            _menus.TryGetValue(player.Slot, out var session) ? session.Settings : ReadSettings(player), ReadCompetitiveSpawns(), TrainingState(player), MapMenu(), player.SteamID.ToString(CultureInfo.InvariantCulture), CanWriteNades(player), StandaloneTraining);
    }

    private void Open(CCSPlayerController player, bool focus = true)
    {
        LogPanelState(player, "Panel öffnen angefordert");
        if (!CanControl(player)) return;
        if (!TrainingEnabled) { Close(player.Slot); Tell(player, "Das Panel ist nur im Training verfügbar. Im Webpanel den Modus Nades wählen."); return; }
        if (Environment.GetEnvironmentVariable("PLAYBOOK_TRAINING_HUD_READY") != "1")
        {
            LogPanelState(player, "Panel öffnen abgelehnt: Trainings-HUD nicht aktiviert");
            Tell(player, "Trainings-HUD in den Servereinstellungen des Webpanels aktivieren und übernehmen. HUD-Dateien lokal installieren oder über Workshop ausliefern. Keybinds: css_training_binds.");
            return;
        }
        Close(player.Slot);
        MenuManager.CloseActiveMenu(player);
        var session = new MenuSession(player, BuildMenu(player), TrainingEnabled) { Settings = ReadSettings(player) };
        _menus[player.Slot] = session;
        SetFocus(session, focus);
        if (!focus) LogPanelState(player, "Panel ohne Fokus geöffnet");
    }

    private void Select(CCSPlayerController player, int key)
    {
        if (!_menus.TryGetValue(player.Slot, out var session) || !session.Visible || !session.Focused) return;
        session.LastInput = Server.CurrentTime;
        var request = session.Menu.Select(key);
        if (request?.Action == TrainingAction.Back) session.Menu.Back();
        else if (request != null) { ExecuteAction(player, request); return; }
        session.NextDraw = 0;
    }

    private void ExecuteAction(CCSPlayerController player, MenuRequest request)
    {
        if (!CanControl(player) || !TrainingEnabled || !Alive(player)) return;
        if (!CanWriteNades(player) && request.Action is TrainingAction.StartCapture or TrainingAction.SaveCapture or TrainingAction.EditName or TrainingAction.EditDescription or TrainingAction.DeleteLineup or TrainingAction.RequestReview)
        { Tell(player, "Nades sind für deine Rolle schreibgeschützt."); return; }
        if (HandleReviewAction(player, request) || HandleLineupAction(player, request) || HandleMapAction(player, request)) return;
        if (request.Action == TrainingAction.Close)
        { if (_menus.TryGetValue(player.Slot, out var panel)) Hide(panel); return; }
        if (request.Action == TrainingAction.ToggleFavorite) { ToggleFavorite(player, request.Lineup); return; }
        if (HandleSettingsAction(player, request)) return;
        if (request.Action == TrainingAction.RefreshLibrary)
        {
            if (_menus.TryGetValue(player.Slot, out var panel)) { panel.Menu = BuildMenu(player); panel.NextDraw = 0; }
            return;
        }
        ReleaseControl(player.Slot);
        if (!TrainingEnabled)
        { Tell(player, "Training ist inzwischen beendet. Menü erneut öffnen."); return; }
        switch (request.Action)
        {
            case TrainingAction.TeleportSpawn: TeleportToSpawn(player, request.Spawn); return;
            case TrainingAction.LoadLineup when request.Lineup is { } lineup: LoadLineup(player, lineup); return;
            case TrainingAction.EditLineup when request.Lineup is { } editLineup: ArmLineupEdit(player, editLineup); return;
            case TrainingAction.RepeatLineup:
                if (_last.TryGetValue(player.Slot, out var last)) LoadLineup(player, last);
                return;
            case TrainingAction.ReviewRethrow:
                Logger.LogInformation("[Rethrow] Review-Menü: sv_rethrow_last_grenade auf dem Server angefordert, SteamID={SteamId}, Map={Map}. Engine-Wurf; keine Zuordnung zum persönlichen .rt-Wurfspeicher.",
                    player.SteamID, Server.MapName);
                Server.ExecuteCommand("sv_rethrow_last_grenade");
                Tell(player, "Letzten Server-Wurf erneut angefordert.");
                return;
            case TrainingAction.CheckPosition: CheckPlacement(player); return;
            case TrainingAction.StartCapture: ArmNewLineupCapture(player); return;
            case TrainingAction.SaveCapture: SavePanelCapture(player); return;
            case TrainingAction.CancelCapture: ClearCapture(player.Slot); Tell(player, "Nade-Aufnahme verworfen."); return;
            case TrainingAction.GiveGrenade:
                if (EquipGrenade(player, request.Kind)) Tell(player, $"Ausgerüstet: {NadeCatalog.Label(request.Kind)}. Bereit zum Werfen.");
                return;
        }
        if (TrainingMenu.Command(request.Action) is { } command)
        {
            if (StandaloneTraining) RunTrainingCommand(player, command == "noclip" ? "css_noclip" : command, "");
            else player.ExecuteClientCommandFromServer(command);
        }
    }

    // "Zuletzt trainiert" in the tools page (docs/ingame-panel-ux.md, B3). Persisted with the favourites.
    private void RememberRecent(CCSPlayerController player, NadeLineup lineup)
    {
        if (!_menus.TryGetValue(player.Slot, out var session)) return;
        try
        {
            var settings = session.Settings.Remember(lineup);
            _settingsStore.Save(player.SteamID, settings);
            session.Settings = settings;
            session.Menu.Refresh(BuildMenu(player).Current);
            session.NextDraw = 0;
        }
        catch (Exception error) when (error is IOException or InvalidDataException or UnauthorizedAccessException)
        { Logger.LogWarning(error, "Could not store recent lineups for {SteamId}", player.SteamID); }
    }

    private void LoadLineup(CCSPlayerController player, NadeLineup selected)
    {
        ReleaseControl(player.Slot);
        if (!CanControl(player) || !TrainingEnabled || !Alive(player)) return;
        if (_draftNameRequests.ContainsKey(player.Slot))
        { Tell(player, "Zuerst die fertige Aufnahme speichern oder verwerfen."); return; }
        // Re-read at selection time: a panel sync may have edited, removed or unshared this entry.
        var library = ReadLibrary(player);
        if (library == null) return;
        var lineup = library.FirstOrDefault(n => n.Owner == selected.Owner && n.Name == selected.Name && n.Map == selected.Map);
        if (lineup == null) { Tell(player, "Lineup nicht mehr vorhanden oder auf einer anderen Map. .nades erneut öffnen."); return; }
        var pawn = player.PlayerPawn.Value!;
        if (!EquipGrenade(player, lineup.Kind)) return;
        // Loading is a training action: leave noclip / ladder mode so normal gravity can
        // settle MatchZy's saved Z+4 positions. Closing a menu alone still restores its old mode.
        pawn.MoveType = MoveType_t.MOVETYPE_WALK;
        pawn.ActualMoveType = MoveType_t.MOVETYPE_WALK;
        Utilities.SetStateChanged(pawn, "CBaseEntity", "m_MoveType");
        pawn.Teleport(new Vector(lineup.Position.X, lineup.Position.Y, lineup.Position.Z),
            new QAngle(lineup.Angles.X, lineup.Angles.Y, lineup.Angles.Z), new Vector(0, 0, 0));
        PlayerBodyRotation.Repair(pawn);
        _last[player.Slot] = lineup;
        RememberRecent(player, lineup);
        if (_menus.TryGetValue(player.Slot, out var session)) session.Library = null;
        ClearCapture(player.Slot);
        Tell(player, $"Geladen: {lineup.Title}. {(lineup.ThrowSteps is { Length: 3 } steps ? $"Ablauf: {string.Join(" → ", steps)}." : lineup.Description)}" +
            (lineup.Kind == NadeKind.Other ? " Passende Granate selbst wählen." : " Bereit zum Trainieren."));
    }

    private bool EquipGrenade(CCSPlayerController player, NadeKind kind)
    {
        var pawn = player.PlayerPawn.Value!;
        if (NadeCatalog.Equipment(kind, player.TeamNum == 3) is { } equipment)
        {
            var hasGrenade = pawn.WeaponServices!.MyWeapons.Any(w => w.Value is { IsValid: true } weapon && weapon.DesignerName == equipment.Weapon);
            if (!hasGrenade && player.GiveNamedItem(equipment.Weapon) == IntPtr.Zero)
            {
                Tell(player, "Granate konnte nicht gegeben werden. Bitte Inventar freimachen und erneut versuchen.");
                return false;
            }
            // Same client slot commands used by MatchZy's own .loadnade; no user strings executed.
            player.ExecuteClientCommand(equipment.Slot);
        }
        return true;
    }

    private void CheckPlacement(CCSPlayerController player)
    {
        var pawn = player.PlayerPawn.Value!;
        var position = pawn.AbsOrigin;
        if (position == null) return;
        var scene = pawn.CBodyComponent?.SceneNode;
        if (scene == null) return;
        var eye = pawn.EyeAngles;
        var body = scene.AbsRotation;
        var message = FormattableString.Invariant($"Position {position.X:0.###} {position.Y:0.###} {position.Z:0.###}; Bewegung {pawn.MoveType}/{pawn.ActualMoveType}.");
        var angles = FormattableString.Invariant($"Blick (Pitch/Yaw/Roll): {eye.X:0.###}/{eye.Y:0.###}/{eye.Z:0.###}; Körper: {body.X:0.###}/{body.Y:0.###}/{body.Z:0.###}.");
        Tell(player, message + " " + angles);
        Logger.LogInformation("Nades position check: {Details} {Angles}", message, angles);
    }

    private static void LockAttacks(MenuSession session)
    {
        var services = session.Pawn.WeaponServices!.As<CCSPlayer_WeaponServices>();
        session.AttackLock = Math.Max(services.NextAttack, Server.CurrentTime + 1f);
        services.NextAttack = session.AttackLock;
    }

    private void OnTick()
    {
        if (!TrainingEnabled) { ResetCapture(); CloseAll(); _edits.Clear(); CancelMapVote(); return; }
        RecordSaveInputs();
        RecordFlightPaths();
        foreach (var (actor, photo) in _reviewPhotos.ToArray()) {
            if (photo.Presentation.Maintain()) continue;
            WriteReviewFailure(actor, photo.Command, "Die Fotokamera oder das Charaktermodell ist nicht mehr verfügbar. Bitte erneut aufnehmen.");
            RestoreReviewPhoto(actor, true);
        }
        // MatchZy's own .loadnade/.last/.loadpos bypass our loader. Repair the same
        // scene-node tilt for living practice players (including practice bots).
        // No changes in live matches or to parented/spectator/dead pawns.
        if (TrainingEnabled)
        {
            foreach (var player in Utilities.GetPlayers())
                if (player is { IsValid: true, PawnIsAlive: true } && player.TeamNum is 2 or 3 &&
                    player.PlayerPawn.Value is { IsValid: true } pawn)
                    PlayerBodyRotation.Repair(pawn);
        }
        foreach (var (slot, session) in _menus.ToArray())
        {
            var player = session.Player;
            if (!Alive(player) || player.PlayerPawn.Value!.Handle != session.Pawn.Handle || session.Menu.Map != Server.MapName)
            { Close(slot); continue; }
            if (TrainingEnabled != session.Practice)
            {
                SetFocus(session, false);
                session.Practice = TrainingEnabled;
                session.Menu = BuildMenu(player);
            }
            if (session.Focused && (Server.CurrentTime - session.LastInput > 90f || MenuManager.GetActiveMenu(player) != null))
                SetFocus(session, false);
            if (!session.Visible) continue;
            if (session.Focused) {
                LockAttacks(session);
                if (session.Pawn.MoveType == MoveType_t.MOVETYPE_NOCLIP)
                    session.Pawn.AbsVelocity.X = session.Pawn.AbsVelocity.Y = session.Pawn.AbsVelocity.Z = 0;
            }
            if (_menus.ContainsKey(slot) && session.Visible)
            {
                try
                {
                    if (Server.CurrentTime >= session.NextDraw)
                    {
                        var hadEntity = session.Panel.EntityIndex != null;
                        session.Panel.Draw(session.Menu, session.Focused, CaptureSecondsLeft(slot));
                        if (!hadEntity)
                        {
                            LogPanelState(player, "Panel-Entity erstellt; Client-Anzeige unbestätigt");
                            PrintPanelAssetHint(player);
                        }
                        session.NextDraw = Server.CurrentTime + 0.1f;
                    }
                }
                catch (Exception error)
                {
                    Logger.LogError(error, "Could not draw training panel for slot {Slot}", slot);
                    Close(slot);
                    LogPanelState(player, $"Panel-Zeichnen fehlgeschlagen: {error.GetType().Name}; Sitzung geschlossen");
                    Tell(player, "Seitenpanel konnte nicht erstellt werden. Serverlog prüfen.");
                }
            }
        }
    }

    private void Close(int slot)
    {
        var reviewing = Utilities.GetPlayerFromSlot(slot);
        if (reviewing is { IsValid: true }) CancelReview(reviewing);
        if (!_menus.Remove(slot, out var session)) return;
        SetFocus(session, false);
        session.Panel.Dispose();
    }

    private void ReleaseControl(int slot)
    {
        if (_menus.TryGetValue(slot, out var session)) SetFocus(session, false);
    }

    private void Hide(MenuSession session)
    {
        SetFocus(session, false);
        session.Visible = false;
        session.Panel.Dispose();
    }

    private void SetFocus(MenuSession session, bool focus)
    {
        if (session.Focused == focus) return;
        session.Focused = focus;
        session.Panel.Capture(focus);
        session.NextDraw = 0;
        session.Input = new(session.Player.IsValid ? session.Player.Buttons : 0);
        session.LastInput = Server.CurrentTime;
        if (focus)
        {
            MenuManager.CloseActiveMenu(session.Player);
            session.MoveType = session.Pawn.MoveType;
            session.ActualMoveType = session.Pawn.ActualMoveType;
            session.NextAttack = session.Pawn.WeaponServices!.As<CCSPlayer_WeaponServices>().NextAttack;
            // Keep flight active while the HUD captures input. MOVETYPE_NONE
            // conflicts with the client's noclip prediction when opening the panel.
            if (session.MoveType != MoveType_t.MOVETYPE_NOCLIP) {
                session.Pawn.MoveType = MoveType_t.MOVETYPE_NONE;
                session.Pawn.ActualMoveType = MoveType_t.MOVETYPE_NONE;
            }
            session.OwnsFreeze = session.MoveType == MoveType_t.MOVETYPE_NOCLIP &&
                (session.Pawn.Flags & (uint)PlayerFlags.FL_FROZEN) == 0;
            if (session.OwnsFreeze) {
                session.Pawn.Flags |= (uint)PlayerFlags.FL_FROZEN;
                Utilities.SetStateChanged(session.Pawn, "CBaseEntity", "m_fFlags");
            }
            session.Pawn.AbsVelocity.X = session.Pawn.AbsVelocity.Y = session.Pawn.AbsVelocity.Z = 0;
            Utilities.SetStateChanged(session.Pawn, "CBaseEntity", "m_MoveType");
            LockAttacks(session);
            LogPanelState(session.Player, "Panel-Steuerung aktiviert", session);
            return;
        }
        if (session.Pawn.IsValid)
        {
            if (session.OwnsFreeze) {
                session.Pawn.Flags &= ~(uint)PlayerFlags.FL_FROZEN;
                Utilities.SetStateChanged(session.Pawn, "CBaseEntity", "m_fFlags");
                session.OwnsFreeze = false;
            }

            // Restore only state still owned by this menu, and only on the original pawn.
            if (session.Pawn.MoveType == MoveType_t.MOVETYPE_NONE)
            {
                session.Pawn.MoveType = session.MoveType;
                session.Pawn.ActualMoveType = session.ActualMoveType;
                Utilities.SetStateChanged(session.Pawn, "CBaseEntity", "m_MoveType");
            }
            if (session.Pawn.WeaponServices is { } services)
            {
                var weapons = services.As<CCSPlayer_WeaponServices>();
                if (weapons.NextAttack == session.AttackLock)
                    weapons.NextAttack = Math.Max(session.NextAttack, Server.CurrentTime + 0.15f);
            }
        }
        LogPanelState(session.Player, "Panel-Steuerung freigegeben", session);
    }

    private void Forget(CCSPlayerController? player)
    {
        if (player is not { IsValid: true }) return;
        Close(player.Slot);
        _last.Remove(player.Slot);
        _trainingBots.Remove(player.EntityHandle.Raw);
        ForgetTraining(player.SteamID);
        ClearCapture(player.Slot);
        _flightTimes.Forget(player.Slot);
        _edits.Remove(player.Slot);
    }

    private void CloseAll() { foreach (var slot in _menus.Keys.ToArray()) Close(slot); }
    private void Reset()
    {
        foreach (var (actor, photo) in _reviewPhotos.ToArray()) {
            WriteReviewFailure(actor, photo.Command, "Foto wegen Server- oder Mapwechsel abgebrochen.");
            RestoreReviewPhoto(actor, false);
        }
        _reviewVideos.Clear(); _reviewPending.Clear(); _reviewRequests.Clear();
        ResetTraining(); CloseAll(); _last.Clear(); ResetCapture(); _edits.Clear(); CancelMapVote(); _nextMapVote = 0;
    }
}

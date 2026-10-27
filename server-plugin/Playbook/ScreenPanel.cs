using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Modules.Extensions;

namespace Playbook;

// Client-rendered HUD. No camera transforms, world text, or per-tick teleports.
// A fresh private entity per session avoids stale slot text state in CSS 374.
// Element ids and classes are the contract with training-hud/layout/playbook_training.xml.
internal sealed class ScreenPanel(CCSPlayerController player) : IDisposable
{
    public const string Layout = "panorama/layout/custom_game/playbook_training.xml";
    public const float CaptureWindow = 180f;
    public const int PageDots = 5;
    public const int ProgressSteps = 20;
    private static readonly string[] KindClasses = ["kind-smoke", "kind-he", "kind-flash", "kind-molly", "kind-decoy", "kind-other"];
    private static readonly string[] PageKindClasses = ["page-kind-smoke", "page-kind-he", "page-kind-flash", "page-kind-molly", "page-kind-decoy", "page-kind-other"];
    private CCSCustomHudLayout? _entity;
    private readonly Dictionary<string, string> _texts = [];
    private readonly Dictionary<string, bool> _classes = [];
    private bool _capturing;
    public uint? EntityIndex => _entity is { IsValid: true } ? _entity.Index : null;
    public bool Capturing => _capturing;
    public bool Owns(CCSCustomHudLayout layout) => _entity is { IsValid: true } && _entity.Handle == layout.Handle;

    public static string KindClass(NadeKind kind) => kind switch
    {
        NadeKind.Smoke => "kind-smoke", NadeKind.HE => "kind-he", NadeKind.Flash => "kind-flash",
        NadeKind.Fire => "kind-molly", NadeKind.Decoy => "kind-decoy", _ => "kind-other"
    };

    // One glyph per row: review waits for an admin, a favourite is personal, official is confirmed.
    public static string StateGlyph(MenuItem item) => item.Review ? "Review" : item.Favorite ? "★" : item.Official ? "✓" : "";

    // Capture countdown as "2:41"; the bar below the status line follows the same seconds.
    public static string Countdown(float seconds)
    {
        var whole = Math.Max(0, (int)Math.Ceiling(seconds));
        return $"{whole / 60}:{whole % 60:00}";
    }
    public static int ProgressStep(float seconds) => Math.Clamp((int)Math.Round(seconds / CaptureWindow * ProgressSteps), 0, ProgressSteps);

    // Page dots replace the counter for two to five pages (D5).
    public static bool UsesDots(int pageCount) => pageCount is > 1 and <= PageDots;

    // CS2 teammate colours by index, as the player sees them on the radar (D10).
    public static int? PlayerColorIndex(CCSPlayerController player)
    {
        if (!player.IsValid) return null;
        var index = player.CompTeammateColor;
        return index is >= 0 and < 5 ? index : null;
    }

    public void Draw(InGameMenu menu, bool focused, float? captureSecondsLeft = null)
    {
        if (_entity is not { IsValid: true })
        {
            _texts.Clear(); _classes.Clear(); _capturing = false;
            _entity = Utilities.CreateEntityByName<CCSCustomHudLayout>("custom_hud_layout")
                ?? throw new InvalidOperationException("custom_hud_layout unavailable.");
            _entity.StrLayout = Layout;
            _entity.DispatchSpawn();
        }
        // Head: place before brand (A1), focus state (A6), player colour on the dot (D10).
        Text("training_map", PanelText.MapLabel(menu.Map));
        Text("training_title", menu.IsRoot ? "Hauptmenü" : menu.Current.Title);
        Text("training_breadcrumb", menu.Breadcrumb);
        Text("training_focus", focused ? "Maus" : "Spiel");
        var color = PlayerColorIndex(player);
        for (var i = 0; i < 5; i++) Class("training_panel", $"player-{i}", color == i);
        // Rail in the ink of the page's grenade type (D2).
        var pageKind = menu.Current.Kind is { } kind ? "page-" + KindClass(kind) : "";
        foreach (var name in PageKindClasses) Class("training_panel", name, name == pageKind);
        // Navigation only where it acts (B1); dots for short page runs (D5); slots stay reserved by the layout.
        var singlePage = menu.PageCount == 1;
        var dots = UsesDots(menu.PageCount);
        Text("training_page", $"{menu.Page + 1}/{menu.PageCount}");
        Class("training_previous", "unavailable", singlePage);
        Class("training_next", "unavailable", singlePage);
        Class("training_pages", "unavailable", singlePage);
        Class("training_pages", "dots", dots);
        for (var i = 0; i < PageDots; i++)
        {
            Class($"page_dot_{i}", "shown", dots && i < menu.PageCount);
            Class($"page_dot_{i}", "active", dots && i == menu.Page);
        }
        Class("training_back", "unavailable", menu.IsRoot);
        Class("training_home", "unavailable", menu.IsRoot);
        var rows = menu.Visible.ToArray();
        for (var i = 0; i < InGameMenu.PageSize; i++)
        {
            var row = i < rows.Length ? rows[i] : null;
            Text($"row_{i}_text", row?.Label ?? "");
            Text($"row_{i}_meta", row?.Meta ?? "");
            Text($"row_{i}_state", row == null ? "" : StateGlyph(row));
            Text($"row_{i}_fav_text", row is { Favorite: true } ? "★" : "☆");
            Class($"row_{i}", "empty", row == null);
            Class($"row_{i}", "selected", row != null && i == menu.Cursor);
            Class($"row_{i}", "disabled", row is { Enabled: false });
            Class($"row_{i}", "lineup", row?.Lineup != null);
            Class($"row_{i}", "favorite", row is { Favorite: true });
            Class($"row_{i}", "review", row is { Review: true });
            Class($"row_{i}", "official", row is { Official: true });
            Class($"row_{i}", "must-know", row is { MustKnow: true });
            Class($"row_{i}", "danger", row is { Danger: true });
            Class($"row_{i}", "chip", row is { MetaChip: true });
            Class($"row_{i}", "side-t", row?.Side == "t");
            Class($"row_{i}", "side-ct", row?.Side == "ct");
            var kindClass = row?.Kind is { } rowKind ? KindClass(rowKind) : "";
            foreach (var name in KindClasses) Class($"row_{i}", name, name == kindClass);
        }
        // Status line (A8), capture countdown with progress bar (D4), description with a notice tone (A7).
        var capturing = captureSecondsLeft is { } left && left > 0;
        var status = capturing ? $"Aufnahme läuft · {Countdown(captureSecondsLeft!.Value)} · eine Granate werfen" : menu.Status;
        Text("training_status", status);
        Class("training_status", "empty", status.Length == 0);
        Class("training_progress", "active", capturing);
        var step = capturing ? ProgressStep(captureSecondsLeft!.Value) : 0;
        for (var i = 0; i <= ProgressSteps; i++) Class("training_progress_fill", $"p-{i}", capturing && i == step);
        var notice = menu.Notice.Length > 0;
        var detail = notice ? menu.Notice : menu.Selected?.Hint;
        if (string.IsNullOrWhiteSpace(detail)) detail = menu.Current.Description;
        Text("training_detail", PanelText.Description(detail ?? ""));
        Class("training_detail", "notice-info", notice && menu.NoticeTone == NoticeTone.Info);
        Class("training_detail", "notice-success", notice && menu.NoticeTone == NoticeTone.Success);
        Class("training_detail", "notice-error", notice && menu.NoticeTone == NoticeTone.Error);
        Class("training_panel", "editing", focused);
        Class("training_panel", "danger", menu.Current.Danger);
        Class("training_panel", "shown", true);
        Capture(focused);
    }
    private void Text(string id, string value)
    {
        if (_texts.GetValueOrDefault(id) == value) return;
        _entity!.SetDialogVariableStringForPlayer(player, id, "text", value);
        _texts[id] = value;
    }
    private void Class(string id, string name, bool value)
    {
        var key = id + ":" + name;
        if (_classes.TryGetValue(key, out var old) && old == value) return;
        _entity!.SetHasClassForPlayer(player, id, name, value);
        _classes[key] = value;
    }
    public void Capture(bool enabled)
    {
        if (_entity is not { IsValid: true } || !player.IsValid || _capturing == enabled) return;
        _entity.SetInputCaptureEnabled(player, enabled);
        _capturing = enabled;
    }
    public void ExcludeFrom(CCheckTransmitInfo info)
    {
        if (_entity is { IsValid: true }) info.TransmitEntities.Remove(_entity);
    }
    public void Dispose()
    {
        Capture(false);
        if (_entity is { IsValid: true }) _entity.Remove();
        _entity = null;
        _texts.Clear(); _classes.Clear();
    }
}

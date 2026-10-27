namespace Playbook;

public enum TrainingAction
{
    Close, Back, StartPractice, LoadLineup, RepeatLineup, CheckPosition, EditLineup,
    Rethrow, ReviewRethrow, LastThrow, ClearGrenades, SavePosition, LoadPosition, Noclip,
    Bot, CrouchBot, RemoveBots, Trajectory, Impacts, NoFlash, God,
    BestSpawn, WorstSpawn, StartCapture, SaveCapture, CancelCapture, RefreshLibrary, GiveGrenade,
    Settings, BindKey, ToggleGameButtons, ExportBindings, ToggleFavorite, TeleportSpawn, EditName, EditDescription, EditField, RequestReview, DeleteLineup, StartMapVote, VoteYes, VoteNo,
    ReviewPhoto, ReviewVideoStart, ReviewVideoStop, ReviewHelp, ReviewApprove, ReviewReject, ReviewTeleportEffect
}

// Tone of a panel notice: colours the description area (docs/ingame-panel-ux.md, A7).
public enum NoticeTone { Info, Success, Error }

public sealed record MenuRequest(TrainingAction Action, NadeLineup? Lineup = null, NadeKind Kind = NadeKind.Other,
    string Setting = "", string Value = "", CompetitiveSpawn? Spawn = null);

// Row presentation (docs/ingame-panel-ux.md, A4/A5): Meta is the right-aligned text, Kind and Side
// pick the radar ink, Favorite/Review/Official drive the state glyph, Status feeds the status line,
// Lineup enables the inline favourite button. Label stays the plain name.
public sealed record MenuItem(string Label, string Hint = "", MenuPage? Page = null,
    MenuRequest? Request = null, bool Enabled = true, string Meta = "", NadeKind? Kind = null,
    string Side = "", bool Favorite = false, bool Review = false, bool Official = false,
    string Status = "", NadeLineup? Lineup = null, bool MustKnow = false, bool Danger = false, bool MetaChip = false);
// Kind tints the panel rail while the page shows one grenade type; Danger marks confirmation pages.
public sealed record MenuPage(string Title, string Description, IReadOnlyList<MenuItem> Items, string Key = "",
    NadeLineup? ReviewLineup = null, string ReviewStep = "", bool Danger = false, NadeKind? Kind = null);

// Notices arrive from many call sites as plain text. Infer the tone from the wording so the
// panel can colour them without touching every message; explicit tones always win.
public static class PanelNotice
{
    private static readonly string[] ErrorMarks = ["nicht", "konnte", "Ungültig", "ungültig", "fehlt", "fehlgeschlagen", "abgelehnt", "abgelaufen",
        "schreibgeschützt", "besetzt", "bereits", "Zuerst", "zuerst", "Noch kein", "Nur ", "nur für", "Bitte warte", "prüfen."];
    private static readonly string[] SuccessMarks = ["gespeichert", "geladen", "entfernt", "gesendet", "teleportiert", "umgeschaltet", "angefordert",
        "Ausgerüstet", "bereit.", "erkannt", "Favoriten", "platziert", "freigegeben", "kopiert"];

    public static NoticeTone ToneFor(string message)
    {
        if (ErrorMarks.Any(mark => message.Contains(mark, StringComparison.Ordinal))) return NoticeTone.Error;
        if (SuccessMarks.Any(mark => message.Contains(mark, StringComparison.Ordinal))) return NoticeTone.Success;
        return NoticeTone.Info;
    }
}

// No game API: navigation, rendering and the action gateway have separate responsibilities.
public sealed class InGameMenu(MenuPage root, string map)
{
    public const int PageSize = 9;
    private readonly Stack<(MenuPage Page, int Index)> _history = new();
    private string _notice = "";
    public string Map { get; } = map;
    public MenuPage Current { get; private set; } = root;
    public int Index { get; private set; }
    public int Cursor => Index % PageSize;
    public int Page => Index / PageSize;
    public int PageCount => Math.Max(1, (Current.Items.Count + PageSize - 1) / PageSize);
    public bool IsRoot => _history.Count == 0;
    public NoticeTone NoticeTone { get; private set; } = NoticeTone.Info;
    public string Notice
    {
        get => _notice;
        set { _notice = value; NoticeTone = value.Length == 0 ? NoticeTone.Info : PanelNotice.ToneFor(value); }
    }
    public void SetNotice(string text, NoticeTone tone) { _notice = text; NoticeTone = text.Length == 0 ? NoticeTone.Info : tone; }
    public IEnumerable<MenuItem> Visible => Current.Items.Skip(Page * PageSize).Take(PageSize);
    public MenuItem? Selected => Current.Items.ElementAtOrDefault(Index);
    public bool ContainsPage(string key) => Current.Key == key || _history.Any(frame => frame.Page.Key == key);
    public string Breadcrumb => string.Join(" › ", _history.Reverse().Select(frame => frame.Page)
        .Append(Current).Select((page, index) => index == 0 ? "Home" : MenuRenderer.Plain(page.Title, 36)));

    // Context for the selected row; pagination is shown in the navigation.
    public string Status
    {
        get
        {
            var item = Selected;
            if (item is { Status.Length: > 0 }) return item.Status;
            if (item is { Enabled: false }) return "Nicht verfügbar";
            return "";
        }
    }

    public void Home()
    {
        while (Back()) { }
        Index = 0;
    }

    // Rebuild from fresh data, following stable page identities instead of stale objects.
    // If a lineup disappeared, stop at its parent and clamp the previous selection.
    public void Refresh(MenuPage root)
    {
        var path = _history.Reverse().Append((Current, Index)).ToArray();
        var notice = _notice;
        var tone = NoticeTone;
        _history.Clear();
        Current = root;
        Index = 0;
        for (var depth = 0; depth < path.Length; depth++)
        {
            var (oldPage, oldIndex) = path[depth];
            var selected = oldPage.Items.ElementAtOrDefault(oldIndex);
            var found = selected == null ? -1 : Current.Items.ToList().FindIndex(item => SameItem(item, selected));
            Index = found >= 0 ? found : Math.Clamp(oldIndex, 0, Math.Max(0, Current.Items.Count - 1));
            if (depth + 1 == path.Length) break;
            var child = Current.Items.FirstOrDefault(item => item.Page != null && SamePage(item.Page, path[depth + 1].Item1));
            if (child?.Page == null) { notice = "Die Bibliothek wurde aktualisiert."; tone = NoticeTone.Info; break; }
            Index = Current.Items.ToList().IndexOf(child);
            Enter(child.Page);
        }
        SetNotice(notice, tone);
    }

    private static bool SamePage(MenuPage a, MenuPage b) => a.Key.Length > 0 || b.Key.Length > 0
        ? a.Key == b.Key : a.Title == b.Title;

    private static bool SameItem(MenuItem a, MenuItem b)
    {
        if (a.Page != null && b.Page != null) return SamePage(a.Page, b.Page);
        if (a.Request is { } x && b.Request is { } y)
            return x.Action == y.Action && x.Setting == y.Setting && x.Value == y.Value && x.Kind == y.Kind &&
                x.Spawn?.EntityIndex == y.Spawn?.EntityIndex && x.Spawn?.Team == y.Spawn?.Team &&
                (x.Lineup == null && y.Lineup == null || x.Lineup != null && y.Lineup != null &&
                    x.Lineup.Owner == y.Lineup.Owner && x.Lineup.Map == y.Lineup.Map && x.Lineup.Name == y.Lineup.Name);
        return a.Label == b.Label;
    }

    public void Enter(MenuPage page)
    {
        _history.Push((Current, Index));
        Current = page;
        Index = 0;
        Notice = "";
    }

    public void Move(int direction)
    {
        Notice = "";
        Index = Wrap((long)Index + direction, Math.Max(1, Current.Items.Count));
    }
    public void ChangePage(int direction)
    {
        Notice = "";
        Index = Wrap((long)Page + direction, PageCount) * PageSize;
    }

    private static int Wrap(long index, int count) => (int)((index % count + count) % count);

    public MenuRequest? Select(int key)
    {
        if (key is < 1 or > PageSize) return null;
        var item = Visible.ElementAtOrDefault(key - 1);
        if (item == null) return null;
        Index = Page * PageSize + key - 1;
        Notice = "";
        if (!item.Enabled) { SetNotice(item.Hint, NoticeTone.Info); return null; }
        if (item.Page is { } page)
        {
            Enter(page);
        }
        return item.Request;
    }

    // At the root, stay on Home and return false. Child pages restore the exact selection.
    public bool Back()
    {
        Notice = "";
        if (!_history.TryPop(out var previous)) return false;
        Current = previous.Page;
        Index = previous.Index;
        return true;
    }
}

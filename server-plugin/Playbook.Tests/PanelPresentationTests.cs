using Playbook;
using Xunit;

namespace Playbook.Tests;

// Row presentation, status line, notice tones and recent lineups (docs/ingame-panel-ux.md).
public sealed class PanelPresentationTests
{
    private static NadeLineup Lineup(string name, NadeKind kind = NadeKind.Smoke, string owner = "default", string team = "t",
        bool official = false, string review = "", float? flight = 3.125f) =>
        new(owner, name, "de_mirage", kind, "Aim at window", new(1, 2, 3), new(4, 5, 6), Team: team, Official: official, ReviewStatus: review, FlightDuration: flight);

    private static InGameMenu OpenAll(IReadOnlyList<NadeLineup> library, PlayerPanelSettings? settings = null)
    {
        var menu = TrainingMenu.Create(library, "de_mirage", true, null, settings: settings);
        menu.Select(1); // Bibliothek
        menu.Select(1); // Smokes
        menu.Select(4); // Alle
        return menu;
    }

    [Fact]
    public void LineupRowsCarryInkStateAndStatusInsteadOfTextPrefixes()
    {
        var favorite = Lineup("window", official: true);
        var pending = Lineup("jungle", owner: "7656", team: "ct", review: "pending", flight: null);
        var settings = new PlayerPanelSettings().ToggleFavorite(favorite);
        var menu = OpenAll([favorite, pending], settings);
        var rows = menu.Visible.ToArray();

        Assert.Equal("window", rows[0].Label);
        Assert.Equal("T", rows[0].Meta);
        Assert.Equal(NadeKind.Smoke, rows[0].Kind);
        Assert.Equal("t", rows[0].Side);
        Assert.True(rows[0].Favorite);
        Assert.True(rows[0].Official);
        Assert.False(rows[0].Review);
        Assert.Equal(favorite, rows[0].Lineup);
        Assert.Equal("Offiziell · Smokes · T · 3.13 s", rows[0].Status);

        Assert.Equal("jungle", rows[1].Label);
        Assert.Equal("CT", rows[1].Meta);
        Assert.Equal("ct", rows[1].Side);
        Assert.True(rows[1].Review);
        Assert.False(rows[1].Favorite);
        Assert.StartsWith("Im Review · Smokes · CT", rows[1].Status);
        Assert.Equal(rows[0].Status, menu.Status);
    }

    [Fact]
    public void HomeAndCategoriesHaveNoCountMetadata()
    {
        var menu = TrainingMenu.Create([Lineup("a"), Lineup("b", NadeKind.Flash)], "de_mirage", true, null);
        var home = menu.Current.Items;
        Assert.Equal("Granaten-Bibliothek", home[0].Label);
        Assert.Empty(home[0].Meta);
        Assert.Equal("Must Know", home[1].Label);
        Assert.Empty(home[1].Meta);
        Assert.Equal("Reviews", home[7].Label);
        Assert.Empty(home[7].Meta);
        menu.Select(1);
        var categories = menu.Current.Items;
        Assert.Equal("Smokes", categories[0].Label);
        Assert.Empty(categories[0].Meta);
        Assert.Equal(NadeKind.Smoke, categories[0].Kind);
        Assert.Equal(NadeKind.Flash, categories.Single(item => item.Label == "Flashes").Kind);
        Assert.DoesNotContain(categories, item => item.Label.Contains('('));
    }

    [Fact]
    public void StatusOnlyShowsContextAndAvailability()
    {
        var items = Enumerable.Range(1, 12).Select(i => new MenuItem($"Eintrag {i}", Enabled: i != 2)).ToArray();
        var menu = new InGameMenu(new("Liste", "", items), "de_mirage");
        Assert.Empty(menu.Status);
        menu.Move(1);
        Assert.Equal("Nicht verfügbar", menu.Status);
        var single = new InGameMenu(new("Liste", "", [new MenuItem("Allein")]), "de_mirage");
        Assert.Empty(single.Status);
    }

    [Theory]
    [InlineData("Position gespeichert.", NoticeTone.Success)]
    [InlineData("In deinen Favoriten gespeichert.", NoticeTone.Success)]
    [InlineData("Favoriten nicht gespeichert: Zugriff verweigert", NoticeTone.Error)]
    [InlineData("Lineup nicht mehr vorhanden oder auf einer anderen Map. .nades erneut öffnen.", NoticeTone.Error)]
    [InlineData("Nades sind für deine Rolle schreibgeschützt.", NoticeTone.Error)]
    [InlineData("Wurf erkannt. Das Ziel wird bei der Explosion gespeichert.", NoticeTone.Success)]
    [InlineData("Die Bibliothek wurde aktualisiert.", NoticeTone.Info)]
    [InlineData("Bearbeitung abgebrochen.", NoticeTone.Info)]
    public void NoticeToneFollowsTheWording(string message, NoticeTone expected)
    {
        Assert.Equal(expected, PanelNotice.ToneFor(message));
        var menu = new InGameMenu(new("Liste", "", [new MenuItem("Allein")]), "de_mirage");
        menu.Notice = message;
        Assert.Equal(expected, menu.NoticeTone);
        menu.Move(1);
        Assert.Equal("", menu.Notice);
        Assert.Equal(NoticeTone.Info, menu.NoticeTone);
        menu.SetNotice(message, NoticeTone.Error);
        Assert.Equal(NoticeTone.Error, menu.NoticeTone);
    }

    [Fact]
    public void RefreshKeepsNoticeTone()
    {
        var menu = TrainingMenu.Create([Lineup("a")], "de_mirage", true, null);
        menu.SetNotice("Position gespeichert.", NoticeTone.Success);
        menu.Refresh(TrainingMenu.Create([Lineup("a")], "de_mirage", true, null).Current);
        Assert.Equal(NoticeTone.Success, menu.NoticeTone);
        Assert.Equal("Position gespeichert.", menu.Notice);
    }

    [Fact]
    public void DeleteConfirmationIsMarkedAsDanger()
    {
        var own = Lineup("mine", owner: "7656");
        var menu = TrainingMenu.Create([own], "de_mirage", true, null, steamId: "7656");
        menu.Select(1); menu.Select(1); menu.Select(4); menu.Select(1);
        var deletion = menu.Current.Items.Single(item => item.Label == "Eigene Aufnahme löschen").Page!;
        Assert.True(deletion.Danger);
        Assert.False(menu.Current.Danger);
    }

    [Fact]
    public void RecentLineupsAreCappedDeduplicatedAndListedNewestFirst()
    {
        var library = Enumerable.Range(1, 7).Select(i => Lineup($"nade-{i}")).ToArray();
        var settings = new PlayerPanelSettings();
        foreach (var lineup in library) settings = settings.Remember(lineup);
        settings = settings.Remember(library[2]);
        Assert.Equal(new[] { "nade-3", "nade-7", "nade-6", "nade-5", "nade-4" }, settings.Recent.Select(r => r.Name));

        var menu = TrainingMenu.Create(library, "de_mirage", true, null, settings: settings);
        menu.Select(3); // Trainingswerkzeuge
        var recent = menu.Current.Items.Single(item => item.Label == "Zuletzt trainiert");
        Assert.Empty(recent.Meta);
        Assert.Equal(new[] { "nade-3", "nade-7", "nade-6", "nade-5", "nade-4" }, recent.Page!.Items.Select(item => item.Label));

        var stale = PlayerPanelSettings.Validate(settings with { Recent = [new("", "de_mirage", "x"), settings.Recent[0], settings.Recent[0]] });
        Assert.Equal(new[] { "nade-3" }, stale.Recent.Select(r => r.Name));
    }

    [Fact]
    public void RecentListSurvivesTheSettingsFileAndOlderFilesWithoutIt()
    {
        var directory = Path.Combine(Path.GetTempPath(), "playbook-recent-" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new PlayerPanelSettingsStore(directory);
            store.Save(76561198000000001, new PlayerPanelSettings().Remember(Lineup("window")));
            Assert.Equal("window", Assert.Single(store.Load(76561198000000001).Recent).Name);
            File.WriteAllText(Path.Combine(directory, "76561198000000002.json"), "{\"Favorites\":[],\"GameButtons\":false,\"Keys\":{}}");
            Assert.Empty(store.Load(76561198000000002).Recent);
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }


    [Fact]
    public void MustKnowAndDangerRowsAndTypedPagesAreMarked()
    {
        var mustKnow = new NadeLineup("default", "window", "de_mirage", NadeKind.Flash, "", new(1, 2, 3), new(4, 5, 6), MustKnow: true, Official: true);
        var own = Lineup("mine", owner: "7656");
        var menu = TrainingMenu.Create([mustKnow, own], "de_mirage", true, null, steamId: "7656");
        menu.Select(1); // Bibliothek
        Assert.Null(menu.Current.Kind);
        var flashes = menu.Current.Items.Single(item => item.Label == "Flashes");
        Assert.Equal(NadeKind.Flash, flashes.Page!.Kind);
        Assert.All(flashes.Page.Items, filter => Assert.Equal(NadeKind.Flash, filter.Page!.Kind));
        menu.Select(1); // Smokes
        Assert.Equal(NadeKind.Smoke, menu.Current.Kind);
        menu.Select(4); // Alle
        Assert.Equal(NadeKind.Smoke, menu.Current.Kind);
        menu.Select(1);
        var deletion = menu.Current.Items.Single(item => item.Label == "Eigene Aufnahme löschen").Page!;
        Assert.False(deletion.Items[0].Danger);
        Assert.True(deletion.Items[1].Danger);
        menu.Home();
        menu.Select(2); // Must Know
        var row = Assert.Single(menu.Visible);
        Assert.True(row.MustKnow);
        Assert.Equal(NadeKind.Flash, row.Kind);
    }

    [Fact]
    public void KeybindRowsShowTheKeyAsChip()
    {
        var page = PanelSettingsMenu.Create(new());
        var focus = page.Items.Single(item => item.Label == "Bedienen / Spielen");
        Assert.Equal("KP_0", focus.Meta);
        Assert.True(focus.MetaChip);
        Assert.False(page.Items[0].MetaChip);
    }

    [Theory]
    [InlineData(180f, "3:00", 20)]
    [InlineData(161.2f, "2:42", 18)]
    [InlineData(4.4f, "0:05", 0)]
    [InlineData(0f, "0:00", 0)]
    public void CaptureCountdownAndProgressFollowTheSeconds(float seconds, string countdown, int step)
    {
        Assert.Equal(countdown, ScreenPanel.Countdown(seconds));
        Assert.Equal(step, ScreenPanel.ProgressStep(seconds));
    }

    [Theory]
    [InlineData(1, false)]
    [InlineData(2, true)]
    [InlineData(5, true)]
    [InlineData(6, false)]
    public void PageDotsReplaceTheCounterForShortRuns(int pages, bool dots) => Assert.Equal(dots, ScreenPanel.UsesDots(pages));

    [Fact]
    public void RowClassesFollowKindAndState()
    {
        Assert.Equal("kind-molly", ScreenPanel.KindClass(NadeKind.Fire));
        Assert.Equal("kind-other", ScreenPanel.KindClass(NadeKind.Other));
        Assert.Equal("Review", ScreenPanel.StateGlyph(new MenuItem("x", Review: true, Favorite: true, Official: true)));
        Assert.Equal("★", ScreenPanel.StateGlyph(new MenuItem("x", Favorite: true, Official: true)));
        Assert.Equal("✓", ScreenPanel.StateGlyph(new MenuItem("x", Official: true)));
        Assert.Equal("", ScreenPanel.StateGlyph(new MenuItem("x")));
        Assert.Equal(3, PlaybookPlugin.FavoriteRow("row_3_fav"));
        Assert.Null(PlaybookPlugin.FavoriteRow("row_3"));
        Assert.Null(PlaybookPlugin.FavoriteRow("row_9_fav"));
    }

    [Theory]
    [InlineData("de_mirage", "Mirage")]
    [InlineData("cs_office", "Office")]
    [InlineData("workshop/3070923343/de_cache", "Cache")]
    [InlineData("rush_001", "Rush_001")]
    [InlineData("", "")]
    public void MapLabelDropsPrefixesForTheHead(string map, string expected) => Assert.Equal(expected, PanelText.MapLabel(map));
}

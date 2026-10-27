using System.Text.Json;
using Playbook;
using Xunit;

namespace Playbook.Tests;

public sealed class FavoritesAndSpawnsTests
{
    private static NadeLineup Lineup(string name, string owner = "default", bool mustKnow = false) =>
        new(owner, name, "de_mirage", NadeKind.Smoke, "Über das Geländer werfen.", new(1, 2, 3), new(0, 90, 0), MustKnow: mustKnow);

    [Fact]
    public void FavoriteIdentitySurvivesRenameButDistinguishesOwnerAndMap()
    {
        var nade = Lineup("window");
        var settings = new PlayerPanelSettings().ToggleFavorite(nade);
        Assert.True(settings.IsFavorite(nade with { DisplayName = "Fenster über T-Spawn" }));
        Assert.False(settings.IsFavorite(nade with { Owner = "7656" }));
        Assert.False(settings.IsFavorite(nade with { Map = "de_nuke" }));
        Assert.Empty(settings.ToggleFavorite(nade).Favorites);
    }

    [Fact]
    public void OldSizePreferenceLoadsWithoutLosingKeysOrInventingFavorites()
    {
        var json = JsonSerializer.Serialize(new { Compact = false, GameButtons = true, Keys = PlayerPanelSettings.DefaultKeys });
        var settings = PlayerPanelSettings.Validate(JsonSerializer.Deserialize<PlayerPanelSettings>(json)!);
        Assert.False(settings.GameButtons);
        Assert.Equal("KP_0", settings.Keys["focus"]);
        Assert.Empty(settings.Favorites);
        Assert.DoesNotContain("Compact", JsonSerializer.Serialize(settings));
        Assert.DoesNotContain(PanelSettingsMenu.Create(settings).Items, item => item.Label.Contains("Kompakt"));
    }

    [Fact]
    public void CategoriesOfferFourFiltersAndFavoritesStayReachableFromHome()
    {
        var favorite = Lineup("window", mustKnow: true);
        var own = Lineup("window", "7656");
        var settings = new PlayerPanelSettings().ToggleFavorite(favorite);
        var menu = TrainingMenu.Create([favorite, own], "de_mirage", true, null, settings: settings);
        Assert.Equal(10, menu.Current.Items.Count);
        Assert.Equal("Home", menu.Breadcrumb);
        menu.Select(1);
        menu.Select(1);
        Assert.Equal(new[] { "Favoriten", "Offiziell", "Must Know", "Alle" }, menu.Visible.Select(i => i.Label));
        Assert.All(menu.Visible, item => Assert.Empty(item.Meta));
        Assert.All(menu.Visible, item => Assert.Equal(NadeKind.Smoke, item.Kind));
        menu.Select(4);
        menu.Select(2);
        Assert.Equal(own, menu.Select(1)!.Lineup);
        menu.Home();
        menu.Select(5);
        Assert.Equal("Home › Favoriten", menu.Breadcrumb);
        menu.Select(1);
        Assert.Equal(favorite, menu.Select(1)!.Lineup);
        Assert.Equal(TrainingAction.ToggleFavorite, menu.Select(2)!.Action);
        var changed = settings.ToggleFavorite(favorite);
        menu.Refresh(TrainingMenu.Create([favorite, own], "de_mirage", true, null, settings: changed).Current);
        Assert.Equal("Favoriten", menu.Current.Title);
        Assert.Empty(menu.Visible);
    }

    [Fact]
    public void AllShowsOtherPlayersRecordingsWithoutChangingTheirOwner()
    {
        var data = new { Map = "de_mirage", Type = "Smoke", LineupPos = "1 2 3", LineupAng = "0 90 0" };
        var json = JsonSerializer.Serialize(new Dictionary<string, object> {
            ["default"] = new { window = data }, ["7656"] = new { window = data }, ["9999"] = new { secret = data }
        });
        var metadata = JsonSerializer.Serialize(new[] {
            new { owner = "default", map = "de_mirage", name = "window", mustKnow = true },
            new { owner = "9999", map = "de_mirage", name = "secret", mustKnow = true }
        });
        var nades = NadeCatalog.Parse(json, "de_mirage", "7656", metadata);
        Assert.Equal(3, nades.Count);
        Assert.True(nades.Single(n => n.Owner == "default").MustKnow);
        Assert.False(nades.Single(n => n.Owner == "7656").MustKnow);
        Assert.Contains(nades, n => n.Owner == "9999");
    }

    [Fact]
    public void SpawnSelectionUsesEnabledLowestPriorityOnEachSideAndStableOrder()
    {
        CompetitiveSpawn Spawn(uint index, int team, int priority, bool enabled = true) =>
            new("de_mirage", index, team, priority, enabled, new(index, 0, 0), new(0, 90, 0));
        var points = CompetitiveSpawns.Select([
            Spawn(4, 3, 0), Spawn(2, 3, 0), Spawn(1, 3, -1, false), Spawn(3, 3, 1),
            Spawn(9, 2, 2), Spawn(8, 2, 1), Spawn(7, 2, 1), Spawn(5, 0, 0),
            Spawn(6, 2, -1) with { Position = new(float.NaN, 0, 0) }
        ]);
        Assert.Equal(new uint[] { 7, 8, 2, 4 }, points.Select(p => p.EntityIndex));
        var menu = TrainingMenu.Create([], "de_mirage", true, null, spawns: points);
        menu.Select(6);
        menu.Select(1); // CT
        Assert.Equal(new[] { "CT-Spawn 01", "CT-Spawn 02" }, menu.Visible.Select(i => i.Label));
        var request = menu.Select(2)!;
        Assert.Equal(TrainingAction.TeleportSpawn, request.Action);
        Assert.Equal((uint)4, request.Spawn!.EntityIndex);
        Assert.Equal("Home › Competitive-Spawns › CT-Spawns", menu.Breadcrumb);
    }

    [Fact]
    public void SpawnMenuSupportsMoreThanNinePointsAndGatesPractice()
    {
        var points = Enumerable.Range(1, 13).Select(i => new CompetitiveSpawn("de_mirage", (uint)i, 2, 0, true,
            new(i, 0, 0), new(0, 0, 0))).ToArray();
        var menu = TrainingMenu.Create([], "de_mirage", true, null, spawns: points);
        menu.Select(6);
        menu.Select(2);
        menu.ChangePage(1);
        Assert.Equal((uint)13, menu.Select(4)!.Spawn!.EntityIndex);
        var inactive = TrainingMenu.Create([], "de_mirage", false, null, spawns: points);
        Assert.False(inactive.Current.Items.Single(item => item.Page?.Key == "spawns").Enabled);
    }
}

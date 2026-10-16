using System.Text.Json;
using Playbook;
using Xunit;

namespace Playbook.Tests;

// The website runs the same cases in admin-panel/test/throw-motion.test.ts.
public sealed class ThrowMotionTests
{
    public static IEnumerable<object[]> Cases()
    {
        using var json = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "throw-motion.json")));
        foreach (var item in json.RootElement.EnumerateArray()) yield return [item.GetProperty("name").GetString()!];
    }

    private static JsonElement Case(string name)
    {
        var json = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "throw-motion.json")));
        return json.RootElement.EnumerateArray().First(item => item.GetProperty("name").GetString() == name);
    }

    private static void Near(JsonElement expected, Coordinates actual)
    {
        var values = expected.EnumerateArray().Select(value => value.GetDouble()).ToArray();
        Assert.InRange(actual.X, values[0] - 0.02, values[0] + 0.02);
        Assert.InRange(actual.Y, values[1] - 0.02, values[1] + 0.02);
        Assert.InRange(actual.Z, values[2] - 0.02, values[2] + 0.02);
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void MatchesTheSharedRecordedThrows(string name)
    {
        var item = Case(name);
        var samples = item.GetProperty("trace").Deserialize<ThrowSample[]>()!;
        var expected = item.GetProperty("expected");
        var motion = ThrowMotion.Analyze(samples)!;

        var setup = expected.GetProperty("setup");
        Assert.Equal(setup.GetProperty("found").GetBoolean(), motion.Setup.Found);
        Assert.Equal(setup.GetProperty("crouch").GetBoolean(), motion.Setup.Crouch);
        Near(setup.GetProperty("position"), motion.Setup.Position);
        Near(setup.GetProperty("view"), motion.Setup.View);

        var movement = expected.GetProperty("movement");
        if (movement.ValueKind == JsonValueKind.Null) Assert.Null(motion.Movement);
        else
        {
            Assert.NotNull(motion.Movement);
            Assert.Equal(movement.GetProperty("kind").GetString(), motion.Movement!.Kind);
            Assert.Equal(movement.GetProperty("keys").EnumerateArray().Select(key => key.GetString()!), motion.Movement.Keys);
            Assert.Equal(movement.GetProperty("pace").GetString(), motion.Movement.Pace);
            Assert.Equal(movement.GetProperty("seconds").GetDouble(), motion.Movement.Seconds);
            Assert.Equal(movement.GetProperty("distance").GetInt32(), motion.Movement.Distance);
            Assert.Equal(movement.GetProperty("partial").GetBoolean(), motion.Movement.Partial);
        }
        var jump = expected.GetProperty("jump");
        if (jump.ValueKind == JsonValueKind.Null) Assert.Null(motion.Jump);
        else
        {
            Assert.Equal(jump.GetProperty("timing").GetString(), motion.Jump!.Timing);
            Assert.Equal(jump.GetProperty("seconds").GetDouble(), motion.Jump.Seconds);
        }
        var release = expected.GetProperty("release");
        Assert.Equal(release.GetProperty("click").GetString(), motion.Release.Click);
        Assert.Equal(release.GetProperty("crouch").GetBoolean(), motion.Release.Crouch);
        Near(release.GetProperty("position"), motion.Release.Position);
        Assert.Equal(expected.GetProperty("viewChange").GetDouble(), motion.ViewChange);

        var attributes = expected.GetProperty("attributes");
        Assert.Equal(new ThrowAttributes(attributes.GetProperty("is_jumpthrow").GetBoolean(), attributes.GetProperty("is_crouch").GetBoolean(),
            attributes.GetProperty("is_walking").GetBoolean(), attributes.GetProperty("is_running").GetBoolean(),
            attributes.GetProperty("is_stepping").GetBoolean(), attributes.GetProperty("click_type").GetString()!), ThrowAttributes.Detect(samples));
        var description = motion.Describe();
        Assert.Equal(expected.GetProperty("steps").EnumerateArray().Select(step => step.GetString()!), [description.Lineup, description.Movement, description.Release]);
        Assert.Equal(expected.GetProperty("notes").EnumerateArray().Select(note => note.GetString()!), description.Notes);
    }

    [Fact]
    public void StoredAttributesWinOverTheTrace()
    {
        var samples = Case("inferno b-flash: beide Maustasten, links zuerst losgelassen").GetProperty("trace").Deserialize<ThrowSample[]>()!;
        var description = ThrowMotion.Analyze(samples)!.Describe(new(IsJumpthrow: true, ClickType: "right"));
        Assert.Equal("Rechtsklick loslassen und gleichzeitig springen", description.Release);
    }

    [Fact]
    public void LibraryMetadataCarriesTheDashboardSteps()
    {
        const string library = """{ "7656": { "window": { "Map": "de_dust2", "Type": "Smoke", "LineupPos": "1 2 3", "LineupAng": "0 90 0" } } }""";
        const string metadata = """[{ "owner": "7656", "map": "de_dust2", "name": "window", "throwSteps": ["Stehend ausrichten", "W halten", "Nach 0,44 s (73 Units) Linksklick loslassen"] }]""";
        var lineup = Assert.Single(NadeCatalog.Parse(library, "de_dust2", "7656", metadata));
        Assert.Equal(["Stehend ausrichten", "W halten", "Nach 0,44 s (73 Units) Linksklick loslassen"], lineup.ThrowSteps!);
        var menu = TrainingMenu.Create([lineup], "de_dust2", true, null, steamId: "7656");
        Assert.Contains("Ablauf: Stehend ausrichten → W halten", Flatten(menu.Current).First(item => item.Label == "Lineup laden & trainieren").Hint);
        Assert.Equal(["1. Stehend ausrichten", "2. W halten", "3. Nach 0,44 s (73 Units) Linksklick loslassen"],
            Flatten(menu.Current).First(item => item.Label == "Ablauf ansehen").Page!.Items.Select(item => item.Label));
    }

    private static IEnumerable<MenuItem> Flatten(MenuPage page) =>
        page.Items.SelectMany(item => item.Page == null ? [item] : new[] { item }.Concat(Flatten(item.Page)));
}

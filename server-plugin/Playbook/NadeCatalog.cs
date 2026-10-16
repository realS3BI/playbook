using System.Globalization;
using System.Text.Json;

namespace Playbook;

public enum NadeKind { Smoke, HE, Flash, Fire, Decoy, Other }
public readonly record struct Coordinates(float X, float Y, float Z)
{
    public static bool TryParse(string? text, out Coordinates value)
    {
        value = default;
        var parts = text?.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        if (parts?.Length != 3) return false;
        var numbers = new float[3];
        for (var i = 0; i < 3; i++)
            if (!float.TryParse(parts[i], NumberStyles.Float, CultureInfo.InvariantCulture, out numbers[i]) ||
                !float.IsFinite(numbers[i])) return false;
        value = new(numbers[0], numbers[1], numbers[2]);
        return true;
    }
}

public sealed record NadeLineup(string Owner, string Name, string Map, NadeKind Kind,
    string Description, Coordinates Position, Coordinates Angles, string DisplayName = "", string ThrowTrace = "", bool MustKnow = false,
    bool Official = false, string ReviewStatus = "", string Revision = "", string Team = "", string ThrowFromTitle = "",
    string ThrowToTitle = "", string Technique = "", ThrowAttributes? Attributes = null, float? FlightDuration = null, string[]? ReviewMediaSlots = null,
    Coordinates? LandingPosition = null, string[]? ThrowSteps = null)
{
    public string Title => string.IsNullOrWhiteSpace(DisplayName) ? Name : DisplayName;
}

public sealed record NadeReference(string Owner, string Map, string Name)
{
    public static NadeReference From(NadeLineup lineup) => new(lineup.Owner, lineup.Map, lineup.Name);
}

public static class NadeCatalog
{
    // All recordings are visible; ownership still gates edit/delete/review actions.
    public static IReadOnlyList<NadeLineup> Parse(string json, string map, string steamId, string? metadata = null)
    {
        using var document = JsonDocument.Parse(json);
        if (document.RootElement.ValueKind != JsonValueKind.Object)
            throw new JsonException("The saved nade library must be an object.");
        var result = new List<NadeLineup>();
        foreach (var owner in document.RootElement.EnumerateObject())
        {
            if (owner.Value.ValueKind != JsonValueKind.Object) continue;
            foreach (var entry in owner.Value.EnumerateObject())
            {
                var data = entry.Value;
                if (data.ValueKind != JsonValueKind.Object || string.IsNullOrWhiteSpace(entry.Name)) continue;
                var entryMap = Field(data, "Map");
                if (!string.Equals(entryMap, map, StringComparison.OrdinalIgnoreCase) ||
                    !Coordinates.TryParse(Field(data, "LineupPos"), out var position) ||
                    !Coordinates.TryParse(Field(data, "LineupAng"), out var angles)) continue;
                result.Add(new(owner.Name, entry.Name, entryMap, Kind(Field(data, "Type")),
                    Field(data, "Desc"), position, angles, Field(data, "DisplayName"), MustKnow: Flag(data, "MustKnow"),
                    Official: Flag(data, "Official"), ReviewStatus: Field(data, "ReviewStatus"), Team: Field(data, "team"),
                    ThrowFromTitle: Field(data, "throwFromTitle"), ThrowToTitle: Field(data, "throwToTitle"),
                    Technique: Field(data, "throwTechnique"), Attributes: Attributes(data), FlightDuration: Duration(data),
                    LandingPosition: Point(data, "LandingPos")));
            }
        }
        if (metadata != null)
        {
            using var titles = JsonDocument.Parse(metadata);
            if (titles.RootElement.ValueKind == JsonValueKind.Array)
                foreach (var title in titles.RootElement.EnumerateArray())
                {
                    var index = result.FindIndex(n => n.Owner == Field(title, "owner") && n.Map == Field(title, "map") && n.Name == Field(title, "name"));
                    if (index >= 0) result[index] = result[index] with {
                        DisplayName = Field(title, "displayName"),
                        MustKnow = title.TryGetProperty("mustKnow", out _) ? Flag(title, "mustKnow") : result[index].MustKnow,
                        Official = Flag(title, "official"), ReviewStatus = Field(title, "reviewStatus"), Revision = Field(title, "updatedAt"),
                        Team = Field(title, "team"), ThrowFromTitle = Field(title, "throwFromTitle"), ThrowToTitle = Field(title, "throwToTitle"),
                        Technique = Field(title, "throwTechnique"), Attributes = Attributes(title) ?? result[index].Attributes,
                        FlightDuration = Duration(title),
                        LandingPosition = title.TryGetProperty("landingPos", out _) ? Point(title, "landingPos") : result[index].LandingPosition,
                        ThrowSteps = Steps(title),
                        ReviewMediaSlots = title.TryGetProperty("reviewMediaSlots", out var slots) && slots.ValueKind == JsonValueKind.Array
                            ? slots.EnumerateArray().Where(s => s.ValueKind == JsonValueKind.String && ReviewCaptureFiles.Slots.Contains(s.GetString())).Select(s => s.GetString()!).Distinct().ToArray() : []
                    };
                }
        }
        return result.OrderBy(n => n.Title, StringComparer.OrdinalIgnoreCase)
            .ThenBy(n => n.Owner, StringComparer.Ordinal).ToArray();
    }

    private static bool Flag(JsonElement data, string name) => data.ValueKind == JsonValueKind.Object &&
        data.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.True;

    private static ThrowAttributes? Attributes(JsonElement data) => ThrowAttributes.Flags.Any(key => data.TryGetProperty(key, out _)) || data.TryGetProperty("click_type", out _)
        ? new ThrowAttributes(Flag(data, "is_jumpthrow"), Flag(data, "is_crouch"), Flag(data, "is_walking"), Flag(data, "is_running"), Flag(data, "is_stepping"),
            Field(data, "click_type") is "right" or "both" ? Field(data, "click_type") : "left").Normalize() : null;

    // Lineup, movement and release instructions derived by the dashboard from the recorded trace.
    private static string[]? Steps(JsonElement data) => data.TryGetProperty("throwSteps", out var steps) && steps.ValueKind == JsonValueKind.Array &&
        steps.GetArrayLength() == 3 && steps.EnumerateArray().All(step => step.ValueKind == JsonValueKind.String)
            ? steps.EnumerateArray().Select(step => MenuRenderer.Plain(step.GetString()!, 160)).ToArray() : null;

    private static float? Duration(JsonElement data) => data.TryGetProperty("flightDuration", out var value) &&
        value.ValueKind == JsonValueKind.Number && value.TryGetSingle(out var seconds) && float.IsFinite(seconds) && seconds >= 0 ? seconds : null;

    private static string Field(JsonElement data, string name) =>
        data.ValueKind == JsonValueKind.Object && data.TryGetProperty(name, out var field) && field.ValueKind == JsonValueKind.String
            ? field.GetString() ?? "" : "";

    private static Coordinates? Point(JsonElement data, string name) =>
        Coordinates.TryParse(Field(data, name), out var point) ? point : null;

    public static NadeKind Kind(string type) => type.Trim().ToLowerInvariant() switch
    {
        "smoke" => NadeKind.Smoke,
        "he" or "nade" or "hegrenade" => NadeKind.HE,
        "flash" or "flashbang" => NadeKind.Flash,
        "molly" or "molotov" or "incendiary" => NadeKind.Fire,
        "decoy" => NadeKind.Decoy,
        _ => NadeKind.Other
    };

    public static string Label(NadeKind kind) => kind switch
    {
        NadeKind.Smoke => "Smokes", NadeKind.HE => "HE-Granaten", NadeKind.Flash => "Flashes",
        NadeKind.Fire => "Molotov / Incendiary", NadeKind.Decoy => "Decoys", _ => "Ohne Typ"
    };

    public static (string Weapon, string Slot)? Equipment(NadeKind kind, bool counterTerrorist) => kind switch
    {
        NadeKind.Smoke => ("weapon_smokegrenade", "slot8"),
        NadeKind.HE => ("weapon_hegrenade", "slot6"),
        NadeKind.Flash => ("weapon_flashbang", "slot7"),
        NadeKind.Fire => (counterTerrorist ? "weapon_incgrenade" : "weapon_molotov", "slot10"),
        NadeKind.Decoy => ("weapon_decoy", "slot9"),
        _ => null
    };
}

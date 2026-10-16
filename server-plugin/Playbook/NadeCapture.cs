using System.Text.Json;
using System.Text.Json.Serialization;

namespace Playbook;

public sealed record NadeCapture(string CaptureId, string Owner, string Name, string Map,
    string LineupPos, string LineupAng, string LandingPos, string CapturedAt,
    string Type = "", string DisplayName = "", string Description = "", string ThrowTechnique = "",
    string ThrowTrace = "", bool NewLineup = false, string Team = "", float? FlightDuration = null,
    [property: JsonPropertyName("is_jumpthrow")] bool? IsJumpthrow = null,
    [property: JsonPropertyName("is_crouch")] bool? IsCrouch = null,
    [property: JsonPropertyName("is_walking")] bool? IsWalking = null,
    [property: JsonPropertyName("is_running")] bool? IsRunning = null,
    [property: JsonPropertyName("is_stepping")] bool? IsStepping = null,
    [property: JsonPropertyName("click_type")] string? ClickType = null, string EditRevision = "", string FlightPath = "");

// Only this plugin writes captures. MatchZy remains the sole in-game writer of savednades.json.
public static class NadeCaptureFile
{
    private static readonly JsonSerializerOptions Options = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };
    public static string Vector(Coordinates point) => FormattableString.Invariant($"{point.X:0.######} {point.Y:0.######} {point.Z:0.######}");

    public static NadeCapture Create(NadeLineup lineup, Coordinates target, float? flightDuration = null) => new(
        Guid.NewGuid().ToString("N"), lineup.Owner, lineup.Name, lineup.Map,
        Vector(lineup.Position), Vector(lineup.Angles), Vector(target), DateTimeOffset.UtcNow.ToString("O"), FlightDuration: flightDuration);

    public static NadeCapture CreateNew(string owner, string name, string displayName, string map,
        NadeKind kind, Coordinates start, Coordinates angles, Coordinates target,
        string technique, string trace, ThrowAttributes? attributes = null, string team = "", float? flightDuration = null, string flightPath = "") => new(Guid.NewGuid().ToString("N"), owner, name, map,
        Vector(start), Vector(angles), Vector(target), DateTimeOffset.UtcNow.ToString("O"),
        kind switch
        {
            NadeKind.Smoke => "Smoke", NadeKind.Flash => "Flash", NadeKind.HE => "HE",
            NadeKind.Fire => "Molly", NadeKind.Decoy => "Decoy", _ => ""
        }, displayName, technique, technique, trace, true, team, flightDuration,
        attributes?.IsJumpthrow, attributes?.IsCrouch, attributes?.IsWalking, attributes?.IsRunning, attributes?.IsStepping, attributes?.ClickType,
        FlightPath: flightPath);

    public static NadeCapture CreateReplacement(NadeLineup original, NadeKind kind, Coordinates start,
        Coordinates angles, Coordinates target, string technique, string trace, ThrowAttributes attributes, float duration, string flightPath = "") =>
        CreateNew(original.Owner, original.Name, original.Title, original.Map, kind, start, angles, target,
            technique, trace, attributes, original.Team, duration, flightPath) with { NewLineup = false, EditRevision = original.Revision };

    public static void Write(string path, NadeCapture capture)
    {
        var entries = File.Exists(path)
            ? JsonSerializer.Deserialize<List<NadeCapture>>(File.ReadAllText(path), Options) ?? [] : [];
        entries.RemoveAll(n => n.Owner == capture.Owner && n.Map == capture.Map && n.Name == capture.Name);
        entries.Add(capture);
        var temp = path + ".tmp";
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        try
        {
            File.WriteAllText(temp, JsonSerializer.Serialize(entries.TakeLast(2000), Options));
            File.Move(temp, path, overwrite: true);
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }
}

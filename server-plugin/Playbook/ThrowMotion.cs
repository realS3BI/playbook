using System.Globalization;

namespace Playbook;

public sealed record ThrowSetup(bool Found, int Index, Coordinates Position, Coordinates View, bool Crouch);
public sealed record ThrowMovement(string Kind, string[] Keys, string Pace, double Seconds, int Distance, bool Partial, int StartIndex);
// Seconds between jump and release: negative means the jump starts first.
public sealed record ThrowJump(string Timing, double Seconds, int Index);
public sealed record ThrowRelease(int Index, string Click, bool Crouch, Coordinates Position, Coordinates View);
public sealed record ThrowDescription(string Lineup, string Movement, string Release, string[] Notes)
{
    public string Summary => $"{Lineup} → {Movement} → {Release}";
}

// Splits the recorded input trace into lineup, movement and release. Mirrors
// admin-panel/shared/throw-motion.ts; both run against Playbook.Tests/Fixtures/throw-motion.json.
public sealed record ThrowMotion(ThrowSetup Setup, ThrowMovement? Movement, ThrowJump? Jump, ThrowRelease Release, double ViewChange)
{
    private const float LineupZOffset = 4, StillSpeed = 5, MovingSpeed = 30, JumpSpeed = 120;
    private const double SetupHold = 0.2, SampleGap = 0.25, Together = 0.12, StanceWindow = 1, StepMin = 4, StepMax = 24;
    private static readonly (string Button, string Key)[] MoveKeys = [("forward", "W"), ("moveleft", "A"), ("back", "S"), ("moveright", "D")];

    private sealed record Sample(double Time, Coordinates Position, Coordinates Velocity, Coordinates View, HashSet<string> Buttons)
    {
        public double Speed => Math.Sqrt((double)Velocity.X * Velocity.X + (double)Velocity.Y * Velocity.Y);
        public bool Has(params string[] buttons) => buttons.Any(Buttons.Contains);
        public bool Attacking => Has("attack", "attack2");
        public bool Grounded => Math.Abs(Velocity.Z) < 1 && !Has("jump");
        public bool Still => Speed < StillSpeed && Grounded;
        public bool Airborne => Has("jump") || Math.Abs(Velocity.Z) >= 1;
        // CS2 reports Shift (walk) as Speed; Walk is kept for older traces and tests.
        public bool Walking => Has("speed", "walk");
    }

    private static double Rounded(double value) => Math.Floor(value + 0.5);
    // Seconds rounded through whole milliseconds so float and double traces give the same text.
    private static double Centis(double seconds) => Math.Floor((Rounded(seconds * 1000) + 5) / 10) / 100;
    private static Coordinates Lifted(Coordinates point) => point with { Z = point.Z + LineupZOffset };
    private static double Angle(Coordinates a, Coordinates b) =>
        Math.Max(Math.Abs((double)a.X - b.X), Math.Abs((((double)a.Y - b.Y) % 360 + 540) % 360 - 180));

    public static ThrowMotion? Analyze(IReadOnlyList<ThrowSample> trace)
    {
        var s = trace.Select(Parse).Where(sample => sample != null).Select(sample => sample!).ToArray();
        if (s.Length == 0) return null;
        var end = s.Length - 1;
        bool Linked(int i) => i > 0 && s[i].Time - s[i - 1].Time <= SampleGap;
        var lastAttack = -1;
        for (var i = end; i >= 0; i--) if (s[i].Attacking) { lastAttack = i; break; }
        var release = lastAttack < 0 ? end : Math.Min(end, lastAttack + 1);

        // The held combination of the final press decides the throw, not a short overlap while letting go.
        var combos = new Dictionary<string, int> { ["both"] = 0, ["left"] = 0, ["right"] = 0 };
        for (var i = lastAttack; i >= 0 && s[i].Attacking; i--)
        {
            combos[s[i].Has("attack") && s[i].Has("attack2") ? "both" : s[i].Has("attack2") ? "right" : "left"]++;
            if (!Linked(i)) break;
        }
        var click = new[] { "both", "left", "right" }.Aggregate("left", (best, key) => combos[key] > combos[best] ? key : best);

        // Lineup: the end of the last stillstand (at least SetupHold long) before letting go.
        var setup = -1;
        for (var i = release; i >= 0 && setup < 0; i--)
        {
            if (!s[i].Still) continue;
            var first = i;
            while (Linked(first) && s[first - 1].Still) first--;
            if (s[i].Time - s[first].Time >= SetupHold - 0.001) setup = i;
            i = first;
        }
        int windowStart = setup + 1;
        var partial = false;
        if (setup < 0)
        {
            windowStart = release + 1;
            if (!s[release].Still)
            {
                windowStart = release;
                while (Linked(windowStart) && !s[windowStart - 1].Still) windowStart--;
                // Cut off by the start of the trace or a gap: the run-up may have started earlier.
                partial = !Linked(windowStart);
            }
        }
        double distance = 0, fastest = 0;
        for (var i = windowStart; i <= release; i++)
        {
            fastest = Math.Max(fastest, s[i].Speed);
            if (i > windowStart || Linked(i))
            {
                double dx = (double)s[i].Position.X - s[i - 1].Position.X, dy = (double)s[i].Position.Y - s[i - 1].Position.Y;
                distance += Math.Sqrt(dx * dx + dy * dy);
            }
        }
        var moving = windowStart <= release && (fastest >= MovingSpeed || distance >= StepMin);

        // Jump: the airborne block that contains the release or starts before the grenade leaves.
        var jumpIndex = -1;
        for (var i = release; i <= end; i++) if (s[i].Airborne) { jumpIndex = i; break; }
        if (jumpIndex == release) while (Linked(jumpIndex) && s[jumpIndex - 1].Airborne) jumpIndex--;
        ThrowJump? jump = null;
        if (jumpIndex >= 0)
        {
            var impulse = false;
            for (var i = jumpIndex; i <= end && s[i].Airborne; i++) if (s[i].Has("jump") || s[i].Velocity.Z > JumpSpeed) { impulse = true; break; }
            if (impulse)
            {
                var seconds = Centis(s[jumpIndex].Time - s[release].Time);
                jump = new(Math.Abs(seconds) <= Together ? "together" : seconds < 0 ? "before" : "after", seconds, jumpIndex);
            }
        }

        ThrowMovement? movement = null;
        int lineup;
        if (moving)
        {
            var counts = new List<(string Keys, int Count)>();
            int walk = 0, duck = 0, startIndex = -1;
            for (var i = windowStart; i <= release; i++)
            {
                var keys = string.Join("+", MoveKeys.Where(key => s[i].Buttons.Contains(key.Button)).Select(key => key.Key));
                if (keys.Length > 0)
                {
                    var index = counts.FindIndex(entry => entry.Keys == keys);
                    if (index < 0) counts.Add((keys, 1)); else counts[index] = (keys, counts[index].Count + 1);
                }
                if (startIndex < 0 && (keys.Length > 0 || s[i].Speed >= StillSpeed)) startIndex = i;
                if (s[i].Walking) walk++;
                if (s[i].Has("duck")) duck++;
            }
            var total = release - windowStart + 1;
            var main = counts.Aggregate(("", 0), (best, entry) => entry.Count > best.Item2 ? entry : best).Item1;
            startIndex = Math.Max(startIndex, windowStart);
            movement = new(distance >= StepMin && distance < StepMax ? "step" : "hold", main.Length > 0 ? main.Split('+') : [],
                duck * 2 > total ? "crouch" : walk * 2 > total ? "walk" : "run", Centis(s[release].Time - s[startIndex].Time),
                (int)Rounded(distance), partial, startIndex);
            lineup = setup >= 0 ? setup : end;
        }
        // Standing throws keep the release spot; a jump starts from the floor just before it.
        else lineup = jump is { Index: > 0 } ? jump.Index - 1 : end;
        var view = movement != null ? s[lineup].View : s[end].View;
        double viewChange = 0;
        if (movement != null) for (var i = lineup; i <= end; i++) viewChange = Math.Max(viewChange, Angle(view, s[i].View));

        var crouch = s[lineup].Has("duck");
        if (movement == null)
        {
            // Without movement the stance while aiming is what the player held before the final moment.
            int ducked = 0, count = 0;
            for (var i = release; i >= 0 && s[release].Time - s[i].Time <= StanceWindow; i--)
            {
                if (s[release].Time - s[i].Time < 0.15) continue;
                count++;
                if (s[i].Has("duck")) ducked++;
            }
            crouch = count > 0 ? ducked * 2 > count : s[end].Has("duck");
        }
        return new(new(setup >= 0 || movement == null, lineup, Lifted(s[lineup].Position), view, crouch), movement, jump,
            new(release, click, s[end].Has("duck"), Lifted(s[end].Position), s[end].View), Rounded(viewChange * 10) / 10);
    }

    private static Sample? Parse(ThrowSample sample) =>
        Coordinates.TryParse(sample.Position, out var position) && Coordinates.TryParse(sample.Velocity, out var velocity) &&
        Coordinates.TryParse(sample.View, out var view) && float.IsFinite(sample.Time)
            ? new(sample.Time, position, velocity, view, sample.Buttons.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
                .Select(button => button.ToLowerInvariant()).Where(button => button != "0").ToHashSet())
            : null;

    public ThrowAttributes Attributes
    {
        get
        {
            var mode = Movement == null ? "stand" : Movement.Kind == "step" ? "step" : Movement.Pace == "run" ? "run" : "walk";
            return new(Jump != null, Release.Crouch, mode == "walk", mode == "run", mode == "step", Release.Click);
        }
    }

    private static string Decimal(double value) => value.ToString("0.00", CultureInfo.InvariantCulture).Replace('.', ',');

    // Three short instructions: lineup, movement, release. Stored attributes win over the trace.
    public ThrowDescription Describe(ThrowAttributes? attributes = null)
    {
        attributes ??= Attributes;
        var mode = attributes.Movement;
        var move = mode == "stand" ? null : Movement;
        var setupCrouch = Setup.Crouch;
        var releaseCrouch = attributes.IsCrouch;
        var lineup = Movement != null && !Setup.Found ? "Ausrichten (Startpunkt nicht erkannt)" : setupCrouch ? "Hockend ausrichten" : "Stehend ausrichten";
        var stance = setupCrouch && !releaseCrouch ? "aufstehen" : !setupCrouch && releaseCrouch ? "ducken" : "";
        string movement;
        if (mode == "stand") movement = stance.Length > 0 ? char.ToUpperInvariant(stance[0]) + stance[1..] : "Stillstehen";
        else if (move == null) movement = mode switch { "step" => "Schrittwurf", "walk" => "Gehen", _ => "Laufen" };
        else
        {
            var pace = mode == "run" ? "run" : mode == "walk" && move.Pace == "run" ? "walk" : move.Pace;
            var keys = move.Keys.Length > 0 ? string.Join(" + ", move.Keys) : "Bewegungstaste";
            var hint = pace switch { "walk" => " mit Shift", "crouch" => " hockend", _ => "" };
            movement = $"{keys} {(mode == "step" ? "antippen" : "halten")}{hint}" +
                (stance.Length > 0 && !(pace == "crouch" && stance == "ducken") ? $", dabei {stance}" : "");
        }
        var button = attributes.ClickType switch { "right" => "Rechtsklick", "both" => "Beide Maustasten", _ => "Linksklick" };
        var timing = move != null ? $"{(move.Partial ? "Nach mindestens" : "Nach")} {Decimal(move.Seconds)} s ({move.Distance} Units) " : "";
        var release = $"{timing}{button} loslassen";
        if (attributes.IsJumpthrow)
        {
            release = Jump switch
            {
                null => $"{release} mit Jumpthrow",
                { Timing: "together" } => $"{release} und gleichzeitig springen",
                { Timing: "before" } => timing.Length > 0 ? $"{release}, {Decimal(-Jump.Seconds)} s vorher springen"
                    : $"Springen, nach {Decimal(-Jump.Seconds)} s in der Luft {button} loslassen",
                _ => $"{release}, {Decimal(Jump.Seconds)} s danach springen"
            };
            if (releaseCrouch) release += " (Duck halten)";
        }
        var notes = new List<string>();
        if (Movement != null && !Setup.Found) notes.Add("Vor dem Anlauf stand der Werfer nicht still. Gespeichert ist der Abwurfpunkt.");
        if (move != null && ViewChange >= 0.5)
            notes.Add($"Der Blick ändert sich während der Bewegung um {ViewChange.ToString("0.0", CultureInfo.InvariantCulture).Replace('.', ',')}°.");
        return new(lineup, movement, release, notes.ToArray());
    }
}

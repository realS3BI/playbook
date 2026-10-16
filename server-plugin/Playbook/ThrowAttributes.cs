namespace Playbook;

public sealed record ThrowAttributes(bool IsJumpthrow = false, bool IsCrouch = false, bool IsWalking = false,
    bool IsRunning = false, bool IsStepping = false, string ClickType = "left")
{
    public static readonly string[] Flags = ["is_jumpthrow", "is_crouch", "is_walking", "is_running", "is_stepping"];
    public string Movement => IsStepping ? "step" : IsWalking ? "walk" : IsRunning ? "run" : "stand";
    public string MovementLabel => Movement switch { "step" => "Schrittwurf", "walk" => "Gehen", "run" => "Laufen", _ => "Stand" };
    public ThrowAttributes Normalize() => this with { IsWalking = Movement == "walk", IsRunning = Movement == "run", IsStepping = Movement == "step" };
    public bool Flag(string field) => field switch {
        "is_jumpthrow" => IsJumpthrow, "is_crouch" => IsCrouch, "is_walking" => IsWalking,
        "is_running" => IsRunning, "is_stepping" => IsStepping, _ => false
    };

    public static ThrowAttributes Detect(IReadOnlyList<ThrowSample> samples) => ThrowMotion.Analyze(samples)?.Attributes ?? new();
}

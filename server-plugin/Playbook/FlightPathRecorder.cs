using System.Globalization;

namespace Playbook;

// Where real thrown grenades fly, so a capture can store the path up to the detonation.
// Simulation time; the plugin samples each projectile once per tick. The website reads the
// format in admin-panel/shared/grenade-flight.ts (parseFlightPath).
public sealed class FlightPathRecorder
{
    private sealed class Flight(int slot, ulong steamId, NadeKind kind, uint handle, float started)
    {
        public int Slot { get; } = slot;
        public ulong SteamId { get; } = steamId;
        public NadeKind Kind { get; } = kind;
        public uint Handle { get; } = handle;
        public float Started { get; } = started;
        public bool Lost { get; set; }
        public List<(float Time, Coordinates Position)> Points { get; } = [];
    }

    // 20 seconds at 64 ticks; a grenade still flying by then is not a lineup.
    public const int MaxPoints = 1280;
    private const float KeepSeconds = 60;
    private readonly Dictionary<int, Flight> _flights = [];

    public void Start(int entityId, uint handle, int slot, ulong steamId, NadeKind kind, float now, Coordinates position)
    {
        Prune(now);
        if (kind == NadeKind.Other) return;
        var flight = new Flight(slot, steamId, kind, handle, now);
        flight.Points.Add((now, position));
        _flights[entityId] = flight;
    }

    public IReadOnlyList<(int EntityId, uint Handle)> Flying =>
        _flights.Where(p => !p.Value.Lost).Select(p => (p.Key, p.Value.Handle)).ToArray();

    public void Sample(int entityId, float now, Coordinates position)
    {
        if (!_flights.TryGetValue(entityId, out var flight) || flight.Lost || flight.Points.Count >= MaxPoints) return;
        if (now > flight.Points[^1].Time) flight.Points.Add((now, position));
    }

    // The entity is gone or was reused; the detonation event may still follow.
    public void Lost(int entityId) { if (_flights.TryGetValue(entityId, out var flight)) flight.Lost = true; }

    // Without an entity id (molotov events) only a single matching flight is taken, never a guess.
    public string? Finish(int? entityId, int slot, ulong steamId, NadeKind kind, float now, Coordinates detonation)
    {
        var candidates = _flights.Where(p => (entityId == null || p.Key == entityId) &&
            p.Value.Slot == slot && p.Value.SteamId == steamId && p.Value.Kind == kind).ToArray();
        if (candidates.Length != 1) return null;
        var (key, flight) = (candidates[0].Key, candidates[0].Value);
        _flights.Remove(key);
        if (now >= flight.Points[^1].Time) flight.Points.Add((now, detonation));
        return flight.Points.Count >= 2 ? Serialize(flight.Points) : null;
    }

    public void Prune(float now)
    {
        foreach (var key in _flights.Where(p => now - p.Value.Started > KeepSeconds).Select(p => p.Key).ToArray()) _flights.Remove(key);
    }

    public void Clear() => _flights.Clear();

    // Keeps the points that a straight line between their neighbours, in time, would miss by more
    // than the tolerance: bounces stay exact while a smooth arc needs only a few dozen points.
    public static string Serialize(IReadOnlyList<(float Time, Coordinates Position)> points, float tolerance = 1f)
    {
        var keep = new bool[points.Count];
        keep[0] = keep[^1] = true;
        var pending = new Stack<(int From, int To)>();
        pending.Push((0, points.Count - 1));
        while (pending.Count > 0)
        {
            var (from, to) = pending.Pop();
            var (worst, index) = (tolerance, -1);
            for (var i = from + 1; i < to; i++)
            {
                var span = points[to].Time - points[from].Time;
                var share = span > 0 ? (points[i].Time - points[from].Time) / span : 0;
                var a = points[from].Position; var b = points[to].Position; var p = points[i].Position;
                var miss = MathF.Sqrt(Square(a.X + (b.X - a.X) * share - p.X) + Square(a.Y + (b.Y - a.Y) * share - p.Y) + Square(a.Z + (b.Z - a.Z) * share - p.Z));
                if (miss > worst) (worst, index) = (miss, i);
            }
            if (index < 0) continue;
            keep[index] = true;
            pending.Push((from, index));
            pending.Push((index, to));
        }
        var start = points[0].Time;
        return string.Join(";", points.Where((_, i) => keep[i]).Select(point => string.Format(CultureInfo.InvariantCulture,
            "{0:0.###} {1:0.#} {2:0.#} {3:0.#}", point.Time - start, point.Position.X, point.Position.Y, point.Position.Z)));
    }

    private static float Square(float value) => value * value;
}

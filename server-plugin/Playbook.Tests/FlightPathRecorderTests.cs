using Playbook;
using Xunit;

namespace Playbook.Tests;

public sealed class FlightPathRecorderTests
{
    private const float Tick = 1 / 64f;

    private static FlightPathRecorder Arc(int entity, NadeKind kind, int slot = 1, float start = 10)
    {
        var recorder = new FlightPathRecorder();
        recorder.Start(entity, 77, slot, 7655, kind, start, new(0, 0, 64));
        for (var tick = 1; tick <= 64; tick++)
        {
            var t = tick * Tick;
            recorder.Sample(entity, start + t, new(500 * t, 0, 64 + 300 * t - 160 * t * t));
        }
        return recorder;
    }

    private static float[][] Points(string path) => path.Split(';')
        .Select(point => point.Split(' ').Select(value => float.Parse(value, System.Globalization.CultureInfo.InvariantCulture)).ToArray()).ToArray();

    [Fact]
    public void FinishedFlightEndsAtTheDetonationWithSecondsSinceTheThrow()
    {
        var recorder = Arc(100, NadeKind.Smoke);
        var path = recorder.Finish(100, 1, 7655, NadeKind.Smoke, 12, new(480, 0, 4));
        Assert.NotNull(path);
        var points = Points(path);
        Assert.Equal([0, 0, 0, 64], points[0]);
        Assert.Equal([2, 480, 0, 4], points[^1]);
        Assert.True(points.Zip(points.Skip(1)).All(pair => pair.First[0] < pair.Second[0]));
        // The arc is simplified, but every recorded tick stays within a unit of the stored line.
        Assert.InRange(points.Length, 4, 24);
        Assert.Null(recorder.Finish(100, 1, 7655, NadeKind.Smoke, 12, new(480, 0, 4)));
    }

    [Fact]
    public void BouncesAreKept()
    {
        var recorder = new FlightPathRecorder();
        recorder.Start(5, 1, 1, 7655, NadeKind.HE, 0, new(0, 0, 0));
        for (var tick = 1; tick <= 20; tick++) recorder.Sample(5, tick * Tick, new(tick * 10, 0, 0));
        for (var tick = 21; tick <= 40; tick++) recorder.Sample(5, tick * Tick, new(400 - tick * 10, 0, 0));
        var points = Points(recorder.Finish(5, 1, 7655, NadeKind.HE, 40 * Tick, new(0, 0, 0))!);
        Assert.Contains(points, point => point[1] == 200);
        Assert.Equal(3, points.Length);
    }

    [Fact]
    public void FlightsAreMatchedToTheirThrowerAndKind()
    {
        var recorder = Arc(100, NadeKind.Smoke);
        Assert.Null(recorder.Finish(100, 2, 7655, NadeKind.Smoke, 12, new(0, 0, 0)));
        Assert.Null(recorder.Finish(100, 1, 7655, NadeKind.Flash, 12, new(0, 0, 0)));
        Assert.NotNull(recorder.Finish(100, 1, 7655, NadeKind.Smoke, 12, new(0, 0, 0)));
    }

    [Fact]
    public void MolotovsWithoutEntityIdAreOnlyTakenWhenUnambiguous()
    {
        var recorder = Arc(100, NadeKind.Fire);
        Assert.NotNull(recorder.Finish(null, 1, 7655, NadeKind.Fire, 11.5f, new(300, 0, 0)));
        recorder.Start(101, 1, 1, 7655, NadeKind.Fire, 20, new(0, 0, 0));
        recorder.Start(102, 2, 1, 7655, NadeKind.Fire, 20.1f, new(0, 0, 0));
        Assert.Null(recorder.Finish(null, 1, 7655, NadeKind.Fire, 21, new(0, 0, 0)));
    }

    [Fact]
    public void LostAndOldFlightsStopRecording()
    {
        var recorder = Arc(100, NadeKind.Smoke);
        Assert.Single(recorder.Flying);
        recorder.Lost(100);
        Assert.Empty(recorder.Flying);
        recorder.Sample(100, 15, new(9999, 0, 0));
        Assert.DoesNotContain("9999", recorder.Finish(100, 1, 7655, NadeKind.Smoke, 16, new(1, 2, 3)));
        recorder.Start(200, 1, 1, 7655, NadeKind.Smoke, 0, new(0, 0, 0));
        recorder.Prune(61);
        Assert.Null(recorder.Finish(200, 1, 7655, NadeKind.Smoke, 61, new(0, 0, 0)));
    }

    [Fact]
    public void CapturesStoreTheFlightPath()
    {
        var capture = NadeCaptureFile.CreateNew("7655", "window", "Fenster", "de_mirage", NadeKind.Smoke,
            new(1, 2, 3), new(0, 90, 0), new(10, 20, 30), "", "[]", new(), "ct", 3, "0 1 2 3;1 4 5 6");
        Assert.Equal("0 1 2 3;1 4 5 6", capture.FlightPath);
        var json = System.Text.Json.JsonSerializer.Serialize(capture, new System.Text.Json.JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase });
        Assert.Contains("\"flightPath\":\"0 1 2 3;1 4 5 6\"", json);
    }
}

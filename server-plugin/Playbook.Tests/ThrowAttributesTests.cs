using System.Text.Json;
using Playbook;
using Xunit;

namespace Playbook.Tests;

public sealed class ThrowAttributesTests
{
    [Theory]
    [InlineData("Attack", "left")]
    [InlineData("Attack2", "right")]
    [InlineData("Attack, Attack2", "both")]
    public void DetectsAttackCombinationBeforeRelease(string buttons, string clickType)
    {
        ThrowSample[] samples = [new(1, "0 0 0", "0 0 0", "0 0 0", buttons), new(1.1f, "0 0 0", "0 0 0", "0 0 0", "0")];
        Assert.Equal(clickType, ThrowAttributes.Detect(samples).ClickType);
    }

    [Fact]
    public void DetectsJumpCrouchWalkRunAndSmallStepsWithoutUsingOldSetupMovement()
    {
        ThrowSample[] samples = [new(0, "0 0 0", "200 0 0", "0 0 0", "Jump, Duck"),
            new(9.8f, "100 0 0", "80 0 0", "0 0 0", "Walk, Attack2"), new(10, "108 0 0", "80 0 150", "0 0 0", "Walk")];
        var attributes = ThrowAttributes.Detect(samples);
        Assert.True(attributes.IsJumpthrow);
        Assert.False(attributes.IsCrouch);
        Assert.False(attributes.IsWalking);
        Assert.False(attributes.IsRunning);
        Assert.True(attributes.IsStepping);
        Assert.Equal("right", attributes.ClickType);
        Assert.True(ThrowAttributes.Detect([samples[1] with { Buttons = "Attack", Velocity = "180 0 0" }]).IsRunning);
        // Moving while crouched is slow like walking; the crouch itself stays its own attribute.
        var crouched = ThrowAttributes.Detect([samples[1] with { Buttons = "Duck, Attack", Velocity = "180 0 0" }]);
        Assert.True(crouched.IsWalking && crouched.IsCrouch);
        // CS2 reports Shift as Speed.
        Assert.True(ThrowAttributes.Detect([samples[1] with { Buttons = "Speed, Attack", Velocity = "130 0 0" }]).IsWalking);
        Assert.True(ThrowAttributes.Detect([samples[1] with { Buttons = "Duck, Attack" }]).IsCrouch);
        Assert.False(ThrowAttributes.Detect([samples[1] with { Buttons = "Walk, Attack", Velocity = "0 0 0" }]).IsWalking);
    }

    [Fact]
    public void CapturedAttributesUseTheSameJsonContractAsTheWebsite()
    {
        var path = Path.Combine(Path.GetTempPath(), "nade-attributes-" + Guid.NewGuid(), "captures.json");
        try {
            var capture = NadeCaptureFile.CreateNew("7655", "window", "Fenster", "de_mirage", NadeKind.Smoke,
                new(1, 2, 3), new(0, 90, 0), new(10, 20, 30), "Jumpthrow", "[]", new(IsJumpthrow: true, ClickType: "both"), "ct", 3.125f);
            NadeCaptureFile.Write(path, capture);
            using var json = JsonDocument.Parse(File.ReadAllText(path));
            var entry = json.RootElement[0];
            Assert.True(entry.GetProperty("is_jumpthrow").GetBoolean());
            Assert.False(entry.GetProperty("is_crouch").GetBoolean());
            Assert.Equal("both", entry.GetProperty("click_type").GetString());
            Assert.Equal("ct", entry.GetProperty("team").GetString());
            Assert.Equal(3.125f, entry.GetProperty("flightDuration").GetSingle());
        } finally { if (Directory.Exists(Path.GetDirectoryName(path))) Directory.Delete(Path.GetDirectoryName(path)!, true); }
    }

    [Theory]
    [InlineData("Walk, Attack", "0 0 0", "48 0 0", "80 0 0", "walk")]
    [InlineData("Attack", "0 0 0", "80 0 0", "200 0 0", "run")]
    [InlineData("Walk, Attack", "0 0 0", "8 0 0", "80 0 0", "step")]
    [InlineData("Attack", "0 0 0", "8 0 0", "80 0 0", "step")]
    [InlineData("Attack", "0 0 0", "0 0 0", "0 0 0", "stand")]
    public void DetectsExactlyOneMovement(string buttons, string start, string end, string velocity, string expected)
    {
        ThrowSample[] samples = [new(1, start, velocity, "0 0 0", buttons), new(1.2f, end, velocity, "0 0 0", buttons)];
        var attributes = ThrowAttributes.Detect(samples);
        Assert.Equal(expected, attributes.Movement);
        Assert.Equal(expected == "stand" ? 0 : 1, new[] { attributes.IsWalking, attributes.IsRunning, attributes.IsStepping }.Count(value => value));
    }

    [Fact]
    public void OldJumpAndDuckSetupDoNotBecomeReleaseAttributes()
    {
        ThrowSample[] samples = [new(1, "0 0 0", "0 0 150", "0 0 0", "Jump, Duck, Attack2"),
            new(1.9f, "0 0 0", "0 0 0", "0 0 0", "Attack"), new(2, "0 0 0", "0 0 0", "0 0 0", "0")];
        var attributes = ThrowAttributes.Detect(samples);
        Assert.False(attributes.IsJumpthrow);
        Assert.False(attributes.IsCrouch);
        Assert.Equal("stand", attributes.Movement);
        Assert.Equal("left", attributes.ClickType);
    }
}

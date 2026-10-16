import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeThrowMotion, describeLineupThrow, describeThrow, throwAttributesFromMotion, throwTimeline, withThrowSetup } from "../shared/throw-motion.js";
import { mergeNadeCaptures } from "../src/nades-sync.js";
import { replaceMeasuredLineup, withRecordedThrowSetup } from "../src/measured-lineup.js";

// Shared with server-plugin/Playbook.Tests/ThrowMotionTests.cs: both implementations must agree.
const cases = JSON.parse(readFileSync(resolve("../server-plugin/Playbook.Tests/Fixtures/throw-motion.json"), "utf8"));
const near = (actual: number[], expected: number[]) => actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 0.02, `${actual} ≈ ${expected}`));
const trace = (name: string) => JSON.stringify(cases.find(item => item.name === name).trace);
const owner = "76561198000000001";

for (const { name, trace: samples, expected } of cases) {
  test(`recorded throw: ${name}`, () => {
    const motion = analyzeThrowMotion(samples);
    assert.ok(motion);
    assert.equal(motion.setup.found, expected.setup.found);
    assert.equal(motion.setup.crouch, expected.setup.crouch);
    near(motion.setup.position, expected.setup.position);
    near(motion.setup.view, expected.setup.view);
    if (expected.movement === null) assert.equal(motion.movement, null);
    else {
      const { startIndex, ...movement } = motion.movement;
      assert.deepEqual(movement, expected.movement);
    }
    assert.deepEqual(motion.jump && { timing: motion.jump.timing, seconds: motion.jump.seconds }, expected.jump);
    assert.equal(motion.release.click, expected.release.click);
    assert.equal(motion.release.crouch, expected.release.crouch);
    near(motion.release.position, expected.release.position);
    assert.equal(motion.viewChange, expected.viewChange);
    assert.deepEqual(throwAttributesFromMotion(motion), expected.attributes);
    const description = describeThrow(motion);
    assert.deepEqual([description.lineup, description.movement, description.release], expected.steps);
    assert.deepEqual(description.notes, expected.notes);
  });
}

test("saved attributes win over the trace, details still come from it", () => {
  const flash = describeLineupThrow({ throwTrace: trace("inferno b-flash: beide Maustasten, links zuerst losgelassen"), is_jumpthrow: true, click_type: "right" });
  assert.equal(flash.release, "Rechtsklick loslassen und gleichzeitig springen");
  const run = describeLineupThrow({ throwTrace: trace("dust2 window: W anlaufen, Jumpthrow"), is_walking: true, is_jumpthrow: false });
  assert.deepEqual([run.movement, run.release], ["W halten mit Shift", "Nach 0,44 s (73 Units) Linksklick loslassen"]);
  const stand = describeLineupThrow({ throwTrace: trace("dust2 window: W anlaufen, Jumpthrow"), is_jumpthrow: true, is_running: false });
  assert.deepEqual([stand.movement, stand.release], ["Stillstehen", "Linksklick loslassen und gleichzeitig springen"]);
  assert.equal(describeLineupThrow({ throwTrace: "kaputt" }), null);
});

test("the lineup moves to the stillstand before a run-up, the release spot is kept, and repeating changes nothing", () => {
  const entry = { lineupPos: "-1049.476 -961.8234 167.9531", lineupAng: "-18.45142 93.15907 0", throwTrace: trace("dust2 window: W anlaufen, Jumpthrow") };
  const moved: any = withThrowSetup(entry);
  assert.equal(moved.lineupPos, "-1044.044 -1059.969 132.4067");
  assert.equal(moved.lineupAng, entry.lineupAng, "the precise live angle is kept when the aim did not change");
  assert.equal(moved.releasePos, entry.lineupPos);
  assert.equal(moved.releaseAng, entry.lineupAng);
  assert.equal(withThrowSetup(moved), moved);
  const standing = { lineupPos: "1422.517 -367.9627 -163.9688", lineupAng: "-43.79 176.74 0", throwTrace: trace("mirage mid: Stand") };
  assert.equal(withThrowSetup(standing), standing);
  const unknown = { lineupPos: "1 2 3", lineupAng: "0 0 0", throwTrace: trace("Ohne Stillstand, W + A") };
  assert.equal(withThrowSetup(unknown), unknown, "without a stillstand the release spot stays the lineup");
});

test("captures, replacements and the one-time migration store the lineup spot", () => {
  const throwTrace = trace("dust2 window: W anlaufen, Jumpthrow");
  const capture = { owner, name: "window", map: "de_dust2", type: "Smoke", lineupPos: "-1049.476 -961.8234 167.9531", lineupAng: "-18.45 93.16 0",
    landingPos: "10 20 30", captureId: "new", newLineup: true, flightDuration: 2.5, capturedAt: "2026-10-01T00:00:00.000Z", throwTrace,
    is_jumpthrow: true, is_crouch: false, is_walking: false, is_running: true, is_stepping: false, click_type: "left" };
  const [created] = mergeNadeCaptures([], [capture]);
  assert.equal(created.lineupPos, "-1044.044 -1059.969 132.4067");
  assert.equal(created.releasePos, "-1049.476 -961.8234 167.9531");

  const saved = { ...created, captureId: "old", updatedAt: "2026-10-02T00:00:00.000Z", releasePos: undefined, releaseAng: undefined, lineupPos: capture.lineupPos };
  const replaced = replaceMeasuredLineup(saved, { ...capture, captureId: "replacement", newLineup: false, editRevision: saved.updatedAt });
  assert.equal(replaced.lineupPos, "-1044.044 -1059.969 132.4067");

  const legacy = { ...capture, owner, desc: "", updatedAt: "2026-09-01T00:00:00.000Z" };
  for (const key of ["is_jumpthrow", "is_crouch", "is_walking", "is_running", "is_stepping", "click_type"]) delete legacy[key];
  const manual = { owner, name: "manual", map: "de_dust2", type: "Smoke", lineupPos: "1 2 3", lineupAng: "0 0 0", updatedAt: "2026-09-01T00:00:00.000Z" };
  const [migrated, untouched] = withRecordedThrowSetup([legacy, manual], "2026-10-16T00:00:00.000Z");
  assert.equal(migrated.lineupPos, "-1044.044 -1059.969 132.4067");
  assert.equal(migrated.is_running, true);
  assert.equal(migrated.is_jumpthrow, true);
  assert.equal(migrated.updatedAt, "2026-10-16T00:00:00.000Z");
  assert.equal(untouched, manual);
  assert.deepEqual(withRecordedThrowSetup([migrated]), [migrated]);
});

test("the key timeline is relative to letting go", () => {
  const throwTrace = trace("dust2 window: W anlaufen, Jumpthrow");
  const motion = analyzeThrowMotion(throwTrace);
  const timeline = throwTimeline(throwTrace, motion);
  assert.ok(timeline.from < timeline.start && timeline.start < 0 && timeline.to > 0);
  assert.deepEqual(timeline.lanes.map(lane => lane.key), ["W", "Space", "Maus 1"]);
  const [[pressed, released]] = timeline.lanes.find(lane => lane.key === "Maus 1").spans;
  assert.ok(pressed <= timeline.from + 1e-6 && Math.abs(released) < 1e-6);
});

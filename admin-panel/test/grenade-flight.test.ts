import test from "node:test";
import assert from "node:assert/strict";
import { directFlight, flightCorridor, flightPosition, timedFlight, grenadeRelease, parseFlightPath, reconstructFlight, recordedFlight, simulateFlight, throwStart, type FlightTracer } from "../shared/grenade-flight.js";
import type { Vector3 } from "../shared/throw-motion.js";
import { mergeNadeCaptures } from "../src/nades-sync.js";
import { replaceMeasuredLineup } from "../src/measured-lineup.js";
import { sanitizeNades } from "../src/validators.js";

// A flat floor at z = 0, swept with the grenade's 2-unit radius.
const floor: FlightTracer = (from, move) => {
  const end = from[2] + move[2];
  if (move[2] >= 0 || end >= 2) return null;
  return { fraction: Math.max(0, (from[2] - 2) / -move[2]), normal: [0, 0, 1] };
};
// The same floor with a wall at x = 600.
const walled: FlightTracer = (from, move) => {
  const ground = floor(from, move);
  const wall = move[0] > 0 && from[0] + move[0] > 598 ? { fraction: Math.max(0, (598 - from[0]) / move[0]), normal: [-1, 0, 0] as Vector3 } : null;
  return !wall ? ground : !ground || wall.fraction < ground.fraction ? wall : ground;
};
const standing = { origin: [0, 0, 0] as Vector3, velocity: [0, 0, 0] as Vector3, view: [-30, 0, 0] as Vector3, click: "left" as const, crouch: false };
const close = (actual: number, expected: number, tolerance = 0.01) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≈ ${expected}`);

test("recorded flight paths are read as seconds and positions", () => {
  assert.deepEqual(parseFlightPath("0 1 2 3; 0.5 4 5 6"), [{ time: 0, position: [1, 2, 3] }, { time: 0.5, position: [4, 5, 6] }]);
  assert.deepEqual(parseFlightPath("0 1 2 3"), []);
  assert.deepEqual(parseFlightPath("0.5 1 2 3;0.2 1 2 3"), []);
  assert.equal(recordedFlight({ flightPath: "0 0 0 0;1 1 1 1" }).source, "recorded");
  assert.equal(recordedFlight({}), null);
  const points = parseFlightPath("0 0 0 0;1 10 20 30");
  assert.deepEqual(flightPosition(points, 0.5), [5, 10, 15]);
  assert.deepEqual(flightPosition(points, 4), [10, 20, 30]);
});

test("the release is the last trace sample, or the lineup of a standing throw", () => {
  const trace = JSON.stringify([
    { Time: 1, Position: "0 0 0", Velocity: "0 0 0", View: "-10 90 0", Buttons: "Attack" },
    { Time: 1.03125, Position: "4 0 2", Velocity: "250 0 290", View: "-10 91 0", Buttons: "Jump, Duck" },
  ]);
  assert.deepEqual(grenadeRelease({ throwTrace: trace, click_type: "both" }),
    { origin: [4, 0, 2], velocity: [250, 0, 290], view: [-10, 91, 0], click: "both", crouch: true });
  assert.deepEqual(grenadeRelease({ lineupPos: "10 20 34", lineupAng: "-5 45 0", is_crouch: true }),
    { origin: [10, 20, 30], velocity: [0, 0, 0], view: [-5, 45, 0], click: "left", crouch: true });
  assert.equal(grenadeRelease({ lineupPos: "10 20 34", lineupAng: "-5 45 0", is_jumpthrow: true }), null);
  assert.equal(grenadeRelease({ lineupPos: "10 20 34", lineupAng: "-5 45 0", is_running: true }), null);
});

test("a throw starts 16 units ahead of the eye and is lifted by 10 degrees", () => {
  const start = throwStart({ ...standing, view: [0, 0, 0] }, null);
  const lift = 10 * Math.PI / 180;
  close(start.position[0], 16 * Math.cos(lift));
  close(start.position[2], 64 + 16 * Math.sin(lift));
  close(start.velocity[0], 675 * Math.cos(lift));
  close(start.velocity[2], 675 * Math.sin(lift));
  const weak = throwStart({ ...standing, view: [0, 0, 0], click: "right", velocity: [100, 0, 0] }, null);
  close(weak.position[2], 52 + 16 * Math.sin(lift));
  close(weak.velocity[0], 202.5 * Math.cos(lift) + 125);
});

test("smokes pop at rest, flashes on the fuse and molotovs on the floor", () => {
  const start = throwStart(standing, null);
  const smoke = simulateFlight("Smoke", start, floor).points;
  const end = smoke[smoke.length - 1];
  close(end.position[2], 2);
  assert.ok(end.time >= 1.5 && Math.abs(end.time / 0.2 - Math.round(end.time / 0.2)) < 1e-6, `pops on a think: ${end.time}`);
  assert.ok(smoke.every((point, index) => index === 0 || point.time >= smoke[index - 1].time));
  close(simulateFlight("Flash", start, floor).points.at(-1)!.time, 1.5, 1e-6);
  const molotov = simulateFlight("Molly", throwStart({ ...standing, view: [0, 0, 0] }, null), floor).points;
  assert.ok(molotov.at(-1)!.time < 1.5);
  close(molotov.at(-1)!.position[2], 2);
  // Bouncing off a wall sends the grenade back.
  const bounced = simulateFlight("Smoke", start, walled).points;
  assert.ok(bounced.every(point => point.position[0] <= 598.001));
  assert.ok(bounced.at(-1)!.position[0] < 598);
});

test("reconstruction tries small differences until the flight ends at the landing point", () => {
  const actual = simulateFlight("Smoke", throwStart({ ...standing, view: [-30.3, 0.2, 0] }, walled), walled).points;
  const landing = actual.at(-1)!.position;
  const flight = reconstructFlight("Smoke", standing, landing, walled);
  assert.ok(flight);
  assert.equal(flight.source, "reconstructed");
  assert.ok(flight.error <= 64);
  assert.deepEqual(flight.points.at(-1)!.position.map(value => Math.round(value * 1000) / 1000), landing.map(value => Math.round(value * 1000) / 1000));
  assert.equal(reconstructFlight("Smoke", standing, [-2000, 0, 2], walled, 40), null);
});

test("the corridor covers the arc and the landing point", () => {
  const landing: Vector3 = [900, 0, 2];
  const boxes = flightCorridor("Smoke", standing, landing, null);
  const inside = (point: Vector3) => boxes.some(box => point.every((value, axis) => value >= box.min[axis] && value <= box.max[axis]));
  assert.ok(inside(landing));
  assert.ok(inside([16, 0, 64]));
  assert.ok(simulateFlight("Smoke", throwStart(standing, null), null, 1.5).points.every(point => inside(point.position)));
  assert.deepEqual(flightCorridor("Smoke", null, null, null), []);
  assert.equal(flightCorridor("Smoke", null, null, parseFlightPath("0 0 0 0;1 100 0 0;2 200 0 0")).length, 2);
});

test("captures keep the recorded flight path, replacements without one drop it", () => {
  const owner = "76561198000000001";
  const capture = { owner, name: "window", map: "de_dust2", type: "Smoke", lineupPos: "1 2 3", lineupAng: "0 90 0", landingPos: "10 20 30",
    captureId: "new", newLineup: true, flightDuration: 2.5, capturedAt: "2026-10-01T00:00:00.000Z", flightPath: "0 1 2 3;2.5 10 20 30",
    is_jumpthrow: false, is_crouch: false, is_walking: false, is_running: false, is_stepping: false, click_type: "left" };
  const [created] = mergeNadeCaptures([], [capture]);
  assert.equal(created.flightPath, "0 1 2 3;2.5 10 20 30");
  const saved = { ...created, updatedAt: "2026-10-02T00:00:00.000Z" };
  const replaced = replaceMeasuredLineup(saved, { ...capture, captureId: "replacement", newLineup: false, editRevision: saved.updatedAt, flightPath: undefined });
  assert.equal(replaced.flightPath, undefined);
  assert.equal(sanitizeNades([{ ...created, flightPath: "kaputt" }])[0].flightPath, undefined);
});

test("without a matching reconstruction the grenade still flies an arc to the landing point", () => {
  const landing: Vector3 = [1200, 300, 40];
  const smoke = directFlight("Smoke", standing, landing, 6);
  assert.equal(smoke.source, "direct");
  assert.deepEqual(smoke.points.at(-1)!.position, landing);
  assert.ok(smoke.points.at(-1)!.time < 6);
  assert.ok(Math.max(...smoke.points.map(point => point.position[2])) > 100, "it rises before it falls");
  close(directFlight("Flash", standing, landing, 1.5).points.at(-1)!.time, 1.5, 1e-9);
});

test("computed flights go off after the measured flight time", () => {
  const flight = { points: parseFlightPath("0 0 0 0;1 100 0 0;2 150 0 0;3 160 0 0"), source: "reconstructed" as const, error: 0, landedAt: 1 };
  const held = timedFlight(flight, 5);
  assert.deepEqual(held.points.at(-1), { time: 5, position: [160, 0, 0] });
  const faster = timedFlight(flight, 2);
  assert.deepEqual(faster.points.map(point => point.time), [0, 1, 1.5, 2]);
  assert.equal(timedFlight(flight, 0.03), flight);
  assert.equal(timedFlight(flight, undefined), flight);
});

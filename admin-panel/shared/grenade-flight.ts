// Grenade flight in Source units. The plugin records the projectile of new captures (flightPath);
// older lineups are reconstructed from the moment the grenade left, using CS2's throw and bounce
// rules, and only kept when the result ends at the measured landing point.
import { parseThrowTrace, type Vector3 } from "./throw-motion.js";
import { movementType } from "./throw-attributes.js";

export type FlightPoint = { time: number; position: Vector3 };
export type FlightHit = { fraction: number; normal: Vector3 };
// Sweeps the grenade from a point by a move vector. Returns the fraction of the move before contact.
export type FlightTracer = (from: Vector3, move: Vector3) => FlightHit | null;
export type GrenadeRelease = { origin: Vector3; velocity: Vector3; view: Vector3; click: "left" | "right" | "both"; crouch: boolean };
// landedAt: first contact with a floor, or the end of a direct arc; null when unknown.
export type GrenadeFlight = { points: FlightPoint[]; source: "recorded" | "reconstructed" | "direct"; error: number; landedAt: number | null };
export type FlightBox = { min: Vector3; max: Vector3 };

export const GRENADE_TICK = 1 / 64;
const GRAVITY = 800 * 0.4;
const ELASTICITY = 0.45;
const STOP_SPEED = 30;
const FLOOR_NORMAL = 0.7;
const MOLOTOV_FLOOR = Math.cos(30 * Math.PI / 180);
const FUSE: Record<string, number> = { Flash: 1.5, HE: 1.5, Molly: 2 };
const STRENGTH = { left: 1, right: 0, both: 0.5 };
const EYE = { standing: 64, crouching: 46 };
const MAX_FLIGHT = 20;
// A reconstruction counts when it ends this close to the measured landing point; a smoke covers about 144 units.
export const FLIGHT_TOLERANCE = 64;
const LINEUP_Z_OFFSET = 4;

const add = (a: Vector3, b: Vector3, scale = 1): Vector3 => [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale];
const dot = (a: Vector3, b: Vector3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const distance = (a: Vector3, b: Vector3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function vector(value: unknown): Vector3 | null {
  const parts = String(value ?? "").trim().split(/[\s,]+/).map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? parts as Vector3 : null;
}

// "t x y z;t x y z;…" with seconds since the throw, as written by the plugin.
export function parseFlightPath(value: unknown): FlightPoint[] {
  const points: FlightPoint[] = [];
  for (const part of String(value ?? "").split(";")) {
    const numbers = part.trim().split(/\s+/).map(Number);
    if (numbers.length !== 4 || !numbers.every(Number.isFinite)) continue;
    if (points.length && numbers[0] < points[points.length - 1].time) return [];
    points.push({ time: numbers[0], position: [numbers[1], numbers[2], numbers[3]] });
  }
  return points.length >= 2 ? points : [];
}

// The moment the grenade left: the last trace sample is taken on grenade_thrown. Without a trace a
// standing throw still starts at the lineup; moving and jumping throws cannot be reconstructed.
export function grenadeRelease(entry: Record<string, any>): GrenadeRelease | null {
  const click = (["left", "right", "both"].includes(entry.click_type) ? entry.click_type : "left") as GrenadeRelease["click"];
  const samples = entry.throwTrace ? parseThrowTrace(entry.throwTrace) : [];
  if (samples.length) {
    const last = samples[samples.length - 1];
    return { origin: last.position, velocity: last.velocity, view: last.view, click, crouch: last.buttons.has("duck") };
  }
  const position = vector(entry.lineupPos), angles = vector(entry.lineupAng);
  if (!position || !angles || entry.is_jumpthrow === true || movementType(entry) !== "stand") return null;
  return { origin: [position[0], position[1], position[2] - LINEUP_Z_OFFSET], velocity: [0, 0, 0], view: angles, click, crouch: entry.is_crouch === true };
}

function forward(pitch: number, yaw: number): Vector3 {
  const p = pitch * Math.PI / 180, y = yaw * Math.PI / 180;
  return [Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), -Math.sin(p)];
}

// CS2 throws from the eye, lowered for weaker throws and 16 units ahead unless a wall is closer.
// The view is lifted by up to 10° and the player's velocity adds a quarter more.
export function throwStart(release: GrenadeRelease, tracer: FlightTracer | null) {
  const strength = STRENGTH[release.click];
  let pitch = release.view[0];
  if (pitch > 180) pitch -= 360;
  pitch = Math.max(-90, Math.min(90, pitch));
  pitch -= (90 - Math.abs(pitch)) * 10 / 90;
  const direction = forward(pitch, release.view[1]);
  const speed = 750 * 0.9 * (0.3 + 0.7 * strength);
  const eye: Vector3 = [release.origin[0], release.origin[1], release.origin[2] + (release.crouch ? EYE.crouching : EYE.standing) + strength * 12 - 12];
  const reach: Vector3 = [direction[0] * 22, direction[1] * 22, direction[2] * 22];
  const blocked = tracer?.(eye, reach);
  return { position: add(add(eye, reach, blocked ? blocked.fraction : 1), direction, -6),
    velocity: add([direction[0] * speed, direction[1] * speed, direction[2] * speed], release.velocity, 1.25) };
}

function reflect(velocity: Vector3, normal: Vector3): Vector3 {
  const backoff = dot(velocity, normal) * 2;
  return velocity.map((value, axis) => {
    const next = (value - normal[axis] * backoff) * ELASTICITY;
    return Math.abs(next) < 0.1 * ELASTICITY ? 0 : next;
  }) as Vector3;
}

// One position per tick until the grenade goes off: smokes and decoys once they rest, flashes and
// HEs on their fuse, molotovs on a flat floor or after two seconds.
export function simulateFlight(kind: string, start: { position: Vector3; velocity: Vector3 }, tracer: FlightTracer | null, maxTime = MAX_FLIGHT) {
  let position = start.position, velocity = start.velocity;
  const points: FlightPoint[] = [{ time: 0, position }];
  const fuse = FUSE[kind];
  let firstFloor: number | null = null;
  for (let tick = 1; tick * GRENADE_TICK <= maxTime; tick++) {
    const time = tick * GRENADE_TICK;
    const fallen = velocity[2] - GRAVITY * GRENADE_TICK;
    const move: Vector3 = [velocity[0] * GRENADE_TICK, velocity[1] * GRENADE_TICK, (velocity[2] + fallen) / 2 * GRENADE_TICK];
    velocity = [velocity[0], velocity[1], fallen];
    const hit = tracer?.(position, move) ?? null;
    if (!hit) position = add(position, move);
    else {
      position = add(position, move, hit.fraction);
      const bounced = reflect(velocity, hit.normal);
      const slow = dot(bounced, bounced) < STOP_SPEED * STOP_SPEED;
      if (hit.normal[2] > FLOOR_NORMAL) {
        firstFloor ??= time;
        if (kind === "Molly" && hit.normal[2] > MOLOTOV_FLOOR) { points.push({ time, position }); return { points, firstFloor }; }
        velocity = slow ? [0, 0, 0] : bounced;
        if (!slow) {
          const rest: Vector3 = bounced.map(value => value * (1 - hit.fraction) * GRENADE_TICK) as Vector3;
          position = add(position, rest, tracer?.(position, rest)?.fraction ?? 1);
        }
      } else velocity = slow ? [0, 0, 0] : bounced;
    }
    points.push({ time, position });
    if (fuse !== undefined && time >= fuse) return { points, firstFloor };
    if (hit && fuse === undefined && dot(velocity, velocity) < 0.01) {
      // Smokes check every 0.2 s from 1.5 s on and go off once the grenade lies still.
      const pop = Math.max(1.5, Math.ceil(time / 0.2 - 1e-9) * 0.2);
      if (pop > time) points.push({ time: pop, position });
      return { points, firstFloor };
    }
  }
  return { points, firstFloor };
}

// Measurements are rounded and the map is rebuilt from render geometry, so a tiny difference in angle
// or speed can decide a bounce. The search tries such differences in a fixed order and keeps the
// flight that ends closest to the landing point. Yields between batches so a page can stay responsive.
export function* searchFlight(kind: string, release: GrenadeRelease, landing: Vector3, tracer: FlightTracer, trials = 400): Generator<void, GrenadeFlight | null> {
  let seed = 7;
  const random = () => (seed = seed * 16807 % 2147483647) / 2147483647 - 0.5;
  const run = (pitch: number, yaw: number, scale: number) => {
    const start = throwStart({ ...release, view: [release.view[0] + pitch, release.view[1] + yaw, release.view[2]] }, tracer);
    const result = simulateFlight(kind, { position: start.position, velocity: start.velocity.map(value => value * scale) as Vector3 }, tracer);
    return { ...result, pitch, yaw, scale, error: distance(result.points[result.points.length - 1].position, landing) };
  };
  let best = run(0, 0, 1);
  for (let trial = 1; trial < trials && best.error > 16; trial++) {
    const next = trial < trials / 2
      ? run(random() * 1, random() * 0.6, 1 + random() * 0.04)
      : run(best.pitch + random() * 0.3, best.yaw + random() * 0.2, best.scale + random() * 0.01);
    if (next.error < best.error) best = next;
    if (trial % 25 === 0) yield;
  }
  if (best.error > FLIGHT_TOLERANCE) return null;
  // Close the remaining gap during the bounces, so the grenade comes to rest on the measured spot.
  const end = best.points[best.points.length - 1], from = best.firstFloor ?? 0, span = Math.max(end.time - from, 1e-6);
  const offset: Vector3 = [landing[0] - end.position[0], landing[1] - end.position[1], landing[2] - end.position[2]];
  const points = best.points.map(point => {
    const share = Math.min(1, Math.max(0, (point.time - from) / span));
    return { time: point.time, position: add(point.position, offset, share * share * (3 - 2 * share)) };
  });
  return { points, source: "reconstructed", error: Math.round(best.error), landedAt: best.firstFloor };
}

export function reconstructFlight(kind: string, release: GrenadeRelease, landing: Vector3, tracer: FlightTracer, trials?: number) {
  const search = searchFlight(kind, release, landing, tracer, trials);
  for (let step = search.next(); ; step = search.next()) if (step.done) return step.value;
}

export function recordedFlight(entry: Record<string, any>): GrenadeFlight | null {
  const points = parseFlightPath(entry.flightPath);
  return points.length ? { points, source: "recorded", error: 0, landedAt: null } : null;
}

// When no reconstruction ends at the landing point: one arc from the real release to the measured point,
// with the throw's horizontal speed. Bounces are missing, but the grenade still flies there. Flashes and
// HEs go off in the air on their fuse, so their arc takes exactly the measured flight time.
export function directFlight(kind: string, release: GrenadeRelease, landing: Vector3, duration?: number): GrenadeFlight {
  const start = throwStart(release, null);
  const offset: Vector3 = [landing[0] - start.position[0], landing[1] - start.position[1], landing[2] - start.position[2]];
  const measured = typeof duration === "number" && duration > 0.2 ? duration : undefined;
  let seconds = Math.hypot(offset[0], offset[1]) / Math.max(Math.hypot(start.velocity[0], start.velocity[1]), 50);
  if (measured !== undefined && (kind === "Flash" || kind === "HE" || seconds > measured)) seconds = measured;
  seconds = Math.max(0.2, seconds);
  const velocity: Vector3 = [offset[0] / seconds, offset[1] / seconds, (offset[2] + GRAVITY * seconds * seconds / 2) / seconds];
  const points: FlightPoint[] = [];
  for (let tick = 0; tick * GRENADE_TICK < seconds; tick++) {
    const time = tick * GRENADE_TICK;
    points.push({ time, position: [start.position[0] + velocity[0] * time, start.position[1] + velocity[1] * time, start.position[2] + velocity[2] * time - GRAVITY * time * time / 2] });
  }
  points.push({ time: seconds, position: landing });
  return { points, source: "direct", error: 0, landedAt: seconds };
}

// The grenade goes off after the measured flight time. A computed flight that settles earlier lies
// still until then; one that rolls for longer rolls faster after its first landing. Measurements that
// cannot belong to the flight (shorter than the way to the first landing) are ignored.
export function timedFlight(flight: GrenadeFlight, duration?: number): GrenadeFlight {
  const points = flight.points, end = points[points.length - 1];
  const landed = flight.landedAt ?? end.time;
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration < landed - 0.05 || Math.abs(duration - end.time) < 1e-3) return flight;
  if (duration > end.time) return { ...flight, points: [...points, { time: duration, position: end.position }] };
  const scale = (duration - landed) / Math.max(end.time - landed, 1e-6);
  return { ...flight, points: points.map(point => point.time <= landed ? point : { time: landed + (point.time - landed) * scale, position: point.position }) };
}

// Boxes along the uncollided arc and on to the landing point. Bounces stay close to it, so a page only
// needs the map geometry inside these boxes to reconstruct and follow the flight.
export function flightCorridor(kind: string, release: GrenadeRelease | null, landing: Vector3 | null, recorded: FlightPoint[] | null, margin = 192): FlightBox[] {
  let points: Vector3[];
  if (recorded) points = recorded.map(point => point.position);
  else {
    if (!release || !landing) return [];
    const free = simulateFlight("", throwStart(release, null), null, 10).points;
    const cut = free.findIndex((point, index) => index > 0 && point.position[2] < landing[2] - 64 && point.position[2] < free[index - 1].position[2]);
    points = (cut < 0 ? free : free.slice(0, cut + 1)).filter((_, index) => index % 8 === 0).map(point => point.position);
    points.push(landing);
  }
  const boxes: FlightBox[] = [];
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    boxes.push({ min: [0, 1, 2].map(axis => Math.min(a[axis], b[axis]) - margin) as Vector3, max: [0, 1, 2].map(axis => Math.max(a[axis], b[axis]) + margin) as Vector3 });
  }
  return boxes;
}

export function flightPosition(points: FlightPoint[], time: number): Vector3 {
  if (time <= points[0].time) return points[0].position;
  const last = points[points.length - 1];
  if (time >= last.time) return last.position;
  let low = 0, high = points.length - 1;
  while (high - low > 1) { const middle = (low + high) >> 1; if (points[middle].time <= time) low = middle; else high = middle; }
  const a = points[low], b = points[high], share = (time - a.time) / Math.max(b.time - a.time, 1e-9);
  return [0, 1, 2].map(axis => a.position[axis] + (b.position[axis] - a.position[axis]) * share) as Vector3;
}

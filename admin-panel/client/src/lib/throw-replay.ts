import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { EYE_HEIGHT, SOURCE_UNIT_METRES as U, sourceForward, sourceToScene, type Vector3 } from "../../../shared/map-scene";
import { analyzeThrowMotion, parseThrowTrace } from "../../../shared/throw-motion";
import { directFlight, flightCorridor, flightPosition, grenadeRelease, recordedFlight, searchFlight, timedFlight, GRENADE_TICK,
  type FlightBox, type FlightTracer, type GrenadeFlight } from "../../../shared/grenade-flight";

type Sample = ReturnType<typeof parseThrowTrace>[number];
export type ReplayPhase = "lineup" | "movement" | "release" | "flight" | "effect";
export type ReplayFrame = { phase: ReplayPhase; buttons: Set<string>; fromRelease: number; flying: boolean };

const GRENADE_RADIUS = 2;
const LEAD = 0.6;
const STATIC_LEAD = 1;
const BLEND = 0.6;
const MISSING_FLIGHT = 1.6;
// The effect is watched from up to this far away, from wherever the view is clear.
const VANTAGE = 460;
const EFFECT_HOLD = { Smoke: 4, Molly: 3.5, Flash: 2, HE: 2.5, Decoy: 2.5 } as Record<string, number>;
// Radar ink of the design system.
export const NADE_INK = { Smoke: "#9fb3c4", Flash: "#f7dd6a", HE: "#ef6461", Molly: "#f58345", Decoy: "#ae8eff" } as Record<string, string>;

const toScene = (point: Vector3) => new THREE.Vector3(...sourceToScene(point));
const lerp = (a: Vector3, b: Vector3, share: number): Vector3 => [0, 1, 2].map(axis => a[axis] + (b[axis] - a[axis]) * share) as Vector3;
const smooth = (value: number) => { const share = THREE.MathUtils.clamp(value, 0, 1); return share * share * (3 - 2 * share); };
const flat = (a: Vector3, b: Vector3) => { const x = b[0] - a[0], y = b[1] - a[1], length = Math.hypot(x, y); return length > 1e-3 ? [x / length, y / length] as [number, number] : null; };

// Map triangles inside the boxes, converted back to Source units and searchable by a BVH. Leaves,
// decals and other see-through surfaces are left out, like in the floor search of the Abwurfsicht.
export async function corridorTracer(root: THREE.Object3D, boxes: FlightBox[], signal: { aborted: boolean } = { aborted: false }): Promise<FlightTracer | null> {
  if (!boxes.length) return null;
  const sceneBoxes = boxes.map(box => new THREE.Box3().setFromPoints([toScene(box.min), toScene(box.max)]));
  const positions: number[] = [];
  const vertex = new THREE.Vector3(), bounds = new THREE.Box3();
  const triangle = new Float64Array(9), low = [0, 0, 0], high = [0, 0, 0];
  const meshes: THREE.Mesh[] = [];
  root.traverse(object => { if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh); });
  // Large maps hold millions of triangles; yield to the page every few milliseconds.
  let slice = performance.now();
  for (const mesh of meshes) {
    if (performance.now() - slice > 12) {
      await new Promise(resolve => setTimeout(resolve, 0));
      if (signal.aborted) return null;
      slice = performance.now();
    }
    collect(mesh);
  }
  function collect(mesh: THREE.Mesh) {
    const material = mesh.material as THREE.Material;
    if (material.transparent || material.alphaTest || material.polygonOffset) return;
    const geometry = mesh.geometry;
    geometry.boundingBox ?? geometry.computeBoundingBox();
    bounds.copy(geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);
    if (!sceneBoxes.some(box => box.intersectsBox(bounds))) return;
    const position = geometry.getAttribute("position"), index = geometry.getIndex();
    const count = index ? index.count : position.count;
    for (let i = 0; i + 2 < count; i += 3) {
      for (let corner = 0; corner < 3; corner++) {
        vertex.fromBufferAttribute(position, index ? index.getX(i + corner) : i + corner).applyMatrix4(mesh.matrixWorld);
        triangle[corner * 3] = vertex.z / U; triangle[corner * 3 + 1] = vertex.x / U; triangle[corner * 3 + 2] = vertex.y / U;
      }
      for (let axis = 0; axis < 3; axis++) {
        low[axis] = Math.min(triangle[axis], triangle[axis + 3], triangle[axis + 6]);
        high[axis] = Math.max(triangle[axis], triangle[axis + 3], triangle[axis + 6]);
      }
      for (const box of boxes) {
        if (high[0] < box.min[0] || low[0] > box.max[0] || high[1] < box.min[1] || low[1] > box.max[1] || high[2] < box.min[2] || low[2] > box.max[2]) continue;
        for (let k = 0; k < 9; k++) positions.push(triangle[k]);
        break;
      }
    }
  }
  if (!positions.length) return () => null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const bvh = new MeshBVH(geometry);
  const ray = new THREE.Ray(), from = new THREE.Vector3(), direction = new THREE.Vector3(), normal = new THREE.Vector3();
  // The grenade is a small sphere: it touches a surface once its centre comes within the radius.
  return (start, move) => {
    const length = Math.hypot(move[0], move[1], move[2]);
    if (length < 1e-6) return null;
    direction.set(move[0] / length, move[1] / length, move[2] / length);
    ray.set(from.set(start[0], start[1], start[2]), direction);
    const hit = bvh.raycastFirst(ray, THREE.DoubleSide, 0, length + GRENADE_RADIUS * 4);
    if (!hit?.face) return null;
    normal.copy(hit.face.normal);
    if (normal.dot(direction) > 0) normal.negate();
    const toward = -(move[0] * normal.x + move[1] * normal.y + move[2] * normal.z);
    if (toward <= 1e-6) return null;
    const fraction = Math.max(0, (from.sub(hit.point).dot(normal) - GRENADE_RADIUS) / toward);
    return fraction > 1 ? null : { fraction, normal: [normal.x, normal.y, normal.z] };
  };
}

function vector(value: unknown): Vector3 | null {
  const parts = String(value ?? "").trim().split(/[\s,]+/).map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? parts as Vector3 : null;
}

export type ReplayPlan = Awaited<ReturnType<typeof planReplay>>;

// Everything the replay shows, keyed by seconds since it started. Reconstruction yields to the page
// between batches; signal aborts it when the view closes.
export async function planReplay(nade: Record<string, any>, root: THREE.Object3D, signal: { aborted: boolean }) {
  const kind = String(nade.type || "Smoke");
  const samples = nade.throwTrace ? parseThrowTrace(nade.throwTrace) : [];
  const motion = samples.length ? analyzeThrowMotion(nade.throwTrace) : null;
  const landing = vector(nade.landingPos);
  const release = grenadeRelease(nade);
  let flight: GrenadeFlight | null = recordedFlight(nade);
  const boxes = flightCorridor(kind, release, landing, flight?.points ?? null);
  // Room around the landing point for the camera that watches the effect.
  const target = flight ? flight.points[flight.points.length - 1].position : landing;
  if (target) boxes.push({ min: [target[0] - VANTAGE - 64, target[1] - VANTAGE - 64, target[2] - 128], max: [target[0] + VANTAGE + 64, target[1] + VANTAGE + 64, target[2] + VANTAGE + 128] });
  const tracer = await corridorTracer(root, boxes, signal);
  if (signal.aborted) return null;
  if (!flight && release && landing && tracer) {
    const search = searchFlight(kind, release, landing, tracer);
    for (let step = search.next(); ; step = search.next()) {
      if (step.done) { flight = step.value; break; }
      await new Promise(resolve => setTimeout(resolve, 0));
      if (signal.aborted) return null;
    }
  }
  if (!flight && release && landing) flight = directFlight(kind, release, landing, nade.flightDuration);
  // Recorded paths end on the detonation; computed ones wait for the measured flight time.
  if (flight && flight.source !== "recorded") flight = timedFlight(flight, nade.flightDuration);

  // Inputs from shortly before the lineup spot until the grenade leaves (the last sample).
  const last = samples.length - 1;
  let traceStart = 0, traceEnd = 0;
  if (motion) {
    traceEnd = samples[last].time;
    const first = motion.movement && !motion.setup.found ? samples[motion.movement.startIndex].time : samples[motion.setup.index].time;
    traceStart = Math.max(samples[0].time, Math.min(first, traceEnd) - LEAD);
  }
  const releaseAt = motion ? traceEnd - traceStart : STATIC_LEAD;
  const flightEnd = flight ? flight.points[flight.points.length - 1].time : landing ? MISSING_FLIGHT : 0;
  const pop = releaseAt + flightEnd;
  const center = flight ? flight.points[flight.points.length - 1].position : landing;
  const end = center ? pop + (EFFECT_HOLD[kind] ?? 2.5) : releaseAt + 0.5;

  // Eye height eases into and out of crouching instead of jumping between two heights.
  const eyes: number[] = [];
  for (let i = 0; i <= last; i++) {
    const target = samples[i].buttons.has("duck") ? EYE_HEIGHT.crouching : EYE_HEIGHT.standing;
    const previous = i > 0 ? eyes[i - 1] : target;
    eyes.push(previous + (target - previous) * Math.min(1, (samples[i].time - (samples[i - 1]?.time ?? samples[i].time)) / 0.12));
  }
  const fallback = vector(nade.lineupPos), fallbackAngles = vector(nade.lineupAng);
  const staticEye: Vector3 | null = fallback ? [fallback[0], fallback[1], fallback[2] - 4 + (nade.is_crouch ? EYE_HEIGHT.crouching : EYE_HEIGHT.standing)] : null;

  function sampleAt(time: number) {
    let low = 0, high = last;
    while (high - low > 1) { const middle = (low + high) >> 1; if (samples[middle].time <= time) low = middle; else high = middle; }
    const a = samples[low], b = samples[high];
    const share = b.time > a.time ? THREE.MathUtils.clamp((time - a.time) / (b.time - a.time), 0, 1) : 0;
    const yaw = a.view[1] + (((b.view[1] - a.view[1]) % 360 + 540) % 360 - 180) * share;
    const position = lerp(a.position, b.position, share);
    return { eye: [position[0], position[1], position[2] + eyes[low] + (eyes[high] - eyes[low]) * share] as Vector3,
      pitch: a.view[0] + (b.view[0] - a.view[0]) * share, yaw, buttons: (share < 0.5 ? a : b).buttons };
  }

  // First person at the moment of letting go, also for lineups without a trace.
  function firstPerson(time: number) {
    if (motion) return sampleAt(traceStart + Math.min(time, releaseAt));
    if (!staticEye || !fallbackAngles) return null;
    return { eye: staticEye, pitch: fallbackAngles[0], yaw: fallbackAngles[1], buttons: new Set<string>(time < releaseAt - 0.15 ? [] : ["attack"]) };
  }
  const look = (pose: { eye: Vector3; pitch: number; yaw: number }) => {
    const forward = sourceForward(pose.pitch, pose.yaw);
    return { eye: pose.eye, target: [pose.eye[0] + forward[0] * 100, pose.eye[1] + forward[1] * 100, pose.eye[2] + forward[2] * 100] as Vector3 };
  };

  const throwDirection = (() => {
    const from = release?.origin ?? staticEye, to = center;
    return (from && to && flat(from, to)) || [1, 0] as [number, number];
  })();
  // A camera point pulled in front of walls between the subject and the wanted position.
  function clear(subject: Vector3, wanted: Vector3) {
    if (!tracer) return wanted;
    const move: Vector3 = [wanted[0] - subject[0], wanted[1] - subject[1], wanted[2] - subject[2]];
    const hit = tracer(subject, move);
    return hit ? lerp(subject, wanted, Math.max(0, hit.fraction - 0.08)) : wanted;
  }
  // Behind and a little to the side of the grenade, so the arc reads as a curve instead of a line.
  function chase(time: number) {
    const position = flightPosition(flight!.points, time);
    const back = flightPosition(flight!.points, Math.max(0, time - 0.35));
    const [x, y] = flat(back, position) ?? throwDirection;
    const subject: Vector3 = [position[0], position[1], position[2] + 6];
    return { eye: clear(subject, [position[0] - x * 140 - y * 60, position[1] - y * 140 + x * 60, position[2] + 55]), target: position };
  }
  // The clearest view onto the effect, preferably from the thrower's side and not too steep.
  const vantage = (() => {
    if (!center) return null;
    const subject: Vector3 = [center[0], center[1], center[2] + 70];
    const base = Math.atan2(-throwDirection[1], -throwDirection[0]);
    let best = { score: -Infinity, eye: subject };
    for (const [step, elevation] of [[0, 22], [0, 38], [0, 58], [0, 78]].flatMap(([, e]) => Array.from({ length: 16 }, (_, k) => [k, e]))) {
      const turn = base + (step <= 8 ? step : step - 16) * Math.PI / 8, up = elevation * Math.PI / 180;
      const wanted: Vector3 = [subject[0] + Math.cos(turn) * Math.cos(up) * VANTAGE, subject[1] + Math.sin(turn) * Math.cos(up) * VANTAGE, subject[2] + Math.sin(up) * VANTAGE];
      const eye = clear(subject, wanted), reach = Math.hypot(eye[0] - subject[0], eye[1] - subject[1], eye[2] - subject[2]);
      const score = Math.min(reach, 380) - Math.abs(step <= 8 ? step : 16 - step) * 6 - elevation * 0.6;
      if (score > best.score) best = { score, eye };
    }
    return { eye: best.eye, target: [center[0], center[1], center[2] + 50] as Vector3 };
  })();
  function overview(time: number) {
    // A slow push towards the effect while it lasts.
    return { eye: lerp(vantage!.eye, vantage!.target, Math.min(time, 6) * 0.015), target: vantage!.target };
  }
  const blend = (a: { eye: Vector3; target: Vector3 }, b: { eye: Vector3; target: Vector3 }, share: number) =>
    ({ eye: lerp(a.eye, b.eye, smooth(share)), target: lerp(a.target, b.target, smooth(share)) });

  const movementAt = motion?.movement ? samples[motion.movement.startIndex].time - traceStart : null;
  const letGoAt = motion ? samples[motion.release.index].time - traceStart : null;
  return {
    kind, flight, landing, center, releaseAt, pop, end, tracer, movementAt, letGoAt,
    hasInputs: Boolean(motion),
    frame(time: number): ReplayFrame {
      const pose = firstPerson(time);
      const phase: ReplayPhase = time >= pop && center ? "effect" : time >= releaseAt ? "flight"
        : letGoAt !== null && time >= letGoAt - 0.05 ? "release" : movementAt !== null && time >= movementAt ? "movement" : "lineup";
      return { phase, buttons: time < releaseAt ? pose?.buttons ?? new Set() : new Set(), fromRelease: Math.min(time, center ? pop : time) - (letGoAt ?? releaseAt), flying: time >= releaseAt && time < pop };
    },
    camera(time: number) {
      const own = firstPerson(time);
      if (!own) return null;
      const start = look(own);
      if (time < releaseAt || !center) return start;
      const flown = time - releaseAt;
      if (!flight) return blend(start, overview(0), flown / MISSING_FLIGHT);
      if (time < pop) return flown < BLEND ? blend(start, chase(flown), flown / BLEND) : chase(flown);
      return blend(chase(flightEnd), overview(time - pop), (time - pop) / 1.4);
    },
    grenade(time: number): Vector3 | null {
      return flight && time >= releaseAt && time < pop ? flightPosition(flight.points, time - releaseAt) : null;
    },
  };
}

// Grenade, trail, target ring and the effect where it goes off, all in the map scene.
export function replayObjects(plan: NonNullable<ReplayPlan>, resolution: THREE.Vector2, exposure = 1) {
  const group = new THREE.Group();
  const ink = new THREE.Color(NADE_INK[plan.kind] ?? "#a5f3c6");
  const disposables: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(value: T) => { disposables.push(value); return value; };

  const grenade = new THREE.Mesh(own(new THREE.SphereGeometry(3 * U, 12, 8)), own(new THREE.MeshBasicMaterial({ color: ink, toneMapped: false })));
  grenade.visible = false;
  group.add(grenade);

  // The trail is sampled per tick, so it ends at the grenade between the recorded points.
  let trail: Line2 | null = null, trailTimes: number[] = [];
  if (plan.flight) {
    const end = plan.flight.points[plan.flight.points.length - 1].time;
    trailTimes = Array.from({ length: Math.max(2, Math.ceil(end / GRENADE_TICK) + 1) }, (_, index) => Math.min(end, index * GRENADE_TICK));
    const geometry = own(new LineGeometry());
    geometry.setPositions(trailTimes.flatMap(time => sourceToScene(flightPosition(plan.flight!.points, time))));
    const material = own(new LineMaterial({ color: ink, linewidth: 3, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }));
    material.resolution.copy(resolution);
    trail = new Line2(geometry, material);
    trail.computeLineDistances();
    trail.frustumCulled = false;
    group.add(trail);
  }

  const ring = new THREE.Mesh(own(new THREE.RingGeometry(34 * U, 42 * U, 48)),
    own(new THREE.MeshBasicMaterial({ color: ink, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, toneMapped: false })));
  ring.rotation.x = -Math.PI / 2;
  if (plan.center) ring.position.copy(toScene([plan.center[0], plan.center[1], plan.center[2] + 1]));
  ring.visible = false;
  group.add(ring);

  // Effects: a smoke cloud of overlapping puffs, a burning patch, or a short burst.
  const effect = new THREE.Group();
  if (plan.center) effect.position.copy(toScene(plan.center));
  group.add(effect);
  const puffs: { mesh: THREE.Mesh; delay: number }[] = [];
  let burst: THREE.Mesh | null = null, fire: THREE.Mesh | null = null;
  let seed = 11;
  const random = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  if (plan.kind === "Smoke") {
    // Bright maps get a strong exposure; the smoke keeps its grey instead of turning white.
    const material = own(new THREE.MeshLambertMaterial({ color: new THREE.Color(0xc4c9cf).multiplyScalar(Math.min(1, 1.15 / exposure)), transparent: true, opacity: 0.94 }));
    const sphere = own(new THREE.IcosahedronGeometry(1, 3));
    for (let i = 0; i < 26; i++) {
      // CS2 smokes cover about 144 units around the grenade and rise to roughly head height and above.
      const angle = random() * Math.PI * 2, reach = Math.sqrt(random()) * 115, height = 30 + random() * 100;
      const mesh = new THREE.Mesh(sphere, material);
      mesh.position.copy(new THREE.Vector3(...sourceToScene([Math.cos(angle) * reach, Math.sin(angle) * reach, height])));
      mesh.userData.size = (58 + random() * 34) * U;
      puffs.push({ mesh, delay: reach / 115 * 0.5 + random() * 0.15 });
      effect.add(mesh);
    }
  } else if (plan.kind === "Molly") {
    fire = new THREE.Mesh(own(new THREE.CircleGeometry(1, 40)), own(new THREE.MeshBasicMaterial({ color: 0xff7a2e, transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false })));
    fire.rotation.x = -Math.PI / 2;
    fire.position.y = 2 * U;
    effect.add(fire);
  } else {
    burst = new THREE.Mesh(own(new THREE.SphereGeometry(1, 24, 16)), own(new THREE.MeshBasicMaterial({ color: plan.kind === "Flash" ? 0xffffff : ink, transparent: true, depthWrite: false, toneMapped: false })));
    burst.position.y = 8 * U;
    effect.add(burst);
  }
  effect.visible = false;

  return {
    group,
    resize(width: number, height: number) { if (trail) (trail.material as LineMaterial).resolution.set(width, height); },
    update(time: number) {
      const position = plan.grenade(time);
      grenade.visible = Boolean(position);
      if (position) grenade.position.copy(toScene(position));
      if (trail) {
        const flown = time - plan.releaseAt;
        const segments = flown <= 0 ? 0 : Math.min(trailTimes.length - 1, Math.floor(flown / GRENADE_TICK));
        trail.visible = segments > 0;
        (trail.geometry as LineGeometry).instanceCount = segments;
        (trail.material as LineMaterial).opacity = time >= plan.pop ? 0.45 : 0.9;
      }
      ring.visible = time >= plan.releaseAt && time < plan.pop;
      const since = time - plan.pop;
      effect.visible = Boolean(plan.center) && since >= 0;
      if (!effect.visible) return;
      for (const { mesh, delay } of puffs) {
        const grown = THREE.MathUtils.clamp((since - delay) / 0.9, 0, 1);
        mesh.visible = grown > 0;
        mesh.scale.setScalar(mesh.userData.size * (1 - Math.pow(1 - grown, 3)));
      }
      if (fire) {
        const spread = 1 - Math.pow(1 - THREE.MathUtils.clamp(since / 0.8, 0, 1), 2);
        fire.scale.setScalar((40 + 90 * spread) * U * (1 + 0.04 * Math.sin(since * 17)));
        (fire.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.2 * Math.sin(since * 11);
      }
      if (burst) {
        const share = THREE.MathUtils.clamp(since / (plan.kind === "Flash" ? 0.35 : 0.6), 0, 1);
        burst.visible = share < 1;
        burst.scale.setScalar((plan.kind === "Flash" ? 70 : 150) * U * Math.pow(share, 0.5));
        (burst.material as THREE.MeshBasicMaterial).opacity = 1 - share;
      }
    },
    dispose() { group.removeFromParent(); for (const item of disposables) item.dispose(); },
  };
}

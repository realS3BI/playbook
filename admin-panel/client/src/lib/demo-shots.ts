import * as THREE from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { EYE_HEIGHT, SOURCE_UNIT_METRES as U } from "../../../shared/map-scene";
import { frameAt } from "../../../shared/demo-replay";
import type { PlayerFrame, RoundReplay, Shot } from "../../../shared/demos";

// Shots in the 3D replay: a bright tracer flies from the muzzle to where the bullet stopped,
// a faint trail stays a moment longer, and the muzzle flashes. Hits end at the player they
// damaged, misses at the first wall along the aim. Times are replay seconds, so slow motion
// and pausing keep the shot on screen.
const FLASH = 0.05, FLIGHT = 0.06, TRAIL = 0.35, IMPACT = 0.4;
// Bullets carry far; past this distance a miss counts as flying into the sky.
const RANGE = 4096;
const STREAK = 140;
// Raycasts against the map are cached per shot; a burst of new shots spreads over a few frames.
const RAYCASTS_PER_FRAME = 12;
const MAX = 160;

type Path = { start: THREE.Vector3; end: THREE.Vector3; hit: "player" | "head" | "wall" | null };

const toScene = (x: number, y: number, z: number, target = new THREE.Vector3()) => target.set(y * U, z * U, x * U);
const eye = (player?: PlayerFrame) => EYE_HEIGHT.standing - (EYE_HEIGHT.standing - EYE_HEIGHT.crouching) * (player?.duck || 0);

// Lines keep their width in pixels, so a tracer passing the camera stays as thin as one far away.
// Additive blending: black adds nothing, so dimming a colour fades the shot out.
function lineSet(width: number) {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(new Float32Array(MAX * 6));
  geometry.setColors(new Float32Array(MAX * 6));
  const material = new LineMaterial({ linewidth: width, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const lines = new LineSegments2(geometry, material);
  lines.frustumCulled = false;
  lines.renderOrder = 3;
  const positions = (geometry.attributes.instanceStart as THREE.InterleavedBufferAttribute).data;
  const colors = (geometry.attributes.instanceColorStart as THREE.InterleavedBufferAttribute).data;
  let count = 0;
  return {
    lines,
    material,
    add(a: THREE.Vector3, b: THREE.Vector3, from: THREE.Color, to: THREE.Color) {
      if (count >= MAX) return;
      a.toArray(positions.array, count * 6);
      b.toArray(positions.array, count * 6 + 3);
      from.toArray(colors.array, count * 6);
      to.toArray(colors.array, count * 6 + 3);
      count++;
    },
    commit() {
      geometry.instanceCount = count;
      positions.needsUpdate = colors.needsUpdate = true;
      const drawn = count;
      count = 0;
      return drawn;
    },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}

/** `walls` returns the map meshes to stop misses at, or null while they are not ready for raycasts. */
export function createShotLayer(scene: THREE.Scene, walls: () => THREE.Mesh[] | null) {
  const trails = lineSet(1.5), tracers = lineSet(2.5);
  const flashGeometry = new THREE.IcosahedronGeometry(1, 1);
  const flashMaterial = new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false });
  const flashes = new THREE.InstancedMesh(flashGeometry, flashMaterial, MAX);
  flashes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  flashes.setColorAt(0, new THREE.Color());
  flashes.frustumCulled = false;
  flashes.count = 0;
  flashes.renderOrder = 3;
  scene.add(trails.lines, tracers.lines, flashes);
  const tracer = new THREE.Color(0xffd98a), trail = new THREE.Color(0xffe7b8), wound = new THREE.Color(0xff4a3d),
    muzzle = new THREE.Color(0xffb347), dust = new THREE.Color(0xc9c2b4);
  const near = new THREE.Color(), far = new THREE.Color();
  const paths = new WeakMap<Shot, Path>();
  const raycaster = new THREE.Raycaster();
  const matrix = new THREE.Matrix4(), scale = new THREE.Vector3(), head = new THREE.Vector3(), tail = new THREE.Vector3(), quaternion = new THREE.Quaternion();
  let replay: RoundReplay | null = null;

  raycaster.firstHitOnly = true;
  const resolve = (shot: Shot): Path | null => {
    const shooter = frameAt(replay!, shot.time).find(player => player.id === shot.playerId);
    const yaw = THREE.MathUtils.degToRad(shot.yaw), pitch = THREE.MathUtils.degToRad(shot.pitch);
    const aim = new THREE.Vector3(Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), -Math.sin(pitch));
    const eyeZ = shot.z + eye(shooter);
    const origin = toScene(shot.x, shot.y, eyeZ);
    const sceneAim = toScene(aim.x, aim.y, aim.z).normalize();
    // The muzzle sits forward, right and below the eyes, like the gun in the figure's hands.
    const start = toScene(
      shot.x + aim.x * 26 + Math.sin(yaw) * 4,
      shot.y + aim.y * 26 - Math.cos(yaw) * 4,
      eyeZ + aim.z * 26 - 7,
    );
    const target = shot.hits?.find(hit => hit.head) || shot.hits?.[0];
    if (target) {
      const victim = frameAt(replay!, shot.time).find(player => player.id === target.id);
      if (victim) {
        const height = target.head ? eye(victim) + 1 : eye(victim) - 22;
        return { start, end: toScene(victim.x, victim.y, victim.z + height), hit: target.head ? "head" : "player" };
      }
    }
    const meshes = walls();
    if (!meshes) return null;
    raycaster.set(origin, sceneAim);
    raycaster.far = RANGE * U;
    const wall = raycaster.intersectObjects(meshes, false)[0];
    return { start, end: wall ? wall.point.clone() : origin.clone().addScaledVector(sceneAim, RANGE * U), hit: wall ? "wall" : null };
  };

  let flashCount = 0;
  const flash = (at: THREE.Vector3, size: number, tint: THREE.Color, strength: number) => {
    if (flashCount >= MAX) return;
    matrix.compose(at, quaternion.identity(), scale.setScalar(size * U));
    flashes.setMatrixAt(flashCount, matrix);
    flashes.setColorAt(flashCount++, near.copy(tint).multiplyScalar(strength));
  };

  return {
    /** Line widths are in CSS pixels of the canvas. */
    resize(width: number, height: number) {
      trails.material.resolution.set(width, height);
      tracers.material.resolution.set(width, height);
    },
    /** `egoId` is the player the camera looks through; their muzzle flash would cover the view. */
    update(time: number, current: RoundReplay, egoId = "") {
      replay = current;
      const shots = current.shots || [];
      // First shot that can still be on screen.
      let low = 0, high = shots.length;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (shots[mid].time <= time - TRAIL) low = mid + 1;
        else high = mid;
      }
      let raycasts = 0, pending = false;
      flashCount = 0;
      for (let index = low; index < shots.length && shots[index].time <= time; index++) {
        const shot = shots[index];
        let path = paths.get(shot);
        if (!path) {
          const resolved = raycasts++ < RAYCASTS_PER_FRAME ? resolve(shot) : null;
          if (!resolved) { pending = true; continue; }
          paths.set(shot, path = resolved);
        }
        const age = time - shot.time;
        const distance = path.start.distanceTo(path.end);
        const flight = FLIGHT + distance / U / 40000;
        // The trail fades from the muzzle towards the end and with age.
        const strength = 0.6 * (1 - age / TRAIL);
        const tint = path.hit === "player" || path.hit === "head" ? wound : trail;
        trails.add(path.start, path.end, near.copy(tint).multiplyScalar(strength), far.copy(tint).multiplyScalar(strength * 0.35));
        if (age < flight) {
          // The streak's head moves from the muzzle to the end; its tail follows at a fixed length.
          const reached = Math.min(1, (age + 1 / 120) / flight);
          head.lerpVectors(path.start, path.end, reached);
          tail.lerpVectors(path.start, path.end, Math.max(0, reached - STREAK * U / Math.max(distance, 1e-4)));
          tracers.add(tail, head, near.setRGB(0, 0, 0), far.copy(tracer).multiplyScalar(1.6));
        }
        if (age < FLASH && shot.playerId !== egoId) flash(path.start, 2 + (index % 3) * 0.4, muzzle, 1.6 * (1 - age / FLASH));
        if (path.hit && age >= flight && age < IMPACT) {
          const body = path.hit !== "wall";
          flash(path.end, (body ? (path.hit === "head" ? 4.5 : 3.4) : 2.2) * (1 + age / IMPACT), body ? wound : dust, (body ? 1.4 : 0.8) * (1 - age / IMPACT));
        }
      }
      trails.commit();
      tracers.commit();
      flashes.count = flashCount;
      flashes.instanceMatrix.needsUpdate = true;
      if (flashes.instanceColor) flashes.instanceColor.needsUpdate = true;
      // Shots still waiting for their raycast need another frame, even while paused.
      return pending;
    },
    dispose() {
      scene.remove(trails.lines, tracers.lines, flashes);
      trails.dispose();
      tracers.dispose();
      flashes.dispose();
      flashGeometry.dispose();
      flashMaterial.dispose();
    },
  };
}

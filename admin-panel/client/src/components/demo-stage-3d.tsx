import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RefreshCw } from "lucide-react";
import { EYE_HEIGHT, SOURCE_UNIT_METRES, VERTICAL_FOV_DEGREES } from "../../../shared/map-scene";
import { areaEffects, bombAt, frameAt, grenadeAt, loadoutAt, loadoutsById, type AreaEffect } from "../../../shared/demo-replay";
import { loadoutSummary, type DemoPlayer, type PlayerFrame, type RoundReplay } from "../../../shared/demos";
import { acquireMapScene, mountMapScene, viewExposure, type MapSceneInfo } from "../lib/map-scene";
import { worldToRadar, type RadarCalibration } from "../lib/nade-radar";
import { api } from "../lib/api";
import { serverNow } from "../lib/live";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import { Spinner } from "./ui/spinner";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { CrosshairGlyph } from "./lineup-crosshair";

export type CameraMode = "ego" | "free";
type Point = { x: number; y: number; level: string };

type Phase =
  | { kind: "manifest" }
  | { kind: "loading"; loaded: number; total: number }
  | { kind: "ready" }
  | { kind: "missing" }
  | { kind: "unsupported" }
  | { kind: "error"; message: string };

type Props = {
  mapName: string;
  mapLabel: string;
  replay: RoundReplay;
  roster: DemoPlayer[];
  /** Current replay time; read on every animation frame so playback stays smooth between React renders. */
  clock: React.RefObject<() => number>;
  focusId: string;
  mode: CameraMode;
  onModeChange: (mode: CameraMode) => void;
  xray: boolean;
  calibration: RadarCalibration | null;
  pointer?: (Point & { at: number }) | null;
  onPoint?: (point: Point) => void;
  onFocus?: (id: string) => void;
  /** Reports whether the mouse is captured for flying. */
  onCaptureChange?: (captured: boolean) => void;
};

const U = SOURCE_UNIT_METRES;
const megabytes = (bytes: number) => (bytes / 1048576).toLocaleString("de-AT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
// Source (x, y, z) to the map scene, see shared/map-scene.ts.
const toScene = (x: number, y: number, z: number, target = new THREE.Vector3()) => target.set(y * U, z * U, x * U);
const eyeHeight = (player: PlayerFrame) => EYE_HEIGHT.standing - (EYE_HEIGHT.standing - EYE_HEIGHT.crouching) * (player.duck || 0);
// Units per second, roughly a running player; Shift flies three times as fast.
const FLY_SPEED = 400 * U;
const MOVE_KEYS: Record<string, [number, number, number]> = {
  KeyW: [0, 0, 1], KeyS: [0, 0, -1], KeyA: [-1, 0, 0], KeyD: [1, 0, 0],
  KeyE: [0, 1, 0], KeyQ: [0, -1, 0], KeyC: [0, -1, 0],
};
// Radians per pixel of mouse movement while the mouse is captured, about 0.13° like a mid CS2 sensitivity.
const LOOK_SPEED = 0.0022;
const TURN_KEYS: Record<string, [number, number]> = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
// Scopes in CS2 narrow the 90° view to about 40°, roughly 2.5 times magnification.
const SCOPE_ZOOM = 2.5;
const SNIPER = /awp|ssg|scar|g3sg1/i;

function token(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(value || fallback);
}

function grenadeColor(kind: string) {
  return /smoke/i.test(kind) ? token("--nade-smoke", "#9fb3c4")
    : /flash/i.test(kind) ? token("--nade-flash", "#f7dd6a")
    : /molotov|incend/i.test(kind) ? token("--nade-molly", "#f58345")
    : /he/i.test(kind) ? token("--nade-he", "#ef6461")
    : /decoy/i.test(kind) ? token("--nade-decoy", "#ae8eff")
    : token("--nade-other", "#a5f3c6");
}

const opaque = ({ object }: THREE.Intersection) => {
  const material = (object as THREE.Mesh).material as THREE.Material;
  return !!material && !material.transparent && !(material as THREE.MeshBasicMaterial).alphaTest;
};

export default function DemoStage3d(props: Props) {
  const { mapName, mapLabel, roster } = props;
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelRefs = useRef(new Map<string, HTMLDivElement>());
  const live = useRef(props);
  live.current = props;
  const [phase, setPhase] = useState<Phase>({ kind: "manifest" });
  const [attempt, setAttempt] = useState(0);
  // What the HUD layer needs to know about the picture: ego crosshair and scope.
  const [ego, setEgo] = useState<{ scoped: boolean; sniper: boolean } | null>(null);
  const [unit, setUnit] = useState(1);
  const [captured, setCaptured] = useState(false);
  const [paceLabel, setPaceLabel] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false, release = () => {}, teardown = () => {};
    setPhase({ kind: "manifest" });
    (async () => {
      let info: MapSceneInfo;
      try { info = await api(`/api/map-scenes/${encodeURIComponent(mapName)}`); }
      catch (error) {
        if (!disposed) setPhase(error.status === 404 ? { kind: "missing" } : { kind: "error", message: "Die 3D-Karte konnte nicht abgerufen werden. Prüfe deine Verbindung und versuche es erneut." });
        return;
      }
      if (disposed) return;
      const handle = acquireMapScene(info, (loaded, total) => { if (!disposed) setPhase(current => current.kind === "ready" ? current : { kind: "loading", loaded, total }); });
      release = handle.release;
      let loaded;
      try { loaded = await handle.promise; }
      catch {
        if (!disposed) setPhase({ kind: "error", message: `Die 3D-Karte von ${mapLabel} konnte nicht geladen werden. Prüfe deine Verbindung und versuche es erneut.` });
        return;
      }
      if (disposed) return;
      const canvas = canvasRef.current!, stage = stageRef.current!;
      let mounted: ReturnType<typeof mountMapScene>;
      try { mounted = mountMapScene(canvas, loaded); }
      catch { setPhase({ kind: "unsupported" }); return; }
      const { renderer, scene } = mounted;
      const view = new THREE.PerspectiveCamera(VERTICAL_FOV_DEGREES, 16 / 9, 0.05, 3000);
      view.rotation.order = "YXZ";
      const owned: { dispose(): void }[] = [];
      const own = <T extends { dispose(): void }>(value: T) => { owned.push(value); return value; };

      // Players: a capsule body and a head that turns with the view. The X-ray copy only draws
      // where walls cover the player, so visible players keep their normal look.
      const colors = { 2: token("--side-t", "#de9a3a"), 3: token("--side-ct", "#6aa9ec") } as Record<number, THREE.Color>;
      const brand = token("--brand", "#80cabc");
      const bodyGeometry = own(new THREE.CapsuleGeometry(13 * U, 32 * U, 4, 12));
      const headGeometry = own(new THREE.SphereGeometry(7.5 * U, 16, 12));
      const visorGeometry = own(new THREE.BoxGeometry(9 * U, 3 * U, 4 * U));
      const ringGeometry = own(new THREE.RingGeometry(20 * U, 24 * U, 40).rotateX(-Math.PI / 2));
      const gazeGeometry = own(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 44 * U)]));
      const solid = (color: THREE.Color) => own(new THREE.MeshLambertMaterial({ color }));
      const sideMaterials = new Map<number, { body: THREE.Material; xray: THREE.Material; gaze: THREE.Material }>();
      const materialsFor = (side: number) => {
        let entry = sideMaterials.get(side);
        if (!entry) {
          const color = colors[side] || new THREE.Color("#a3b3c3");
          entry = {
            body: solid(color),
            xray: own(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false, depthFunc: THREE.GreaterDepth })),
            gaze: own(new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 })),
          };
          sideMaterials.set(side, entry);
        }
        return entry;
      };
      const deadMaterial = own(new THREE.MeshLambertMaterial({ color: 0x5d6873, transparent: true, opacity: 0.7 }));
      const visorMaterial = solid(new THREE.Color(0x10161d));
      const ringMaterial = own(new THREE.MeshBasicMaterial({ color: brand, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));

      type Actor = { root: THREE.Group; pose: THREE.Group; body: THREE.Mesh; head: THREE.Group; headMesh: THREE.Mesh; gaze: THREE.Line; xray: THREE.Group; xrayBody: THREE.Mesh; xrayHead: THREE.Mesh; ring: THREE.Mesh; side: number; alive: boolean };
      const actors = new Map<string, Actor>();
      const actorFor = (player: PlayerFrame) => {
        let actor = actors.get(player.id);
        if (!actor) {
          const root = new THREE.Group(), pose = new THREE.Group(), head = new THREE.Group(), xray = new THREE.Group();
          const body = new THREE.Mesh(bodyGeometry), headMesh = new THREE.Mesh(headGeometry), visor = new THREE.Mesh(visorGeometry, visorMaterial);
          const gaze = new THREE.Line(gazeGeometry);
          const xrayBody = new THREE.Mesh(bodyGeometry), xrayHead = new THREE.Mesh(headGeometry);
          const ring = new THREE.Mesh(ringGeometry, ringMaterial);
          body.userData.id = player.id;
          visor.position.set(0, 0, 6.5 * U);
          head.add(headMesh, visor, gaze);
          xrayBody.renderOrder = xrayHead.renderOrder = 2;
          xrayHead.scale.setScalar(1.12);
          xray.add(xrayBody, xrayHead);
          pose.add(body, head, xray);
          ring.position.y = 1 * U;
          root.add(pose, ring);
          scene.add(root);
          actor = { root, pose, body, head, headMesh, gaze, xray, xrayBody, xrayHead, ring, side: 0, alive: true };
          actors.set(player.id, actor);
        }
        if (actor.side !== player.side || actor.alive !== player.health > 0) {
          const materials = materialsFor(player.side);
          actor.side = player.side;
          actor.alive = player.health > 0;
          actor.body.material = actor.headMesh.material = actor.alive ? materials.body : deadMaterial;
          actor.xrayBody.material = actor.xrayHead.material = materials.xray;
          actor.gaze.material = materials.gaze;
        }
        return actor;
      };

      // Smoke clouds and fire areas are schematic: about the size of the real effect, without its shape.
      const smokeGeometry = own(new THREE.SphereGeometry(1, 20, 14));
      const fireGeometry = own(new THREE.CylinderGeometry(1, 1, 1, 36));
      const pointerGeometry = own(new THREE.CylinderGeometry(3 * U, 3 * U, 320 * U, 12).translate(0, 160 * U, 0));
      const projectileGeometry = own(new THREE.SphereGeometry(3.5 * U, 10, 8));
      const bombGeometry = own(new THREE.BoxGeometry(12 * U, 5 * U, 9 * U));
      const pulseGeometry = own(new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2));
      const danger = token("--status-danger", "#f6747e"), spent = new THREE.Color(0x5d6873);
      const bombMaterial = own(new THREE.MeshLambertMaterial({ color: danger, emissive: danger, emissiveIntensity: 0.4 }));
      const pulseMaterial = own(new THREE.MeshBasicMaterial({ color: danger, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      const bomb = new THREE.Mesh(bombGeometry, bombMaterial), pulse = new THREE.Mesh(pulseGeometry, pulseMaterial);
      scene.add(bomb, pulse);
      const pointerMaterial = own(new THREE.MeshBasicMaterial({ color: 0xf5f8fb, transparent: true, depthWrite: false }));
      const pointerBeam = new THREE.Mesh(pointerGeometry, pointerMaterial), pointerRing = new THREE.Mesh(pulseGeometry, pointerMaterial);
      pointerRing.scale.setScalar(40 * U);
      const pointerMark = new THREE.Group().add(pointerBeam, pointerRing);
      pointerMark.visible = false;
      scene.add(pointerMark);

      // A few overlapping puffs read as a cloud; the layout follows the effect key so it never jumps.
      const smokeCloud = (key: string, material: THREE.Material) => {
        let seed = [...key].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) | 0, 7);
        const random = () => ((seed = (seed * 1103515245 + 12345) | 0) >>> 0) / 4294967296;
        const cloud = new THREE.Group();
        const puff = (x: number, y: number, z: number, radius: number) => {
          const mesh = new THREE.Mesh(smokeGeometry, material);
          mesh.position.set(x * U, y * U, z * U);
          mesh.scale.set(radius * U, radius * 0.85 * U, radius * U);
          mesh.renderOrder = 1;
          cloud.add(mesh);
        };
        puff(0, 60, 0, 92);
        for (let index = 0; index < 6; index++) {
          const angle = (index + random() * 0.6) * Math.PI / 3, distance = 58 + random() * 18;
          puff(Math.cos(angle) * distance, 34 + random() * 40, Math.sin(angle) * distance, 64 + random() * 16);
        }
        return cloud;
      };

      // Everything that belongs to one round; rebuilt when the player switches rounds.
      type Round = {
        replay: RoundReplay;
        loadouts: ReturnType<typeof loadoutsById>;
        effects: { effect: AreaEffect; mesh: THREE.Object3D; material: THREE.MeshLambertMaterial | THREE.MeshBasicMaterial }[];
        grenades: { path: RoundReplay["grenades"][number]; line: THREE.Line; head: THREE.Mesh; positions: Float32Array }[];
        group: THREE.Group;
        dispose(): void;
      };
      let round: Round | null = null;
      const buildRound = (replay: RoundReplay): Round => {
        const group = new THREE.Group(), disposables: { dispose(): void }[] = [];
        const effects = areaEffects(replay).map(effect => {
          const smoke = effect.kind === "smoke";
          const material = smoke
            ? new THREE.MeshLambertMaterial({ color: 0xbcc6cf, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide })
            : new THREE.MeshBasicMaterial({ color: token("--nade-molly", "#f58345"), transparent: true, opacity: 0.55, depthWrite: false });
          disposables.push(material);
          const mesh = smoke ? smokeCloud(effect.key, material) : new THREE.Mesh(fireGeometry, material);
          toScene(effect.x, effect.y, effect.z + (smoke ? 0 : 4), mesh.position);
          if (!smoke) mesh.scale.set(120 * U, 8 * U, 120 * U);
          mesh.visible = false;
          group.add(mesh);
          return { effect, mesh, material };
        });
        const grenades = replay.grenades.filter(path => path.points.length).map(path => {
          const positions = new Float32Array(path.points.length * 3 + 3);
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
          path.points.forEach((point, index) => toScene(point.x, point.y, point.z).toArray(positions, index * 3));
          const color = grenadeColor(path.kind);
          const lineMaterial = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
          const headMaterial = new THREE.MeshBasicMaterial({ color });
          disposables.push(geometry, lineMaterial, headMaterial);
          const line = new THREE.Line(geometry, lineMaterial), head = new THREE.Mesh(projectileGeometry, headMaterial);
          line.visible = head.visible = false;
          line.frustumCulled = false;
          group.add(line, head);
          return { path, line, head, positions };
        });
        scene.add(group);
        return { replay, loadouts: loadoutsById(replay), effects, grenades, group, dispose() { scene.remove(group); disposables.forEach(item => item.dispose()); } };
      };

      const position = new THREE.Vector3(), scratch = new THREE.Vector3();
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      let players: PlayerFrame[] = [];
      const update = (time: number) => {
        const { replay, focusId, xray } = live.current;
        if (round?.replay !== replay) { round?.dispose(); round = buildRound(replay); }
        players = frameAt(replay, time);
        const seen = new Set<string>();
        let carrier: string | undefined;
        for (const player of players) {
          seen.add(player.id);
          const actor = actorFor(player);
          toScene(player.x, player.y, player.z, actor.root.position);
          actor.root.rotation.y = THREE.MathUtils.degToRad(player.yaw);
          const crouch = 1 - 0.3 * (player.duck || 0);
          actor.body.scale.y = crouch;
          // Slightly larger than the body, so the X-ray copy never flickers against the visible model.
          actor.xrayBody.scale.set(1.08, crouch * 1.04, 1.08);
          actor.body.position.y = actor.xrayBody.position.y = 29 * U * crouch;
          actor.head.position.y = actor.xrayHead.position.y = (actor.alive ? eyeHeight(player) : 60) * U;
          actor.head.rotation.x = THREE.MathUtils.degToRad(player.pitch || 0);
          // The fallen body lies backwards from where the player stood.
          actor.pose.rotation.x = actor.alive ? 0 : -Math.PI / 2;
          actor.gaze.visible = actor.alive;
          actor.xray.visible = xray && actor.alive;
          actor.ring.visible = player.id === focusId;
          actor.root.visible = true;
          if (actor.alive && round.loadouts.size && loadoutSummary(loadoutAt(round.loadouts.get(player.id), time)?.items || []).bomb) carrier = player.id;
        }
        for (const [id, actor] of actors) if (!seen.has(id)) actor.root.visible = false;

        for (const { effect, mesh, material } of round.effects) {
          mesh.visible = time >= effect.start && time < effect.end;
          if (!mesh.visible) continue;
          // Smokes bloom over a second and thin out before they vanish.
          const fade = Math.min(1, (time - effect.start) / 1, (effect.end - time) / 1.5);
          if (effect.kind === "smoke") mesh.scale.setScalar(0.55 + 0.45 * Math.min(1, (time - effect.start) / 1.2));
          material.opacity = (effect.kind === "smoke" ? 0.85 : 0.55) * Math.max(0.15, fade);
        }
        for (const grenade of round.grenades) {
          const at = grenadeAt(grenade.path, time);
          const last = grenade.path.points.at(-1)!;
          const showing = !!at || (time > last.time && time <= last.time + 0.5);
          grenade.line.visible = showing;
          grenade.head.visible = !!at;
          if (!showing) continue;
          const index = at ? at.index : grenade.path.points.length - 1;
          if (at) {
            toScene(at.x, at.y, at.z, grenade.head.position);
            grenade.head.position.toArray(grenade.positions, (index + 1) * 3);
            grenade.line.geometry.setDrawRange(0, index + 2);
          } else grenade.line.geometry.setDrawRange(0, index + 1);
          grenade.line.geometry.attributes.position.needsUpdate = true;
        }

        const state = bombAt(replay, time, players, carrier);
        bomb.visible = !!state;
        pulse.visible = state?.kind === "planted";
        if (state?.kind === "carried") {
          const holder = actors.get(state.playerId)!;
          // On the carrier's back, like the backpack in game.
          bomb.position.copy(holder.root.position).add(scratch.set(0, 46 * U, 0)).addScaledVector(
            new THREE.Vector3(Math.sin(holder.root.rotation.y), 0, Math.cos(holder.root.rotation.y)), -15 * U);
          bomb.rotation.y = holder.root.rotation.y;
        } else if (state) {
          toScene(state.x, state.y, state.z + 2.5, bomb.position);
          pulse.position.copy(bomb.position);
        }
        if (state) bombMaterial.color.copy(state.kind === "defused" ? colors[3] : state.kind === "exploded" ? spent : danger);
      };

      // Camera. `free` is the flying camera; `current` is whatever was drawn last, so switching
      // from the ego view to flying starts exactly where the player stood.
      const current = { position: new THREE.Vector3(), yaw: 0, pitch: 0, set: false, ego: false };
      const free = { position: new THREE.Vector3(), yaw: 0, pitch: 0, set: false };
      let active: CameraMode = live.current.mode, seenMode = live.current.mode;
      const takeOver = () => {
        free.position.copy(current.position);
        free.yaw = current.yaw;
        free.pitch = current.pitch;
        free.set = current.set;
        // Leaving the ego view steps back over the shoulder instead of staying inside the player's head.
        if (current.ego) free.position.add(scratch.set(Math.sin(current.yaw), 0, Math.cos(current.yaw)).multiplyScalar(72 * U)).add(scratch.set(0, 14 * U, 0));
      };
      const overview = () => {
        const alive = players.filter(player => player.health > 0);
        const centre = new THREE.Vector3();
        for (const player of alive.length ? alive : players) centre.add(toScene(player.x, player.y, player.z, scratch));
        if (players.length) centre.divideScalar((alive.length || players.length));
        free.position.copy(centre).add(scratch.set(0, 1100 * U, 820 * U));
        free.yaw = 0;
        free.pitch = -Math.atan2(1100, 820);
        free.set = true;
      };
      const egoPlayer = () => {
        const { focusId } = live.current;
        return focusId ? players.find(player => player.id === focusId) : undefined;
      };
      let egoState = "";
      const placeCamera = () => {
        const target = active === "ego" ? egoPlayer() : undefined;
        if (target) {
          toScene(target.x, target.y, target.z + eyeHeight(target), current.position);
          current.yaw = THREE.MathUtils.degToRad(target.yaw) + Math.PI;
          current.pitch = -THREE.MathUtils.degToRad(target.pitch || 0);
          current.ego = true;
        } else {
          if (!free.set) current.set ? takeOver() : overview();
          current.position.copy(free.position);
          current.yaw = free.yaw;
          current.pitch = free.pitch;
          current.ego = false;
        }
        current.set = true;
        view.position.copy(current.position);
        view.rotation.set(current.pitch, current.yaw, 0);
        const scoped = !!target && target.health > 0 && !!target.scoped;
        const zoom = scoped ? SCOPE_ZOOM : 1;
        if (view.zoom !== zoom) { view.zoom = zoom; view.updateProjectionMatrix(); }
        const next = target && target.health > 0 ? `${scoped}:${scoped && SNIPER.test(target.weapon)}` : "";
        if (next !== egoState) { egoState = next; setEgo(target && target.health > 0 ? { scoped, sniper: scoped && SNIPER.test(target.weapon) } : null); }
        // Ego view hides the own model, which would otherwise fill the picture.
        for (const [id, actor] of actors) actor.pose.visible = !(target && id === target.id && actor.alive);
      };

      // Names follow the players on screen; with X-ray off they would give away hidden players.
      const placeLabels = () => {
        const { focusId, xray } = live.current;
        const { clientWidth, clientHeight } = canvas;
        const target = active === "ego" ? egoPlayer() : undefined;
        for (const [id, element] of labelRefs.current) {
          const actor = actors.get(id), player = players.find(entry => entry.id === id);
          const show = !!actor?.root.visible && !!player && player.health > 0 && id !== target?.id && (xray || id === focusId);
          if (show) {
            position.copy(actor.root.position).add(scratch.set(0, 78 * U * (1 - 0.25 * (player.duck || 0)), 0)).project(view);
            if (position.z > 1 || Math.abs(position.x) > 1.2 || Math.abs(position.y) > 1.2) { element.hidden = true; continue; }
            element.hidden = false;
            element.style.transform = `translate(${Math.round((position.x + 1) / 2 * clientWidth)}px, ${Math.round((1 - position.y) / 2 * clientHeight)}px)`;
            element.dataset.side = player.side === 2 ? "t" : "ct";
            element.dataset.focus = String(id === focusId);
            (element.lastElementChild!.firstElementChild as HTMLElement).style.width = `${Math.max(0, Math.min(100, player.health))}%`;
          } else element.hidden = true;
        }
      };

      // The pointer is set on the radar; find the floor at that spot for the matching level.
      const raycaster = new THREE.Raycaster();
      let pointerKey = "";
      const placePointer = () => {
        const { pointer, calibration } = live.current;
        const fresh = !!pointer && serverNow() - pointer.at < 5000 && !!calibration;
        if (!fresh) { pointerMark.visible = false; return false; }
        // Live sessions stamp the pointer on every render; only a new spot needs a new raycast.
        const key = `${pointer.x}:${pointer.y}:${pointer.level}`;
        if (key !== pointerKey) {
          pointerKey = key;
          const lower = pointer.level === "lower" && calibration.lower;
          const projection = lower ? calibration.lower : calibration;
          const x = (pointer.x - projection.xOffset) / projection.xScale, y = (pointer.y - projection.yOffset) / projection.yScale;
          raycaster.set(toScene(x, y, 20000), new THREE.Vector3(0, -1, 0));
          raycaster.far = Infinity;
          const split = calibration.altitudeSplit;
          const hit = raycaster.intersectObject(loaded.root, true).filter(opaque).find(({ point }) =>
            split === undefined || (lower ? point.y / U < split : point.y / U >= split));
          pointerMark.visible = !!hit;
          if (hit) pointerMark.position.copy(hit.point);
        }
        pointerMaterial.opacity = Math.max(0, 1 - (serverNow() - pointer.at) / 5000) * 0.9;
        return pointerMark.visible;
      };

      // Auto exposure like the game: measured now and then, followed smoothly.
      let exposure = 1, exposureTarget = 1, measured: { at: number; position: THREE.Vector3; yaw: number; pitch: number } | null = null;
      const adaptExposure = (now: number, dt: number) => {
        const moved = !measured || measured.position.distanceTo(current.position) > 2 || Math.abs(measured.yaw - current.yaw) + Math.abs(measured.pitch - current.pitch) > 0.3;
        if (moved && (!measured || now - measured.at > 600)) {
          exposureTarget = viewExposure(renderer, scene, view);
          if (!measured) exposure = exposureTarget;
          measured = { at: now, position: current.position.clone(), yaw: current.yaw, pitch: current.pitch };
        }
        exposure += (exposureTarget - exposure) * Math.min(1, dt * 2.5);
        renderer.toneMappingExposure = exposure;
        return Math.abs(exposureTarget - exposure) > 0.005;
      };

      const keys = new Set<string>();
      let fast = false, pace = 1, dirty = true, adapting = false, lastTime = NaN, lastNow = performance.now(), lastProps = "", frame = 0;
      const toFree = () => {
        if (active === "free") return;
        takeOver();
        active = "free";
        live.current.onModeChange("free");
      };
      const turn = (yaw: number, pitch: number) => {
        toFree();
        free.yaw += yaw;
        free.pitch = THREE.MathUtils.clamp(free.pitch + pitch, -1.55, 1.55);
        dirty = true;
      };
      const forward = new THREE.Vector3(), right = new THREE.Vector3(), upward = new THREE.Vector3(0, 1, 0);
      const fly = (dt: number) => {
        let x = 0, y = 0, z = 0;
        for (const key of keys) { const move = MOVE_KEYS[key]; if (move) { x += move[0]; y += move[1]; z += move[2]; } }
        if (!x && !y && !z) return false;
        const step = FLY_SPEED * pace * (fast ? 3 : 1) * dt;
        forward.set(0, 0, -1).applyEuler(new THREE.Euler(free.pitch, free.yaw, 0, "YXZ"));
        right.set(1, 0, 0).applyAxisAngle(upward, free.yaw);
        free.position.addScaledVector(forward, z * step).addScaledVector(right, x * step).addScaledVector(upward, y * step);
        return true;
      };

      const draw = (now: number) => {
        frame = requestAnimationFrame(draw);
        const dt = Math.min(0.1, (now - lastNow) / 1000);
        lastNow = now;
        const props = live.current;
        if (props.mode !== seenMode) {
          seenMode = props.mode;
          if (props.mode === "free" && active !== "free") takeOver();
          active = props.mode;
          dirty = true;
        }
        const key = `${props.focusId}|${props.xray}|${active}`;
        const time = props.clock.current();
        if (time !== lastTime || key !== lastProps || props.replay !== round?.replay) {
          lastTime = time;
          lastProps = key;
          update(time);
          dirty = true;
        }
        if (active === "free" && fly(dt)) dirty = true;
        const pointing = placePointer();
        const planted = pulse.visible && !reducedMotion;
        if (planted) {
          const phase = (now / 1000) % 1;
          pulse.scale.setScalar((20 + 60 * phase) * U);
          pulseMaterial.opacity = 0.9 * (1 - phase);
        }
        if (!dirty && !pointing && !planted && !adapting) return;
        dirty = false;
        placeCamera();
        view.updateMatrixWorld();
        adapting = adaptExposure(now, dt);
        renderer.render(scene, view);
        placeLabels();
      };

      const resize = () => {
        const { width, height } = stage.getBoundingClientRect();
        if (!width || !height) return;
        renderer.setSize(width, height, false);
        setUnit(height / 1080);
        view.aspect = width / height;
        view.updateProjectionMatrix();
        dirty = true;
      };
      const observer = new ResizeObserver(resize);
      observer.observe(stage);

      // A click captures the mouse like in game: moving it looks around, W A S D fly and Esc lets go.
      // While captured, a click acts on what the crosshair points at: a player gets the focus, for the
      // captain any other spot becomes the shared pointer. Touch and pen drag the picture instead.
      const isCaptured = () => document.pointerLockElement === canvas;
      let drag: { id: number; x: number; y: number; startX: number; startY: number } | null = null;
      const radiansPerPixel = () => THREE.MathUtils.degToRad(VERTICAL_FOV_DEGREES) / view.zoom / Math.max(1, canvas.clientHeight);
      const pick = (x: number, y: number) => {
        const { onFocus, onPoint, calibration } = live.current;
        raycaster.setFromCamera(new THREE.Vector2(x, y), view);
        raycaster.far = Infinity;
        const bodies = [...actors.values()].filter(actor => actor.root.visible && actor.alive && actor.pose.visible).map(actor => actor.body);
        const player = raycaster.intersectObjects(bodies, false)[0];
        if (player && onFocus) return onFocus(player.object.userData.id);
        if (!onPoint || !calibration) return;
        const hit = raycaster.intersectObject(loaded.root, true).find(opaque);
        if (!hit) return;
        const radar = worldToRadar(`${hit.point.z / U} ${hit.point.x / U} ${hit.point.y / U}`, calibration);
        if (radar) onPoint({ x: radar.x, y: radar.y, level: radar.level || "upper" });
      };
      const capture = async () => {
        toFree();
        dirty = true;
        // Raw mouse input where the browser offers it, so the view follows the mouse without acceleration.
        try { await canvas.requestPointerLock({ unadjustedMovement: true }); }
        catch { await Promise.resolve(canvas.requestPointerLock()).catch(() => {}); }
      };
      const down = (event: PointerEvent) => {
        if (event.button !== 0) return;
        canvas.focus({ preventScroll: true });
        if (isCaptured()) return pick(0, 0);
        if (event.pointerType === "mouse" && "requestPointerLock" in canvas) return void capture();
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY };
        canvas.setPointerCapture(event.pointerId);
      };
      const move = (event: PointerEvent) => {
        if (isCaptured()) {
          const speed = LOOK_SPEED / view.zoom;
          turn(-event.movementX * speed, -event.movementY * speed);
          return;
        }
        if (drag?.id !== event.pointerId) return;
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4 && active === "ego") return;
        const scale = radiansPerPixel();
        turn((event.clientX - drag.x) * scale, (event.clientY - drag.y) * scale);
        drag = { ...drag, x: event.clientX, y: event.clientY };
      };
      const up = (event: PointerEvent) => {
        if (drag?.id !== event.pointerId) return;
        const click = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4;
        drag = null;
        const box = canvas.getBoundingClientRect();
        if (click && event.type === "pointerup")
          pick((event.clientX - box.left) / box.width * 2 - 1, -(event.clientY - box.top) / box.height * 2 + 1);
      };
      // The mouse wheel sets the flying speed while the mouse is captured.
      let paceTimer = 0;
      const wheel = (event: WheelEvent) => {
        if (!isCaptured()) return;
        event.preventDefault();
        pace = THREE.MathUtils.clamp(pace * (event.deltaY < 0 ? 1.25 : 0.8), 0.25, 4);
        setPaceLabel(`Tempo ${pace.toLocaleString("de-AT", { maximumFractionDigits: 1 })}×`);
        clearTimeout(paceTimer);
        paceTimer = window.setTimeout(() => setPaceLabel(null), 1200);
      };
      const lockChanged = () => {
        const on = isCaptured();
        setCaptured(on);
        live.current.onCaptureChange?.(on);
        if (!on) stop();
        dirty = true;
      };
      const keyDown = (event: KeyboardEvent) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        // Browsers release the mouse on Esc themselves; this covers those that pass the key on.
        if (event.key === "Escape" && isCaptured()) return document.exitPointerLock();
        fast = event.shiftKey;
        const turns = TURN_KEYS[event.key];
        if (turns) {
          event.preventDefault();
          const step = THREE.MathUtils.degToRad(3) / view.zoom;
          turn(turns[0] * step, turns[1] * step);
        } else if (MOVE_KEYS[event.code]) {
          event.preventDefault();
          toFree();
          keys.add(event.code);
        }
      };
      const keyUp = (event: KeyboardEvent) => { fast = event.shiftKey; keys.delete(event.code); };
      const stop = () => { keys.clear(); fast = false; };
      const lost = (event: Event) => { event.preventDefault(); setPhase({ kind: "error", message: "Der Browser hat die 3D-Grafik zurückgesetzt. Lade die 3D-Ansicht erneut." }); };
      const listeners = [["pointerdown", down], ["pointermove", move], ["pointerup", up], ["pointercancel", up], ["keydown", keyDown], ["blur", stop], ["webglcontextlost", lost]] as const;
      for (const [type, listener] of listeners) canvas.addEventListener(type, listener as EventListener);
      canvas.addEventListener("wheel", wheel, { passive: false });
      document.addEventListener("pointerlockchange", lockChanged);
      window.addEventListener("keyup", keyUp);
      window.addEventListener("blur", stop);

      teardown = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        for (const [type, listener] of listeners) canvas.removeEventListener(type, listener as EventListener);
        canvas.removeEventListener("wheel", wheel);
        document.removeEventListener("pointerlockchange", lockChanged);
        if (isCaptured()) document.exitPointerLock();
        live.current.onCaptureChange?.(false);
        clearTimeout(paceTimer);
        window.removeEventListener("keyup", keyUp);
        window.removeEventListener("blur", stop);
        round?.dispose();
        for (const actor of actors.values()) scene.remove(actor.root);
        scene.remove(bomb, pulse, pointerMark);
        owned.forEach(item => item.dispose());
        mounted.dispose();
      };
      setPhase({ kind: "ready" });
      resize();
      frame = requestAnimationFrame(draw);
    })();
    return () => { disposed = true; teardown(); release(); };
  }, [mapName, attempt]);

  const ready = phase.kind === "ready";
  return <div ref={stageRef} className="demo-3d" aria-busy={phase.kind === "manifest" || phase.kind === "loading" || undefined}>
    <canvas ref={canvasRef} className="demo-3d-canvas" hidden={!ready} tabIndex={ready ? 0 : -1} role="img"
      aria-label={`3D-Ansicht von ${mapLabel}. Klicken fängt die Maus zum Umsehen, Escape gibt sie frei. Pfeiltasten zum Umsehen, W A S D zum Fliegen, E und Q für hoch und runter, Shift für schneller.`} />
    {ready && <div className="demo-3d-labels" aria-hidden="true">
      {roster.map((player, index) => <div key={player.id} hidden className="demo-3d-label"
        ref={element => { if (element) labelRefs.current.set(player.id, element); else labelRefs.current.delete(player.id); }}>
        <span><b>{index + 1}</b>{player.name}</span><i><s /></i>
      </div>)}
    </div>}
    {ready && ego && !ego.sniper && <div className="demo-3d-crosshair" aria-hidden="true"><CrosshairGlyph style="gap" unit={unit} /></div>}
    {ready && captured && !ego && <div className="demo-3d-crosshair" aria-hidden="true"><CrosshairGlyph style="fine" unit={unit} /></div>}
    {ready && !captured && <div className="demo-3d-enter" aria-hidden="true">{props.mode === "ego" ? "Klicken, um frei zu fliegen" : "Klicken, um die Kamera zu steuern"}</div>}
    {paceLabel && <div className="demo-3d-pace" role="status">{paceLabel}</div>}
    {ready && ego?.sniper && <div className="demo-3d-scope" aria-hidden="true" />}
    {(phase.kind === "manifest" || phase.kind === "loading") && <div className="demo-3d-status" role="status">
      <Spinner aria-hidden="true" />
      <p>{phase.kind === "loading" && phase.loaded >= phase.total ? "3D-Karte wird aufbereitet …" : `3D-Karte von ${mapLabel} wird geladen …`}</p>
      {phase.kind === "loading" && <><Progress value={Math.min(100, phase.loaded / Math.max(1, phase.total) * 100)} aria-label="Ladefortschritt" className="w-48" />
        <p className="font-mono text-xs tabular-nums text-muted-foreground">{megabytes(phase.loaded)} / {megabytes(phase.total)} MB</p></>}
      <p className="text-xs text-muted-foreground">Einmal pro Map, danach aus dem Browser-Cache.</p>
    </div>}
    {phase.kind === "missing" && <StageMessage title={`Noch keine 3D-Karte für ${mapLabel}`} description="Der Server erstellt sie automatisch aus den Spieldateien. Bis dahin zeigt die 2D-Ansicht die Runde." />}
    {phase.kind === "unsupported" && <StageMessage title="3D-Grafik nicht verfügbar" description="Dein Browser kann hier keine WebGL-Grafik darstellen. Aktiviere die Hardwarebeschleunigung in den Browser-Einstellungen oder nutze die 2D-Ansicht." />}
    {phase.kind === "error" && <StageMessage title="3D-Ansicht nicht geladen" description={phase.message}
      action={<Button variant="secondary" size="sm" onClick={() => setAttempt(value => value + 1)}><RefreshCw data-icon="inline-start" />Erneut versuchen</Button>} />}
  </div>;
}

function StageMessage({ title, description, action = null }: { title: string; description: string; action?: React.ReactNode }) {
  return <Empty className="demo-3d-status">
    <EmptyHeader><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader>
    {action && <EmptyContent className="flex-row flex-wrap justify-center">{action}</EmptyContent>}
  </Empty>;
}

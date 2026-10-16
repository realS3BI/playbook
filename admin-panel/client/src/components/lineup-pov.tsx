import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Crosshair, Play, RefreshCw } from "lucide-react";
import { lineupCamera, sourceToScene, VERTICAL_FOV_DEGREES } from "../../../shared/map-scene";
import { analyzeThrowMotion } from "../../../shared/throw-motion";
import { acquireMapScene, floorBelow, mountMapScene, viewExposure, type MapSceneInfo } from "../lib/map-scene";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { Kbd } from "./ui/kbd";
import { Progress } from "./ui/progress";
import { Spinner } from "./ui/spinner";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { CrosshairGlyph, CrosshairSwitch, GUIDE_STEP_DEGREES, GUIDE_TICKS, LineupGuide, useCrosshairStyle, type GuideAxis, type GuideGeometry } from "./lineup-crosshair";
import { planReplay, replayObjects, type ReplayFrame, type ReplayPlan } from "../lib/throw-replay";
import { ReplayBar, ReplayKeys, ReplayStatus } from "./throw-replay-controls";

type Phase =
  | { kind: "manifest" }
  | { kind: "loading"; loaded: number; total: number }
  | { kind: "ready"; lit: boolean }
  | { kind: "missing" }
  | { kind: "unsupported" }
  | { kind: "error"; message: string };
type Replay =
  | { status: "preparing" }
  | { status: "failed" }
  | { status: "ready"; time: number; end: number; playing: boolean; speed: number; frame: ReplayFrame; kind: string; source: string; timed: boolean };
type ReplayControls = { open(): void; toggle(): void; seek(time: number): void; restart(): void; speed(value: number): void; close(): void };
const NO_REPLAY: ReplayControls = { open() {}, toggle() {}, seek() {}, restart() {}, speed() {}, close() {} };

function flightSource(plan: NonNullable<ReplayPlan>) {
  if (plan.flight?.source === "recorded") return "Flugbahn im Spiel aufgezeichnet";
  if (plan.flight?.source === "direct") return "Vereinfachte Flugbahn: direkter Bogen vom Abwurf zum gemessenen Zielpunkt, ohne Abpraller";
  if (plan.flight) return `Flugbahn aus dem Abwurf nachgerechnet, endet ${plan.flight.error} Units neben dem gemessenen Ziel`;
  return plan.landing ? "Flugbahn nicht nachrechenbar, gezeigt wird nur der gemessene Zielpunkt" : "Kein Zielpunkt gespeichert";
}

const megabytes = (bytes: number) => (bytes / 1048576).toLocaleString("de-AT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export default function LineupPov({ nade: entry, mapName, mapLabel }: { nade: any; mapName: string; mapLabel: string }) {
  // Eye height follows the stance while aiming, which can differ from the stance when letting go.
  const setupCrouch = useMemo(() => entry.throwTrace ? analyzeThrowMotion(entry.throwTrace)?.setup.crouch : undefined, [entry.throwTrace]);
  const nade = useMemo(() => setupCrouch === undefined ? entry : { ...entry, is_crouch: setupCrouch }, [entry, setupCrouch]);
  const camera = lineupCamera(nade);
  const cameraKey = camera ? `${camera.eye.join()} ${camera.forward.join()}` : "";
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const crosshairRef = useRef<HTMLDivElement>(null);
  const resetRef = useRef<() => void>(() => {});
  const [phase, setPhase] = useState<Phase>({ kind: "manifest" });
  const [moved, setMoved] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [crosshair, setCrosshair] = useCrosshairStyle();
  // CSS pixels per pixel of a 1080p screen, so the crosshair keeps its in-game size relative to the picture.
  const [unit, setUnit] = useState(1);
  const [guide, setGuide] = useState<GuideGeometry | null>(null);
  const styleRef = useRef(crosshair);
  styleRef.current = crosshair;
  const redrawRef = useRef<() => void>(() => {});
  useEffect(() => redrawRef.current(), [crosshair]);
  const [replay, setReplay] = useState<Replay | null>(null);
  const replayRef = useRef<ReplayControls>(NO_REPLAY);
  const entryRef = useRef(entry);
  entryRef.current = entry;

  useEffect(() => {
    if (!camera) return;
    let disposed = false, release = () => {}, teardown = () => {};
    setPhase({ kind: "manifest" });
    setMoved(false);
    setReplay(null);
    (async () => {
      let info: MapSceneInfo;
      try { info = await api(`/api/map-scenes/${encodeURIComponent(mapName)}`); }
      catch (error) {
        if (!disposed) setPhase(error.status === 404 ? { kind: "missing" } : { kind: "error", message: "Die Abwurfsicht konnte nicht abgerufen werden. Prüfe deine Verbindung und versuche es erneut." });
        return;
      }
      if (disposed) return;
      const handle = acquireMapScene(info, (loaded, total) => { if (!disposed) setPhase(current => current.kind === "ready" ? current : { kind: "loading", loaded, total }); });
      release = handle.release;
      let loaded;
      try { loaded = await handle.promise; }
      catch {
        if (!disposed) setPhase({ kind: "error", message: `Die Abwurfsicht von ${mapLabel} konnte nicht geladen werden. Prüfe deine Verbindung und versuche es erneut.` });
        return;
      }
      if (disposed) return;
      let mounted: ReturnType<typeof mountMapScene>;
      try { mounted = mountMapScene(canvasRef.current!, loaded); }
      catch { setPhase({ kind: "unsupported" }); return; }
      const { renderer, scene } = mounted;

      const placed = lineupCamera(nade, floorBelow(loaded.root, camera.position))!;
      const view = new THREE.PerspectiveCamera(VERTICAL_FOV_DEGREES, 16 / 9, 0.05, 3000);
      view.rotation.order = "YXZ";
      view.position.set(...placed.eye);
      const forward = new THREE.Vector3(...placed.forward).normalize();
      const aimPoint = view.position.clone().addScaledVector(forward, 100);
      const home = { yaw: Math.atan2(-forward.x, -forward.z), pitch: Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1)) };
      const look = { ...home };
      const projected = new THREE.Vector3();
      // The lineup help measures angles from the throw direction in the camera frame of that direction, as on screen in CS2.
      const homeTurn = new THREE.Quaternion().setFromEuler(new THREE.Euler(home.pitch, home.yaw, 0, "YXZ"));
      const pitchAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(homeTurn), yawAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(homeTurn);
      const turned = new THREE.Vector3();
      const toScreen = (axis: THREE.Vector3, degrees: number): [number, number] | null => {
        const { clientWidth, clientHeight } = canvasRef.current!;
        turned.copy(forward).applyAxisAngle(axis, THREE.MathUtils.degToRad(degrees)).multiplyScalar(100).add(view.position).project(view);
        return turned.z < 1 ? [(turned.x + 1) / 2 * clientWidth, (1 - turned.y) / 2 * clientHeight] : null;
      };
      // Positive values point down and right; rotating the view direction by a positive angle turns it up or left.
      const guideAxis = (axis: THREE.Vector3): GuideAxis | null => {
        const origin = toScreen(axis, 0), next = toScreen(axis, -1);
        if (!origin || !next) return null;
        const length = Math.hypot(next[0] - origin[0], next[1] - origin[1]);
        if (!length) return null;
        return { origin, direction: [(next[0] - origin[0]) / length, (next[1] - origin[1]) / length],
          ticks: GUIDE_TICKS.flatMap(value => { const at = toScreen(axis, -value * GUIDE_STEP_DEGREES); return at ? [{ value, at }] : []; }) };
      };
      let frame = 0;
      // Replay of the recorded throw: inputs in first person, then the camera follows the grenade.
      let replayed: { plan: NonNullable<ReplayPlan>; objects: ReturnType<typeof replayObjects> } | null = null;
      const playback = { active: false, playing: false, time: 0, speed: 1, last: 0 };
      const abort = { aborted: false };
      const replayState = () => {
        if (!replayed) return;
        const { plan } = replayed;
        setReplay({ status: "ready", time: playback.time, end: plan.end, playing: playback.playing, speed: playback.speed,
          frame: plan.frame(playback.time), kind: plan.kind, source: flightSource(plan), timed: Boolean(plan.flight) });
      };
      const draw = (now = performance.now()) => {
        frame = 0;
        if (playback.active && replayed) {
          if (playback.playing) {
            playback.time = Math.min(replayed.plan.end, playback.time + Math.min(0.1, (now - playback.last) / 1000) * playback.speed);
            playback.last = now;
            if (playback.time >= replayed.plan.end) playback.playing = false;
          }
          const pose = replayed.plan.camera(playback.time);
          if (pose) {
            view.position.set(...sourceToScene(pose.eye));
            view.lookAt(...sourceToScene(pose.target));
          }
          view.updateMatrixWorld();
          replayed.objects.update(playback.time);
          renderer.render(scene, view);
          if (crosshairRef.current) crosshairRef.current.hidden = true;
          setGuide(null);
          replayState();
          if (playback.playing) render();
          return;
        }
        view.position.set(...placed.eye);
        view.rotation.set(look.pitch, look.yaw, 0);
        view.updateMatrixWorld();
        renderer.render(scene, view);
        // The crosshair stays on the aim point while looking around.
        const marker = crosshairRef.current, canvas = canvasRef.current!;
        if (!marker) return;
        projected.copy(aimPoint).project(view);
        const visible = projected.z < 1 && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1;
        marker.hidden = !visible;
        const ratio = window.devicePixelRatio || 1, snap = (value: number) => Math.round(value * ratio) / ratio;
        if (visible) marker.style.transform = `translate(${snap((projected.x + 1) / 2 * canvas.clientWidth)}px, ${snap((1 - projected.y) / 2 * canvas.clientHeight)}px)`;
        if (styleRef.current !== "lineup" || projected.z >= 1) { setGuide(null); return; }
        setGuide({ vertical: guideAxis(pitchAxis), horizontal: guideAxis(yawAxis) });
      };
      const render = () => { frame ||= requestAnimationFrame(draw); };
      const turn = (yaw: number, pitch: number) => {
        look.yaw += yaw;
        look.pitch = THREE.MathUtils.clamp(look.pitch + pitch, -1.55, 1.55);
        setMoved(true);
        render();
      };
      resetRef.current = () => { Object.assign(look, home); setMoved(false); render(); };
      redrawRef.current = render;
      const play = (from?: number) => {
        if (from !== undefined) playback.time = from;
        playback.playing = true;
        playback.last = performance.now();
        render();
      };
      replayRef.current = {
        async open() {
          if (playback.active) return;
          zoom(false);
          if (!replayed) {
            setReplay({ status: "preparing" });
            let plan: ReplayPlan = null;
            try { plan = await planReplay(entryRef.current, loaded.root, abort); }
            catch { plan = null; }
            if (disposed || abort.aborted) return;
            if (!plan?.camera(0)) { setReplay({ status: "failed" }); return; }
            const { clientWidth, clientHeight } = canvasRef.current!;
            replayed = { plan, objects: replayObjects(plan, new THREE.Vector2(clientWidth, clientHeight), renderer.toneMappingExposure) };
            scene.add(replayed.objects.group);
          }
          playback.active = true;
          play(0);
        },
        toggle() { if (!playback.active || !replayed) return; if (playback.playing) { playback.playing = false; render(); } else play(playback.time >= replayed.plan.end ? 0 : undefined); },
        seek(time) { if (!playback.active || !replayed) return; playback.time = THREE.MathUtils.clamp(time, 0, replayed.plan.end); render(); },
        restart() { if (playback.active) play(0); },
        speed(value) { playback.speed = value; replayState(); },
        close() {
          playback.active = playback.playing = false;
          replayed?.objects.update(-1);
          setReplay(null);
          render();
        },
      };

      const canvas = canvasRef.current!, stage = stageRef.current!;
      const resize = () => {
        const { width, height } = stage.getBoundingClientRect();
        if (!width || !height) return;
        renderer.setSize(width, height, false);
        replayed?.objects.resize(width, height);
        setUnit(height / 1080);
        view.aspect = width / height;
        view.updateProjectionMatrix();
        render();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(stage);
      // Dragging moves the picture with the pointer, like a photo sphere.
      let drag: { id: number; x: number; y: number } | null = null;
      const radiansPerPixel = () => THREE.MathUtils.degToRad(VERTICAL_FOV_DEGREES) / view.zoom / Math.max(1, canvas.clientHeight);
      const down = (event: PointerEvent) => { drag = { id: event.pointerId, x: event.clientX, y: event.clientY }; canvas.setPointerCapture(event.pointerId); };
      const move = (event: PointerEvent) => {
        if (drag?.id !== event.pointerId || playback.active) return;
        const scale = radiansPerPixel();
        turn((event.clientX - drag.x) * scale, (event.clientY - drag.y) * scale);
        drag = { ...drag, x: event.clientX, y: event.clientY };
      };
      const up = (event: PointerEvent) => { if (drag?.id === event.pointerId) drag = null; };
      const key = (event: KeyboardEvent) => {
        if (playback.active) {
          const seek = { ArrowLeft: -0.5, ArrowRight: 0.5 }[event.key];
          if (seek) { event.preventDefault(); replayRef.current.seek(playback.time + seek); }
          else if (event.key === " " || event.key.toLowerCase() === "k") { event.preventDefault(); replayRef.current.toggle(); }
          else if (event.key === "Escape") { event.preventDefault(); replayRef.current.close(); }
          return;
        }
        const step = THREE.MathUtils.degToRad(3) / view.zoom;
        const turns = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[event.key];
        if (turns) { event.preventDefault(); turn(turns[0], turns[1]); }
        else if (event.key === "Home") { event.preventDefault(); resetRef.current(); }
      };
      // Holding Shift magnifies the view three times, like the crosshair zoom of the review photos.
      const zoom = (on: boolean) => {
        if ((view.zoom > 1) === on || on && playback.active) return;
        view.zoom = on ? 3 : 1;
        view.updateProjectionMatrix();
        setZoomed(on);
        render();
      };
      const shiftDown = (event: KeyboardEvent) => {
        if (event.key === "Shift" && !(event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable=true]"))) zoom(true);
      };
      const shiftUp = (event: KeyboardEvent) => { if (event.key === "Shift") zoom(false); };
      const unzoom = () => zoom(false);
      const lost = (event: Event) => { event.preventDefault(); setPhase({ kind: "error", message: "Der Browser hat die 3D-Grafik zurückgesetzt. Lade die Abwurfsicht erneut." }); };
      canvas.addEventListener("pointerdown", down);
      canvas.addEventListener("pointermove", move);
      canvas.addEventListener("pointerup", up);
      canvas.addEventListener("pointercancel", up);
      canvas.addEventListener("keydown", key);
      canvas.addEventListener("webglcontextlost", lost);
      window.addEventListener("keydown", shiftDown);
      window.addEventListener("keyup", shiftUp);
      window.addEventListener("blur", unzoom);
      teardown = () => {
        abort.aborted = true;
        replayed?.objects.dispose();
        replayRef.current = NO_REPLAY;
        cancelAnimationFrame(frame);
        observer.disconnect();
        window.removeEventListener("keydown", shiftDown);
        window.removeEventListener("keyup", shiftUp);
        window.removeEventListener("blur", unzoom);
        for (const [type, listener] of [["pointerdown", down], ["pointermove", move], ["pointerup", up], ["pointercancel", up], ["keydown", key], ["webglcontextlost", lost]] as const)
          canvas.removeEventListener(type, listener as EventListener);
        mounted.dispose();
        resetRef.current = () => {};
        redrawRef.current = () => {};
      };
      view.rotation.set(home.pitch, home.yaw, 0);
      view.updateMatrixWorld();
      renderer.toneMappingExposure = viewExposure(renderer, scene, view);
      setPhase({ kind: "ready", lit: loaded.lit });
      resize();
    })();
    return () => { disposed = true; teardown(); release(); };
  }, [mapName, cameraKey, attempt]);

  if (!camera) return <PovMessage title="Keine Abwurfsicht möglich" description="Für diese Aufnahme fehlen Startkoordinaten oder Blickwinkel." />;
  const ready = phase.kind === "ready";
  const replaying = replay?.status === "ready" ? replay : null;
  const replayable = Boolean(entry.throwTrace || entry.landingPos);
  return <div className="lineup-pov">
    <div ref={stageRef} className="lineup-pov-stage" aria-busy={phase.kind === "manifest" || phase.kind === "loading" || undefined}>
      <canvas ref={canvasRef} className="lineup-pov-canvas" hidden={!ready} tabIndex={ready ? 0 : -1} role="img"
        aria-label={`Abwurfsicht auf ${mapLabel}. Pfeiltasten zum Umsehen, Shift halten zum Zoomen, Pos1 für die Wurfrichtung.`} />
      {ready && !replaying && guide && <div className="lineup-guide" aria-hidden="true"><LineupGuide geometry={guide} unit={unit} /></div>}
      {ready && <div ref={crosshairRef} className="lineup-pov-crosshair" aria-hidden="true" hidden={Boolean(replaying)}><CrosshairGlyph style={crosshair} unit={unit} /></div>}
      {ready && !replaying && <CrosshairSwitch value={crosshair} onChange={setCrosshair} />}
      {replaying && <ReplayStatus frame={replaying.frame} kind={replaying.kind} source={replaying.source} timed={replaying.timed} measured={entry.flightDuration} />}
      {replaying && replaying.frame.phase !== "flight" && replaying.frame.phase !== "effect" && <ReplayKeys buttons={replaying.frame.buttons} />}
      {(phase.kind === "manifest" || phase.kind === "loading") && <div className="lineup-pov-status" role="status">
        <Spinner aria-hidden="true" />
        <p>{phase.kind === "loading" && phase.loaded >= phase.total ? "Abwurfsicht wird aufbereitet …" : `Abwurfsicht von ${mapLabel} wird geladen …`}</p>
        {phase.kind === "loading" && <><Progress value={Math.min(100, phase.loaded / Math.max(1, phase.total) * 100)} aria-label="Ladefortschritt" className="w-48" />
          <p className="font-mono text-xs tabular-nums text-muted-foreground">{megabytes(phase.loaded)} / {megabytes(phase.total)} MB</p></>}
        <p className="text-xs text-muted-foreground">Einmal pro Map, danach aus dem Browser-Cache.</p>
      </div>}
      {phase.kind === "missing" && <PovMessage inside title={`Noch keine Abwurfsicht für ${mapLabel}`} description="Der Server erstellt sie automatisch aus den Spieldateien. Nach einer neuen Map oder einem Map-Update dauert das einige Minuten." />}
      {phase.kind === "unsupported" && <PovMessage inside title="3D-Grafik nicht verfügbar" description="Dein Browser kann hier keine WebGL-Grafik darstellen. Aktiviere die Hardwarebeschleunigung in den Browser-Einstellungen." />}
      {phase.kind === "error" && <PovMessage inside title="Abwurfsicht nicht geladen" description={phase.message}
        action={<Button variant="secondary" size="sm" onClick={() => setAttempt(value => value + 1)}><RefreshCw data-icon="inline-start" />Erneut versuchen</Button>} />}
    </div>
    {ready && replaying && <div className="lineup-pov-caption">
      <ReplayBar time={replaying.time} end={replaying.end} playing={replaying.playing} speed={replaying.speed}
        onToggle={() => replayRef.current.toggle()} onSeek={time => replayRef.current.seek(time)} onRestart={() => replayRef.current.restart()}
        onSpeed={value => replayRef.current.speed(value)} onClose={() => replayRef.current.close()} />
    </div>}
    {ready && !replaying && <div className="lineup-pov-caption">
      <p className="text-xs text-muted-foreground" role={replay?.status === "failed" ? "alert" : undefined}>
        {replay?.status === "failed" ? "Die Wiedergabe konnte für diese Aufnahme nicht vorbereitet werden. Es fehlen Startposition oder Wurfdaten."
          : <>Aus Kartendaten rekonstruiert, ohne Smokes, Spieler und Kabel{phase.lit ? "" : " und ohne vorberechnetes Licht"}. Ziehen oder Pfeiltasten zum Umsehen, <Kbd>Shift</Kbd> halten zum Zoomen.{zoomed && " · Fadenkreuz-Zoom"}</>}
      </p>
      <div className="lineup-pov-actions">
        <Button variant="secondary" size="sm" disabled={!moved} onClick={() => resetRef.current()}><Crosshair data-icon="inline-start" />Zur Wurfrichtung</Button>
        {replayable && <Button size="sm" disabled={replay?.status === "preparing"} aria-busy={replay?.status === "preparing" || undefined} onClick={() => replayRef.current.open()}>
          {replay?.status === "preparing" ? <><Spinner data-icon="inline-start" />Wurf wird vorbereitet …</> : <><Play data-icon="inline-start" />Wurf abspielen</>}
        </Button>}
      </div>
    </div>}
  </div>;
}

function PovMessage({ title, description, action = null, inside = false }: { title: string; description: string; action?: React.ReactNode; inside?: boolean }) {
  return <Empty className={inside ? "lineup-pov-status" : "lineup-pov-stage"}>
    <EmptyHeader><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader>
    {action && <EmptyContent className="flex-row flex-wrap justify-center">{action}</EmptyContent>}
  </Empty>;
}

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Crosshair, Map as MapIcon, RefreshCw } from "lucide-react";
import { lineupCamera, VERTICAL_FOV_DEGREES } from "../../../shared/map-scene";
import { acquireMapScene, createSky, floorBelow, viewExposure, type MapSceneInfo } from "../lib/map-scene";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { Kbd } from "./ui/kbd";
import { Progress } from "./ui/progress";
import { Spinner } from "./ui/spinner";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";

type Phase =
  | { kind: "manifest" }
  | { kind: "loading"; loaded: number; total: number }
  | { kind: "ready"; lit: boolean }
  | { kind: "missing" }
  | { kind: "unsupported" }
  | { kind: "error"; message: string };

const megabytes = (bytes: number) => (bytes / 1048576).toLocaleString("de-AT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export default function LineupPov({ nade, mapName, mapLabel, onShowMap }: { nade: any; mapName: string; mapLabel: string; onShowMap?: () => void }) {
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

  useEffect(() => {
    if (!camera) return;
    let disposed = false, release = () => {}, teardown = () => {};
    setPhase({ kind: "manifest" });
    setMoved(false);
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
      let renderer: THREE.WebGLRenderer;
      try { renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current!, antialias: true, powerPreference: "high-performance" }); }
      catch { setPhase({ kind: "unsupported" }); return; }
      renderer.toneMapping = THREE.NeutralToneMapping;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      const sky = createSky();
      const scene = new THREE.Scene();
      scene.background = sky;
      scene.add(new THREE.HemisphereLight(0xdde8ff, 0x8a7560, 1.1));
      const sun = new THREE.DirectionalLight(loaded.sunColor, 1.4);
      sun.position.copy(loaded.sunDirection).multiplyScalar(-1);
      scene.add(sun, loaded.root);

      const placed = lineupCamera(nade, floorBelow(loaded.root, camera.position))!;
      const view = new THREE.PerspectiveCamera(VERTICAL_FOV_DEGREES, 16 / 9, 0.05, 3000);
      view.rotation.order = "YXZ";
      view.position.set(...placed.eye);
      const forward = new THREE.Vector3(...placed.forward).normalize();
      const aimPoint = view.position.clone().addScaledVector(forward, 100);
      const home = { yaw: Math.atan2(-forward.x, -forward.z), pitch: Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1)) };
      const look = { ...home };
      const projected = new THREE.Vector3();
      let frame = 0;
      const draw = () => {
        frame = 0;
        view.rotation.set(look.pitch, look.yaw, 0);
        view.updateMatrixWorld();
        renderer.render(scene, view);
        // The crosshair stays on the aim point while looking around.
        const marker = crosshairRef.current, canvas = canvasRef.current!;
        if (!marker) return;
        projected.copy(aimPoint).project(view);
        const visible = projected.z < 1 && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1;
        marker.hidden = !visible;
        if (visible) marker.style.transform = `translate(${(projected.x + 1) / 2 * canvas.clientWidth}px, ${(1 - projected.y) / 2 * canvas.clientHeight}px)`;
      };
      const render = () => { frame ||= requestAnimationFrame(draw); };
      const turn = (yaw: number, pitch: number) => {
        look.yaw += yaw;
        look.pitch = THREE.MathUtils.clamp(look.pitch + pitch, -1.55, 1.55);
        setMoved(true);
        render();
      };
      resetRef.current = () => { Object.assign(look, home); setMoved(false); render(); };

      const canvas = canvasRef.current!, stage = stageRef.current!;
      const resize = () => {
        const { width, height } = stage.getBoundingClientRect();
        if (!width || !height) return;
        renderer.setSize(width, height, false);
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
        if (drag?.id !== event.pointerId) return;
        const scale = radiansPerPixel();
        turn((event.clientX - drag.x) * scale, (event.clientY - drag.y) * scale);
        drag = { ...drag, x: event.clientX, y: event.clientY };
      };
      const up = (event: PointerEvent) => { if (drag?.id === event.pointerId) drag = null; };
      const key = (event: KeyboardEvent) => {
        const step = THREE.MathUtils.degToRad(3) / view.zoom;
        const turns = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[event.key];
        if (turns) { event.preventDefault(); turn(turns[0], turns[1]); }
        else if (event.key === "Home") { event.preventDefault(); resetRef.current(); }
      };
      // Holding Shift magnifies the view three times, like the crosshair zoom of the review photos.
      const zoom = (on: boolean) => {
        if ((view.zoom > 1) === on) return;
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
        cancelAnimationFrame(frame);
        observer.disconnect();
        window.removeEventListener("keydown", shiftDown);
        window.removeEventListener("keyup", shiftUp);
        window.removeEventListener("blur", unzoom);
        for (const [type, listener] of [["pointerdown", down], ["pointermove", move], ["pointerup", up], ["pointercancel", up], ["keydown", key], ["webglcontextlost", lost]] as const)
          canvas.removeEventListener(type, listener as EventListener);
        scene.remove(loaded.root);
        sky.dispose();
        renderer.dispose();
        resetRef.current = () => {};
      };
      view.rotation.set(home.pitch, home.yaw, 0);
      view.updateMatrixWorld();
      renderer.toneMappingExposure = viewExposure(renderer, scene, view);
      setPhase({ kind: "ready", lit: loaded.lit });
      resize();
    })();
    return () => { disposed = true; teardown(); release(); };
  }, [mapName, cameraKey, attempt]);

  if (!camera) return <PovMessage title="Keine Abwurfsicht möglich" description="Für diese Aufnahme fehlen Startkoordinaten oder Blickwinkel." onShowMap={onShowMap} />;
  const ready = phase.kind === "ready";
  return <div className="lineup-pov">
    <div ref={stageRef} className="lineup-pov-stage" aria-busy={phase.kind === "manifest" || phase.kind === "loading" || undefined}>
      <canvas ref={canvasRef} className="lineup-pov-canvas" hidden={!ready} tabIndex={ready ? 0 : -1} role="img"
        aria-label={`Abwurfsicht auf ${mapLabel}. Pfeiltasten zum Umsehen, Shift halten zum Zoomen, Pos1 für die Wurfrichtung.`} />
      {ready && <div ref={crosshairRef} className="lineup-pov-crosshair" aria-hidden="true"><svg viewBox="-12 -12 24 24">
        {/* The game's static crosshair: light strokes with a dark outline, with a gap at the aim point. */}
        <path d="M0 -10V-4M0 4V10M-10 0H-4M4 0H10" stroke="var(--surface-0)" strokeWidth="4" />
        <path d="M0 -10V-4M0 4V10M-10 0H-4M4 0H10" stroke="var(--text-strong)" strokeWidth="2" />
      </svg></div>}
      {(phase.kind === "manifest" || phase.kind === "loading") && <div className="lineup-pov-status" role="status">
        <Spinner aria-hidden="true" />
        <p>{phase.kind === "loading" && phase.loaded >= phase.total ? "Abwurfsicht wird aufbereitet …" : `Abwurfsicht von ${mapLabel} wird geladen …`}</p>
        {phase.kind === "loading" && <><Progress value={Math.min(100, phase.loaded / Math.max(1, phase.total) * 100)} aria-label="Ladefortschritt" className="w-48" />
          <p className="font-mono text-xs tabular-nums text-muted-foreground">{megabytes(phase.loaded)} / {megabytes(phase.total)} MB</p></>}
        <p className="text-xs text-muted-foreground">Einmal pro Map, danach aus dem Browser-Cache.</p>
      </div>}
      {phase.kind === "missing" && <PovMessage inside title={`Noch keine Abwurfsicht für ${mapLabel}`} description="Der Server erstellt sie automatisch aus den Spieldateien. Nach einer neuen Map oder einem Map-Update dauert das einige Minuten." onShowMap={onShowMap} />}
      {phase.kind === "unsupported" && <PovMessage inside title="3D-Grafik nicht verfügbar" description="Dein Browser kann hier keine WebGL-Grafik darstellen. Aktiviere die Hardwarebeschleunigung oder nutze die Karte." onShowMap={onShowMap} />}
      {phase.kind === "error" && <PovMessage inside title="Abwurfsicht nicht geladen" description={phase.message} onShowMap={onShowMap}
        action={<Button variant="secondary" size="sm" onClick={() => setAttempt(value => value + 1)}><RefreshCw data-icon="inline-start" />Erneut versuchen</Button>} />}
    </div>
    {ready && <div className="lineup-pov-caption">
      <p className="text-xs text-muted-foreground">Aus Kartendaten rekonstruiert, ohne Smokes, Spieler und Kabel{phase.lit ? "" : " und ohne vorberechnetes Licht"}. Ziehen oder Pfeiltasten zum Umsehen, <Kbd>Shift</Kbd> halten zum Zoomen.{zoomed && " · Fadenkreuz-Zoom"}</p>
      <Button variant="secondary" size="sm" disabled={!moved} onClick={() => resetRef.current()}><Crosshair data-icon="inline-start" />Zur Wurfrichtung</Button>
    </div>}
  </div>;
}

function PovMessage({ title, description, onShowMap, action = null, inside = false }: { title: string; description: string; onShowMap?: () => void; action?: React.ReactNode; inside?: boolean }) {
  return <Empty className={inside ? "lineup-pov-status" : "lineup-pov-stage"}>
    <EmptyHeader><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader>
    <EmptyContent className="flex-row flex-wrap justify-center">{action}{onShowMap && <Button variant="ghost" size="sm" onClick={onShowMap}><MapIcon data-icon="inline-start" />Karte anzeigen</Button>}</EmptyContent>
  </Empty>;
}

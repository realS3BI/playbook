import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Bomb,
  Eye,
  Maximize,
  Minimize,
  Move3d,
  Pause,
  Play,
  RotateCcw,
  ScanEye,
  Scissors,
  Shield,
  ShieldCheck,
  SkipBack,
  SkipForward,
  UsersRound,
} from "lucide-react";
import { api } from "@/lib/api";
import { serverNow } from "@/lib/live";
import { inferRadarCalibration, worldToRadar } from "@/lib/nade-radar";
import { radarPointVisible, type RadarLevel } from "@/lib/radar-layout";
import type { MapDefinition } from "@/lib/maps";
import {
  loadoutSummary,
  playbackTime,
  roundClock,
  roundEnd,
  roundStart,
  type PlayerLoadout,
  type RoundPhase,
  type Demo,
  type Playback,
  type RoundReplay,
  type SceneReference,
  weaponLabel,
} from "../../../shared/demos";
import { areaEffects, bombAt, frameAt, loadoutAt, loadoutsById } from "../../../shared/demo-replay";
import { useStoredChoice } from "@/lib/stored-choice";
import type { CameraMode } from "./demo-stage-3d";
import { Button } from "./ui/button";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle, EmptyDescription } from "./ui/empty";
import { Kbd } from "./ui/kbd";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Skeleton } from "./ui/skeleton";
import { Spinner } from "./ui/spinner";
import { RadarBackground } from "./radar-background";
import { RadarLevelSwitch } from "./radar-level-switch";
import { Choice, Feedback } from "./workspace-ui";
import { GrenadeIcon } from "./nade-icons";
import { economyOptions } from "../../../shared/strats";

// Three.js and the map scene load only when someone opens the 3D view.
const DemoStage3d = lazy(() => import("./demo-stage-3d"));

export const demoTime = (seconds: number) => {
  const value = Math.abs(seconds);
  return `${seconds < 0 ? "−" : ""}${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
};
// Countdowns round up like the in-game clock.
const countdown = (seconds: number) => demoTime(Math.ceil(Math.max(0, seconds) - 0.001));
export const phaseLabels: Record<RoundPhase, string> = {
  buy: "Kaufphase",
  live: "Runde",
  planted: "Bombe gelegt",
  over: "Rundenende",
};
export const buyLabel = (value?: string) =>
  economyOptions.find((option) => option.value === value)?.label;
const money = (value: number) => `$${value.toLocaleString("de-AT")}`;
const kindLabel = (kind: string) =>
  ({
    player_death: "Kill",
    smokegrenade_detonate: "Smoke",
    smokegrenade_expired: "Smoke endet",
    inferno_startburn: "Molotov",
    inferno_expire: "Feuer endet",
    flashbang_detonate: "Flash",
    hegrenade_detonate: "HE",
    bomb_planted: "Bombe gelegt",
    bomb_defused: "Bombe entschärft",
    bomb_exploded: "Bombe explodiert",
    bomb_dropped: "Bombe fallen gelassen",
    bomb_pickup: "Bombe aufgenommen",
  })[kind] || kind;

const eventTone = (kind: string) =>
  kind === "player_death" ? "kill" : kind.startsWith("bomb_") ? "bomb" : "utility";

export function DemoPlayer({
  scene,
  maps,
  playback,
  onPlayback,
  onReady,
  onPosition,
  pointer,
  onPoint,
  disabled = false,
  compact = false,
  theater,
}: {
  scene: SceneReference;
  maps: MapDefinition[];
  playback?: Playback;
  onPlayback?: (
    value: Pick<Playback, "time" | "playing" | "speed" | "focusId">,
  ) => void;
  onReady?: (ready: boolean) => void;
  onPosition?: (time: number, focusId: string) => void;
  pointer?: { x: number; y: number; level: string; at: number } | null;
  onPoint?: (point: { x: number; y: number; level: string }) => void;
  disabled?: boolean;
  compact?: boolean;
  /** Fills the page: stage edge to edge, the page's own header and round strip float over it with every control. */
  theater?: { header: ReactNode; rounds?: ReactNode };
}) {
  const [data, setData] = useState<{ demo: Demo; replay: RoundReplay } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [local, setLocal] = useState<Playback>({
    sceneIndex: 0,
    time: scene.start,
    anchoredAt: serverNow(),
    playing: false,
    speed: 1,
    focusId: scene.focusId,
  });
  const [now, setNow] = useState(serverNow());
  const [scrub, setScrub] = useState<number | null>(null);
  const [level, setLevel] = useState<RadarLevel>("upper");
  const callbacks = useRef({ onReady, onPosition });
  callbacks.current = { onReady, onPosition };
  const state = playback || local;
  const time = scrub ?? playbackTime(state, scene, now);
  // View choices are personal: in a shared review everyone keeps their own view of the captain's playback.
  const [view, setView] = useStoredChoice("playbook.demoView", ["2d", "3d"], "2d");
  const [camera, setCamera] = useStoredChoice<CameraMode>("playbook.demoCamera", ["ego", "free"], "ego");
  const [xray, setXray] = useStoredChoice("playbook.demoXray", ["on", "off"], "on");
  const [teams, setTeams] = useStoredChoice("playbook.demoTeams", ["on", "off"], "on");
  // The 3D view reads the time on every animation frame instead of waiting for the next render.
  const timeSource = useRef(() => time);
  timeSource.current = () => scrub ?? playbackTime(state, scene, serverNow());
  // The whole document goes fullscreen and the player covers it, so menus and dialogs opened from it stay visible.
  const [fullscreen, setFullscreen] = useState(false);
  const fullscreenRef = useRef(false);
  const togglePlayback = useRef<(() => void) | null>(null);
  fullscreenRef.current = fullscreen;
  const [flying, setFlying] = useState(false);
  // Pressing Ctrl on its own lays the minimap over the 3D view at full size; another press or Esc shrinks it.
  // Ctrl together with another key or a click stays a shortcut and leaves the radar alone.
  const [largeRadar, setLargeRadar] = useState(false);
  const radarAvailable = useRef(false);
  useEffect(() => {
    let armed = false;
    const down = (event: KeyboardEvent) => {
      armed = event.key === "Control" && !event.repeat && !event.shiftKey && !event.altKey && !event.metaKey;
      if (event.key === "Escape") setLargeRadar(false);
    };
    const up = (event: KeyboardEvent) => {
      if (event.key !== "Control" || !armed) return;
      armed = false;
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement);
      if (radarAvailable.current && !typing) setLargeRadar((large) => !large);
    };
    const cancel = () => {
      armed = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("pointerdown", cancel);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("pointerdown", cancel);
      window.removeEventListener("blur", cancel);
    };
  }, []);
  useEffect(() => {
    const update = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    document.addEventListener("fullscreenchange", update);
    return () => {
      document.removeEventListener("fullscreenchange", update);
      if (fullscreenRef.current && document.fullscreenElement)
        void document.exitFullscreen().catch(() => {});
    };
  }, []);
  // In the theater, Space always starts and stops playback, wherever the focus is,
  // except while typing or inside an open menu or dialog.
  const theaterOn = !!theater;
  useEffect(() => {
    if (!theaterOn) return;
    let handled = false;
    const keeps = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLInputElement && target.type !== "range") ||
        !!target.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'));
    const down = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.ctrlKey || event.metaKey || event.altKey || keeps(event.target)) return;
      // Also keeps a focused button or round from being clicked again.
      event.preventDefault();
      event.stopPropagation();
      handled = true;
      if (!event.repeat) togglePlayback.current?.();
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== "Space" || !handled) return;
      handled = false;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
    };
  }, [theaterOn]);
  useEffect(() => {
    let animation: number;
    let last = 0;
    const tick = (clock: number) => {
      if (clock - last >= 32) {
        setNow(serverNow());
        last = clock;
      }
      animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animation);
  }, []);
  useEffect(() => {
    callbacks.current.onPosition?.(time, state.focusId);
  }, [time, state.focusId]);
  useEffect(() => {
    setLocal({
      sceneIndex: 0,
      time: scene.start,
      anchoredAt: serverNow(),
      playing: false,
      speed: 1,
      focusId: scene.focusId,
    });
    setScrub(null);
  }, [scene.demoId, scene.roundId, scene.start, scene.end, scene.focusId]);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    callbacks.current.onReady?.(false);
    Promise.all([
      api(`/api/analysis/demos/${scene.demoId}`, { signal: controller.signal }),
      api(`/api/analysis/demos/${scene.demoId}/rounds/${scene.roundId}`, {
        signal: controller.signal,
      }),
    ])
      .then(([demo, replay]) => {
        if (controller.signal.aborted) return;
        if (
          demo.demo.summary.version !== scene.version ||
          scene.start < roundStart(replay.round) - 0.001 ||
          scene.end > roundEnd(replay.round) + 0.001
        )
          throw new Error(
            "Der gespeicherte Ausschnitt passt nicht zu dieser Analyse.",
          );
        setData({ demo: demo.demo, replay });
        callbacks.current.onReady?.(true);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message);
      });
    return () => {
      controller.abort();
      callbacks.current.onReady?.(false);
    };
  }, [scene.demoId, scene.roundId, scene.version]);
  const map = maps.find((map) => map.mapName === data?.demo.summary?.map);
  const calibration = useMemo(
    () => (map ? inferRadarCalibration(map, []) : null),
    [map],
  );
  const players = useMemo(
    () => (data ? frameAt(data.replay, time) : []),
    [data, time],
  );
  const loadouts = useMemo(
    () => (data ? loadoutsById(data.replay) : new Map<string, PlayerLoadout[]>()),
    [data],
  );
  const areas = useMemo(() => (data ? areaEffects(data.replay) : []), [data]);
  const [hover, setHover] = useState<number | null>(null);
  const focused = players.find((player) => player.id === state.focusId);
  useEffect(() => {
    const position =
      focused &&
      worldToRadar(`${focused.x} ${focused.y} ${focused.z}`, calibration);
    if (position?.level) setLevel(position.level);
  }, [focused?.id, focused?.z, calibration]);
  function change(patch: Partial<Playback>) {
    const next = {
      time,
      playing: state.playing && time < scene.end,
      speed: state.speed,
      focusId: state.focusId,
      ...patch,
    };
    if (onPlayback) onPlayback(next);
    else setLocal({ ...state, ...next, anchoredAt: serverNow() });
  }
  togglePlayback.current = null;
  radarAvailable.current = false;
  const theaterTop = (clock?: ReactNode, tools?: ReactNode) =>
    theater && (
      <div className="demo-theater-top">
        <div data-area="head">
          {theater.header}
          {tools}
        </div>
        {theater.rounds && <div data-area="rounds">{theater.rounds}</div>}
        {clock && <div data-area="clock">{clock}</div>}
      </div>
    );
  // Without a remount the previous round stays in memory until the next one has loaded.
  const stale =
    !!data && (data.demo.id !== scene.demoId || data.replay.round.id !== scene.roundId);
  if (theater && (error || !data || stale))
    return (
      <section
        className="demo-player demo-scope"
        data-layout="theater"
        data-fullscreen={fullscreen || undefined}
        aria-label="Demo-Wiedergabe"
        aria-busy={!error || undefined}
      >
        <div className="demo-stage demo-stage-status">
          {error ? (
            <Feedback error={error} />
          ) : (
            <p className="demo-theater-loading" role="status">
              <Spinner />
              Runde wird geladen …
            </p>
          )}
        </div>
        {theaterTop()}
      </section>
    );
  if (error) return <Feedback error={error} />;
  if (!data || stale)
    return (
      <div className="demo-player demo-scope" aria-label="Runde wird geladen">
        <Skeleton className="h-96 w-full rounded-none" />
        <p className="px-4 py-3 text-xs text-muted-foreground">
          Runde wird geladen …
        </p>
      </div>
    );
  const width = map?.radarWidth || 1024,
    height = map?.radarHeight || 1024;
  const point = (value: { x: number; y: number; z: number }) =>
    worldToRadar(`${value.x} ${value.y} ${value.z}`, calibration);
  const effects = areas.filter((effect) => time >= effect.start && time < effect.end);
  const sceneLength = Math.max(0.001, scene.end - scene.start);
  const percent = (value: number) =>
    `${(100 * (value - scene.start)) / sceneLength}%`;
  const playing = state.playing && time < scene.end;
  const sceneEvents = data.replay.events.filter(
    (event) => event.time >= scene.start && event.time <= scene.end,
  );
  const byId = (id: string) =>
    data.demo.summary.players.find((entry) => entry.id === id)?.name || id;
  const round = data.replay.round;
  const plantTime = data.replay.events.find((event) => event.kind === "bomb_planted")?.time;
  const clockState = roundClock(round, time, plantTime);
  const clockLabel = (value: number) => {
    const at = roundClock(round, value, plantTime);
    return at.phase === "buy"
      ? `Kauf ${countdown(at.remaining)}`
      : at.phase === "over"
        ? `Ende +${demoTime(value - round.duration)}`
        : `${at.phase === "planted" ? "C4 " : ""}${countdown(at.remaining)}`;
  };
  const loadout = new Map(
    players.map((player) => {
      const entry = loadoutAt(loadouts.get(player.id), time);
      return [player.id, entry && { ...entry, ...loadoutSummary(entry.items) }] as const;
    }),
  );
  const carrier = players.find(
    (player) => player.health > 0 && loadout.get(player.id)?.bomb,
  )?.id;
  const bomb = bombAt(data.replay, time, players, carrier);
  const sideOf = (id?: string) => players.find((player) => player.id === id)?.side;
  const killfeed = data.replay.events
    .filter(
      (event) =>
        event.kind === "player_death" && event.time <= time && event.time > time - 6,
    )
    .slice(-5);
  const phases = (
    [
      ["buy", roundStart(round), 0],
      ["live", 0, plantTime ?? round.duration],
      ["planted", plantTime ?? round.duration, round.duration],
      ["over", round.duration, roundEnd(round)],
    ] as [RoundPhase, number, number][]
  )
    .map(([phase, from, to]) => ({
      phase,
      from: Math.max(scene.start, from),
      to: Math.min(scene.end, to),
    }))
    .filter((phase) => phase.to > phase.from);
  // At most about ten labels so they never overlap, even on short scenes.
  const gridStep =
    [1, 2, 5, 10, 15, 30, 60].find((step) => sceneLength / step <= 10) || 60;
  const grid: number[] = [];
  for (
    let mark = Math.ceil(scene.start / gridStep) * gridStep;
    mark <= scene.end + 0.001;
    mark += gridStep
  )
    grid.push(mark);
  const sides = [
    { side: 2, key: "t", label: "T" },
    { side: 3, key: "ct", label: "CT" },
  ].map((entry) => ({
    ...entry,
    members: players.filter((player) => player.side === entry.side),
  }));
  const mapLabel = map?.name || data.demo.summary.map;
  const radarReady = !!(map?.radarUrl && calibration);
  const in3d = view === "3d";
  const indexOf = (id: string) =>
    data.demo.summary.players.findIndex((entry) => entry.id === id) + 1;
  const focusGear = focused && loadout.get(focused.id);
  // Analyses made before the 3D view stored only the horizontal view direction.
  const withPitch = !!data.replay.frames
    .find((frame) => frame.players.length)
    ?.players.some((player) => player.pitch !== undefined);
  togglePlayback.current = disabled
    ? null
    : () => {
        const at = timeSource.current();
        change({
          playing: !state.playing || at >= scene.end,
          time: at >= scene.end ? scene.start : at,
        });
      };
  const viewSwitch = (
    <div className="demo-switch" role="group" aria-label="Ansicht">
      {(["2d", "3d"] as const).map((value) => (
        <button
          type="button"
          key={value}
          aria-pressed={view === value}
          onClick={() => setView(value)}
        >
          {value.toUpperCase()}
        </button>
      ))}
    </div>
  );
  const fullscreenButton = document.fullscreenEnabled && (
    <button
      type="button"
      className="demo-hud-button"
      aria-label={fullscreen ? "Vollbild beenden" : "Vollbild"}
      title={fullscreen ? "Vollbild beenden (Esc)" : "Vollbild"}
      onClick={() =>
        fullscreen
          ? void document.exitFullscreen()
          : void document.documentElement
              .requestFullscreen()
              .then(() => setFullscreen(true))
              .catch(() => {})
      }
    >
      {fullscreen ? <Minimize /> : <Maximize />}
    </button>
  );
  const levelSwitch =
    !in3d && radarReady && map.radarLowerUrl ? (
      <RadarLevelSwitch level={level} onChange={setLevel} />
    ) : null;
  const cameraTools = in3d && (
    <>
      <div className="demo-switch" role="group" aria-label="Kamera">
        <button
          type="button"
          aria-pressed={camera === "ego"}
          aria-label="Ego"
          title="Ego-Perspektive des Spielers im Fokus"
          onClick={() => setCamera("ego")}
        >
          <Eye aria-hidden="true" />
          <span>Ego</span>
        </button>
        <button
          type="button"
          aria-pressed={camera === "free"}
          aria-label="Frei"
          title="Freie Kamera"
          onClick={() => setCamera("free")}
        >
          <Move3d aria-hidden="true" />
          <span>Frei</span>
        </button>
      </div>
      <button
        type="button"
        className="demo-hud-button"
        aria-pressed={xray === "on"}
        aria-label="X-Ray"
        title="Spieler und Namen durch Wände zeigen"
        onClick={() => setXray(xray === "on" ? "off" : "on")}
      >
        <ScanEye aria-hidden="true" />
        <span>X-Ray</span>
      </button>
    </>
  );
  const viewTools = (
    <>
      {viewSwitch}
      {cameraTools}
      {fullscreenButton}
    </>
  );
  const focusOptions = [
    { value: "", label: "Teamübersicht" },
    ...data.demo.summary.players.map((player, index) => ({
      value: player.id,
      label: `${index + 1}. ${player.name}`,
    })),
  ];
  const speedButtons = [0.25, 0.5, 1, 2, 4].map((value) => (
    <button
      type="button"
      key={value}
      disabled={disabled}
      aria-pressed={state.speed === value}
      onClick={() => change({ speed: value })}
    >
      {value.toLocaleString("de-AT")}×
    </button>
  ));
  // The theater keeps everything that also works in 2D in the first row, the 3D camera controls in the second.
  const theaterTools = (
    <>
      <div className="demo-theater-tools">
        {viewSwitch}
        {levelSwitch}
        <Select
          value={state.focusId || "__none"}
          disabled={disabled}
          onValueChange={(value) => change({ focusId: value === "__none" ? "" : value })}
        >
          <SelectTrigger className="demo-hud-select" aria-label="Fokus">
            <span className="demo-hud-select-label">Fokus</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            <SelectGroup>
              {focusOptions.map((option) => (
                <SelectItem key={option.value || "__none"} value={option.value || "__none"}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {players.length > 0 && (
          <button
          type="button"
          className="demo-hud-button demo-teams-toggle"
          aria-pressed={teams === "on"}
          aria-label="Teams"
          title="Teams am Rand zeigen"
          onClick={() => setTeams(teams === "on" ? "off" : "on")}
        >
            <UsersRound aria-hidden="true" />
            <span>Teams</span>
          </button>
        )}
        {fullscreenButton}
      </div>
      {cameraTools && <div className="demo-theater-tools">{cameraTools}</div>}
    </>
  );
  const stageInfo = in3d ? (
    camera === "free" ? (
      <p className="demo-chip demo-3d-help">
        {flying ? <span>Maus zum Umsehen</span> : <span>In die Ansicht klicken zum Steuern</span>}
        <span><Kbd>W</Kbd><Kbd>A</Kbd><Kbd>S</Kbd><Kbd>D</Kbd> fliegen</span>
        <span><Kbd>E</Kbd><Kbd>Q</Kbd> hoch und runter</span>
        <span><Kbd>Shift</Kbd> schneller</span>
        {flying && <span>Mausrad Tempo</span>}
        {flying && <span><Kbd>Esc</Kbd> Maus freigeben</span>}
      </p>
    ) : focused && focused.health > 0 ? (
      <p
        className="demo-chip demo-ego"
        data-side={focused.side === 2 ? "t" : "ct"}
      >
        <strong>
          {indexOf(focused.id)}. {byId(focused.id)}
        </strong>
        <span title="Lebenspunkte">{focused.health} HP</span>
        {focusGear && focusGear.armor > 0 && (
          <span title={focusGear.helmet ? "Kevlar und Helm" : "Kevlar"}>
            {focusGear.helmet ? <ShieldCheck aria-hidden="true" /> : <Shield aria-hidden="true" />}
            {focusGear.armor}
          </span>
        )}
        {focused.weapon && <span>{focused.weapon}</span>}
        {focusGear && <span>{money(focusGear.money)}</span>}
        {!withPitch && (
          <small title="Diese Analyse enthält nur die horizontale Blickrichtung. Neu hochgeladene Demos enthalten auch den Blick nach oben und unten.">
            Blick waagrecht
          </small>
        )}
      </p>
    ) : (
      <p className="demo-chip demo-3d-help">
        {focused
          ? `${byId(focused.id)} ist ausgeschieden.`
          : disabled
            ? "Für die Ego-Perspektive fehlt ein Spieler im Fokus."
            : "Wähle unter „Fokus“ einen Spieler für die Ego-Perspektive."}
      </p>
    )
  ) : (
    levelSwitch
  );
  // Marks on the radar; the minimap in the 3D view draws the same scene smaller, so its marks are enlarged.
  const radarMarks = (mini: boolean) => {
    const k = mini ? 2.2 : 1;
    return (
      <>
        {effects.map((effect) => {
          const p = point(effect);
          return p && radarPointVisible(map, p, level) ? (
            <circle
              key={effect.key}
              cx={p.x * width}
              cy={p.y * height}
              r={width * 0.035}
              className={effect.kind === "fire" ? "demo-fire" : "demo-smoke"}
            >
              <title>
                {kindLabel(effect.kind === "fire" ? "inferno_startburn" : "smokegrenade_detonate")} · schematischer Wirkungsbereich
              </title>
            </circle>
          ) : null;
        })}
        {!mini && data.replay.grenades.map((grenade) => {
          const end = grenade.points.at(-1);
          if (
            !end ||
            time < grenade.points[0].time ||
            time > end.time + 0.5
          )
            return null;
          const points = grenade.points
            .filter((p) => p.time <= time && p.time >= time - 2)
            .map(point)
            .filter((p) => p && radarPointVisible(map, p, level));
          if (!points.length) return null;
          return (
            <g key={grenade.id} className="demo-grenade">
              <polyline
                points={points
                  .map((p) => `${p!.x * width},${p!.y * height}`)
                  .join(" ")}
              />
              <circle
                cx={points.at(-1)!.x * width}
                cy={points.at(-1)!.y * height}
                r={6}
              >
                <title>{grenade.kind}</title>
              </circle>
            </g>
          );
        })}
        {bomb && bomb.kind !== "carried" && (() => {
          const p = point(bomb);
          return p && radarPointVisible(map, p, level) ? (
            <g
              className="demo-bomb"
              data-state={bomb.kind}
              transform={`translate(${p.x * width},${p.y * height})`}
            >
              <title>
                {{ dropped: "Bombe liegt", planted: "Bombe gelegt", defused: "Bombe entschärft", exploded: "Bombe explodiert" }[bomb.kind]}
              </title>
              {bomb.kind === "planted" && <circle r={width * 0.022 * k} className="demo-bomb-pulse" />}
              <rect x={-width * 0.009 * k} y={-width * 0.007 * k} width={width * 0.018 * k} height={width * 0.014 * k} rx={3 * k} />
            </g>
          ) : null;
        })()}
        {players.map((player) => {
          const p = point(player);
          if (!p || !radarPointVisible(map, p, level)) return null;
          const index = data.demo.summary.players.findIndex(
            (entry) => entry.id === player.id,
          );
          const name = data.demo.summary.players[index]?.name || player.id;
          const size = width * 0.012 * k;
          const focus = player.id === state.focusId;
          return (
            <g
              key={player.id}
              transform={`translate(${p.x * width},${p.y * height})`}
              className={
                player.side === 2 ? "demo-player-t" : "demo-player-ct"
              }
              opacity={player.health > 0 ? 1 : 0.4}
            >
              <title>
                {name} · {player.health} HP · {player.weapon}
              </title>
              {player.health > 0 ? (
                <>
                  {focus && (
                    <circle
                      r={size * 1.9}
                      className="demo-player-focus-ring"
                    />
                  )}
                  <line
                    x2={Math.cos((player.yaw * Math.PI) / 180) * size * 2.3}
                    y2={
                      -Math.sin((player.yaw * Math.PI) / 180) * size * 2.3
                    }
                    strokeWidth={5 * k}
                  />
                  <circle r={size} strokeWidth={(focus ? 4 : 2) * k} />
                  {!mini && (
                    <text textAnchor="middle" dy="0.35em" fontSize={size}>
                      {index + 1}
                    </text>
                  )}
                  {bomb?.kind === "carried" && bomb.playerId === player.id && (
                    <rect
                      className="demo-bomb-carrier"
                      x={size * 0.55}
                      y={-size * 1.55}
                      width={size * 1.1}
                      height={size * 0.8}
                      rx={2}
                    >
                      <title>trägt die Bombe</title>
                    </rect>
                  )}
                </>
              ) : (
                <path
                  d={`M-${size},-${size} L${size},${size} M-${size},${size} L${size},-${size}`}
                  strokeWidth={4 * k}
                />
              )}
              {focus && !mini && (
                <text
                  y={-size * 2.6}
                  textAnchor="middle"
                  className="demo-player-name"
                  fontSize={size * 1.05}
                >
                  {name}
                </text>
              )}
            </g>
          );
        })}
        {!mini && pointer && pointer.level === level && now - pointer.at < 5000 && (
          <g
            className="demo-pointer"
            transform={`translate(${pointer.x * width},${pointer.y * height})`}
          >
            <circle r={width * 0.025} />
            <path d="M-25,0 H25 M0,-25 V25" />
          </g>
        )}
      </>
    );
  };
  const stageBody = in3d ? (
    <Suspense fallback={<div className="demo-3d" aria-busy="true" />}>
      <DemoStage3d
        mapName={data.demo.summary.map}
        mapLabel={mapLabel}
        replay={data.replay}
        roster={data.demo.summary.players}
        clock={timeSource}
        focusId={state.focusId}
        mode={camera}
        onModeChange={setCamera}
        xray={xray === "on"}
        calibration={calibration}
        pointer={pointer}
        onPoint={onPoint}
        onFocus={disabled ? undefined : (focusId) => change({ focusId })}
        onCaptureChange={setFlying}
      />
    </Suspense>
  ) : (
    radarReady && (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${map.name}, Runde ${data.replay.round.number}, ${demoTime(time)}`}
        onClick={(event) => {
          if (!onPoint) return;
          const matrix = event.currentTarget.getScreenCTM();
          if (!matrix) return;
          const p = new DOMPoint(
            event.clientX,
            event.clientY,
          ).matrixTransform(matrix.inverse());
          if (p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height)
            onPoint({ x: p.x / width, y: p.y / height, level });
        }}
      >
        <RadarBackground map={map} level={level} />
        {radarMarks(false)}
      </svg>
    )
  );
  // In 3D the theater keeps the overview as a small radar under the controls.
  radarAvailable.current = !!(theater && in3d && radarReady);
  const radarLabel = `Radar ${map?.name}, Runde ${data.replay.round.number}, ${demoTime(time)}`;
  const minimap = theater && in3d && radarReady && !largeRadar && (
    <div className="demo-minimap" title="Strg drücken: Radar vergrößern">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${radarLabel}. Strg vergrößert das Radar.`}>
        <RadarBackground map={map} level={level} />
        {radarMarks(true)}
      </svg>
    </div>
  );
  const radarOverlay = theater && in3d && radarReady && largeRadar && (
    <div className="demo-radar-overlay" title="Strg oder Esc: Radar verkleinern">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${radarLabel}. Strg oder Esc verkleinert das Radar.`}>
        <RadarBackground map={map} level={level} />
        {radarMarks(false)}
      </svg>
    </div>
  );
  const emptyMap = (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Keine kalibrierte Karte verfügbar</EmptyTitle>
        <EmptyDescription>
          Die Ereignisse sind lesbar. Für {data.demo.summary.map} fehlt
          eine passende Radarprojektion.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="secondary" size="sm" onClick={() => setView("3d")}>
          3D-Ansicht öffnen
        </Button>
      </EmptyContent>
    </Empty>
  );
  const clockChip = (
    <span
      className="demo-chip demo-clock"
      data-phase={clockState.phase}
      aria-live="off"
      title={`Wiedergabe ${demoTime(time)} / ${demoTime(scene.end)}`}
    >
      <small>{phaseLabels[clockState.phase]}</small>
      {clockState.phase === "planted" && <Bomb aria-hidden="true" />}
      {countdown(clockState.remaining)}
    </span>
  );
  const killfeedList = killfeed.length > 0 && (
    <ol className="demo-killfeed" aria-label="Letzte Kills">
      {killfeed.map((event, index) => (
        <li key={`${event.tick}-${index}`}>
          <span data-side={sideOf(event.playerId) === 2 ? "t" : sideOf(event.playerId) === 3 ? "ct" : undefined}>
            {event.player || "Welt"}
          </span>
          <small>{event.weapon && weaponLabel(event.weapon)}</small>
          <span data-side={sideOf(event.targetId) === 2 ? "t" : sideOf(event.targetId) === 3 ? "ct" : undefined}>
            {event.target}
          </span>
        </li>
      ))}
    </ol>
  );
  const timeline = (
    <div className="demo-timeline">
      <div
        className="demo-timeline-track"
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const fraction = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
          setHover(scene.start + fraction * sceneLength);
        }}
        onPointerLeave={() => setHover(null)}
      >
        <div className="demo-phase-track" aria-hidden="true">
          {phases.map((phase) => (
            <span
              key={phase.phase}
              data-phase={phase.phase}
              style={{ left: percent(phase.from), width: `${(100 * (phase.to - phase.from)) / sceneLength}%` }}
            >
              {(phase.to - phase.from) / sceneLength > 0.1 && phaseLabels[phase.phase]}
            </span>
          ))}
        </div>
        {hover !== null && (
          <span className="demo-timeline-hover" style={{ left: percent(hover) }} aria-hidden="true">
            {clockLabel(hover)}
          </span>
        )}
        <input
          aria-label="Zeitpunkt in der Szene"
          type="range"
          min={scene.start}
          max={scene.end}
          step={0.05}
          value={time}
          disabled={disabled}
          onChange={(event) => setScrub(Number(event.target.value))}
          onPointerUp={(event) => {
            change({ time: Number(event.currentTarget.value) });
            setScrub(null);
          }}
          onKeyUp={(event) => {
            change({ time: Number(event.currentTarget.value) });
            setScrub(null);
          }}
        />
      </div>
      <div className="demo-event-track" aria-label="Ereignisse in der Szene">
        {sceneEvents
          .filter(
            (event) =>
              !event.kind.endsWith("expire") &&
              !event.kind.endsWith("expired") &&
              event.kind !== "bomb_dropped" &&
              event.kind !== "bomb_pickup",
          )
          .map((event, index) => (
            <button
              type="button"
              key={index}
              disabled={disabled}
              className={`demo-event-${eventTone(event.kind)}`}
              style={{ left: percent(event.time) }}
              aria-label={`${clockLabel(event.time)}: ${kindLabel(event.kind)} ${event.player}`}
              title={`${clockLabel(event.time)} · ${kindLabel(event.kind)} · ${event.player}${event.target ? ` → ${event.target}` : ""}`}
              onClick={() =>
                change({
                  time: Math.max(scene.start, event.time - 3),
                  playing: false,
                })
              }
            />
          ))}
      </div>
      <div className="demo-timeline-scale" aria-hidden="true">
        {grid.map((mark) => (
          <span
            key={mark}
            style={{ left: percent(mark) }}
            data-edge={
              mark - scene.start < sceneLength * 0.04
                ? "start"
                : scene.end - mark < sceneLength * 0.04
                  ? "end"
                  : undefined
            }
          >
            {clockLabel(mark)}
          </span>
        ))}
      </div>
    </div>
  );
  const transportButtons = (
    <div className="demo-transport-buttons">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Zum Szenenanfang"
        disabled={disabled}
        onClick={() => change({ time: scene.start, playing: false })}
      >
        <RotateCcw />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Fünf Sekunden zurück"
        disabled={disabled}
        onClick={() => change({ time: Math.max(scene.start, time - 5) })}
      >
        <SkipBack />
      </Button>
      <Button
        className="demo-transport-play"
        aria-label={playing ? "Pausieren" : "Abspielen"}
        title={theater ? (playing ? "Pausieren (Leertaste)" : "Abspielen (Leertaste)") : undefined}
        disabled={disabled}
        onClick={() => togglePlayback.current?.()}
      >
        {playing ? <Pause /> : <Play />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Fünf Sekunden vor"
        disabled={disabled}
        onClick={() => change({ time: Math.min(scene.end, time + 5) })}
      >
        <SkipForward />
      </Button>
    </div>
  );
  const transportSettings = (
    <div className="demo-transport-settings">
      <div
        className="demo-speed"
        role="group"
        aria-label="Wiedergabetempo"
      >
        {speedButtons}
      </div>
      <Choice
        label="Fokus"
        value={state.focusId}
        disabled={disabled}
        options={focusOptions}
        onChange={(focusId) => change({ focusId })}
      />
    </div>
  );
  const rosterSide = (group: (typeof sides)[number], className = "") => (
    <div
      className={`demo-roster-side ${className}`.trim()}
      data-side={group.key}
      key={group.key}
      aria-label={`${group.label}-Seite`}
    >
      <header>
        <span>
          {group.label}
          {round.economy?.[group.key as "t" | "ct"] && (
            <span
              className="demo-roster-buy"
              title={`Ausrüstungswert nach dem Kauf: ${money(round.economy[group.key as "t" | "ct"]!.equipment)}`}
            >
              {buyLabel(round.economy[group.key as "t" | "ct"]!.buy)}
              <small>{money(round.economy[group.key as "t" | "ct"]!.equipment)}</small>
            </span>
          )}
        </span>
        <small>
          {group.members.filter((player) => player.health > 0).length}{" "}
          / {group.members.length} am Leben
        </small>
      </header>
      {group.members.map((player) => (
        <button
          type="button"
          key={player.id}
          disabled={disabled}
          aria-pressed={state.focusId === player.id}
          data-dead={player.health <= 0}
          onClick={() => change({ focusId: theater && state.focusId === player.id ? "" : player.id })}
        >
          <span className="demo-roster-index">{indexOf(player.id)}</span>
          <span className="demo-roster-name">{byId(player.id)}</span>
          <span className="demo-roster-hp">
            {player.health > 0 ? `${player.health} HP` : "—"}
          </span>
          {(() => {
            const gear = loadout.get(player.id);
            if (!gear || player.health <= 0)
              return player.health > 0 && player.weapon ? (
                <span className="demo-roster-loadout">
                  <span className="demo-roster-weapon"><strong>{player.weapon}</strong></span>
                </span>
              ) : null;
            return (
              <span className="demo-roster-loadout">
                <span className="demo-roster-weapon">
                  <strong title="Aktive Waffe">{player.weapon || "—"}</strong>
                  {gear.primary && gear.primary !== player.weapon && <span>{gear.primary}</span>}
                </span>
                <span className="demo-roster-gear">
                  {gear.grenades.map((grenade, at) =>
                    grenade === "Decoy" ? (
                      <span key={at} className="demo-roster-decoy" title="Decoy">D</span>
                    ) : (
                      <span key={at} title={grenade === "Molly" ? "Molotov / Brandgranate" : grenade}>
                        <GrenadeIcon type={grenade} className="size-4" />
                      </span>
                    ),
                  )}
                  {gear.bomb && <Bomb className="demo-roster-bomb" aria-label="Bombe" />}
                  {gear.defuser && <Scissors aria-label="Entschärfungskit" />}
                  {gear.armor > 0 &&
                    (gear.helmet ? (
                      <ShieldCheck aria-label={`Kevlar und Helm, ${gear.armor}`} />
                    ) : (
                      <Shield aria-label={`Kevlar, ${gear.armor}`} />
                    ))}
                </span>
                <span className="demo-roster-money">{money(gear.money)}</span>
              </span>
            );
          })()}
          <span className="demo-roster-bar" aria-hidden="true">
            <span
              style={{
                width: `${Math.max(0, Math.min(100, player.health))}%`,
              }}
            />
          </span>
        </button>
      ))}
    </div>
  );
  if (theater) {
    const showTeams = teams === "on" && players.length > 0;
    return (
      <section
        className="demo-player demo-scope"
        data-layout="theater"
        data-fullscreen={fullscreen || undefined}
        data-teams={showTeams || undefined}
        aria-label="Demo-Wiedergabe"
      >
        {radarReady || in3d ? (
          <div className="demo-stage" data-view={view} data-pointable={!in3d && !!onPoint}>
            {stageBody}
          </div>
        ) : (
          <div className="demo-stage demo-stage-status">{emptyMap}</div>
        )}
        {radarOverlay}
        {theaterTop(
          <>
            {clockChip}
            {killfeedList}
          </>,
          <>
            {theaterTools}
            {minimap}
          </>,
        )}
        <div className="demo-theater-bottom">
          {(showTeams || in3d) && (
            <div className="demo-theater-row">
              {showTeams && sides.map((group) => rosterSide(group, "demo-theater-team"))}
              {in3d && <div className="demo-theater-info">{stageInfo}</div>}
            </div>
          )}
          <div className="demo-dock">
            <div className="demo-dock-controls">
              {transportButtons}
              <div className="demo-dock-speed" role="group" aria-label="Wiedergabetempo" title="Wiedergabetempo">
                {speedButtons}
              </div>
            </div>
            {timeline}
          </div>
        </div>
      </section>
    );
  }
  return (
    <section
      className="demo-player demo-scope"
      data-fullscreen={fullscreen || undefined}
      aria-label="Demo-Wiedergabe"
    >
      {radarReady || in3d ? (
        <div
          className={compact ? "demo-stage demo-stage-compact" : "demo-stage"}
          data-view={view}
          data-pointable={!in3d && !!onPoint}
        >
          <div className="demo-hud demo-hud-top-left">
            <span className="demo-chip">
              <strong>{mapLabel}</strong>
              <span>Runde {data.replay.round.number}</span>
            </span>
          </div>
          <div className="demo-hud demo-hud-top-right">
            {clockChip}
            {killfeedList}
          </div>
          {stageBody}
          <div className="demo-hud demo-hud-bottom-left">{viewTools}</div>
          {stageInfo && <div className="demo-hud demo-hud-bottom-right">{stageInfo}</div>}
        </div>
      ) : (
        <div className="demo-stage demo-stage-empty">{emptyMap}</div>
      )}
      {timeline}
      <div className="demo-transport">
        {transportButtons}
        {transportSettings}
      </div>
      {!compact && players.length > 0 && (
        <div className="demo-roster">{sides.map((group) => rosterSide(group))}</div>
      )}
      <details className="demo-log">
        <summary>
          Ereignisprotokoll · {sceneEvents.length}{" "}
          {sceneEvents.length === 1 ? "Ereignis" : "Ereignisse"}
        </summary>
        <ol>
          {sceneEvents.map((event, index) => (
            <li key={index}>
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  change({
                    time: Math.max(scene.start, event.time - 3),
                    playing: false,
                  })
                }
              >
                <time title={`Wiedergabe ${demoTime(event.time)}`}>{clockLabel(event.time)}</time>
                <span className="demo-log-kind" data-kind={eventTone(event.kind)}>
                  {kindLabel(event.kind)}
                </span>
                <span className="demo-log-text">
                  {event.player}
                  {event.target ? <span> → {event.target}</span> : null}
                  {event.weapon && event.kind === "player_death" ? (
                    <span> · {weaponLabel(event.weapon)}</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ol>
        <p>
          Smoke und Feuer werden schematisch angezeigt. Die Radaransicht
          verwendet den verfügbaren Kartenstand. Zeitbasis: 64 Ticks/s.
        </p>
      </details>
    </section>
  );
}

export function SceneExample({
  scene,
  maps,
}: {
  scene: SceneReference;
  maps: MapDefinition[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-3 flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(!open)}
        >
          <Play data-icon="inline-start" />
          {open ? "Beispiel schließen" : "Beispielszene ansehen"}
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link
            to={`/analysis/demos/${scene.demoId}?round=${scene.roundId}&start=${scene.start}&end=${scene.end}&focus=${scene.focusId}`}
          >
            Im Match öffnen
          </Link>
        </Button>
      </div>
      {open && <DemoPlayer scene={scene} maps={maps} compact />}
    </div>
  );
}

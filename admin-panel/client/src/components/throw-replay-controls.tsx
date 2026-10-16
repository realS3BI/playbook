import { Pause, Play, RotateCcw, X } from "lucide-react";
import { Button } from "./ui/button";
import { TIMELINE_LANES } from "../../../shared/throw-motion";
import type { ReplayFrame, ReplayPhase } from "../lib/throw-replay";

const signed = (value: number) => `${value > 0.005 ? "+" : value < -0.005 ? "−" : ""}${Math.abs(value).toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s`;
const clock = (value: number) => `${value.toLocaleString("de-AT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
const EFFECT_LABELS = { Smoke: "Smoke gezündet", Molly: "Molotov brennt", Flash: "Flash gezündet", HE: "HE explodiert", Decoy: "Decoy gezündet" } as Record<string, string>;
const PHASE_LABELS: Record<Exclude<ReplayPhase, "effect">, string> = { lineup: "Ausrichten", movement: "Bewegung", release: "Abwurf", flight: "Flug" };
export const REPLAY_SPEEDS = [1, 0.5, 0.25] as const;
// Keyboard cluster as in CS2: movement on the left, stance and jump below, mouse buttons apart.
const KEY_ROWS = [["W"], ["A", "S", "D"], ["Shift", "Ctrl", "Space"], ["Maus 1", "Maus 2"]];
const KEY_BUTTONS = Object.fromEntries(TIMELINE_LANES.map(lane => [lane.key, lane.buttons as readonly string[]]));

// Without a flight path the camera only moves to the target; its timing then says nothing about the throw.
export function ReplayStatus({ frame, kind, source, timed, measured }: { frame: ReplayFrame; kind: string; source: string; timed: boolean; measured?: number }) {
  const after = frame.phase === "effect" || frame.phase === "flight";
  const label = frame.phase === "effect" ? EFFECT_LABELS[kind] ?? "Gezündet" : frame.phase === "flight" && !timed ? "Zum Zielpunkt" : PHASE_LABELS[frame.phase];
  const detail = !after ? signed(frame.fromRelease) : timed ? `${signed(frame.fromRelease)} nach dem Loslassen`
    : frame.phase === "effect" && typeof measured === "number" ? `nach ${measured.toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s gemessener Flugzeit` : "";
  return <div className="throw-replay-status">
    <p><strong>{label}</strong>{detail && <span className="tabular-nums">{detail}</span>}</p>
    <p className="throw-replay-source">{source}</p>
  </div>;
}

export function ReplayKeys({ buttons }: { buttons: Set<string> }) {
  return <div className="throw-replay-keys" aria-hidden="true">
    {KEY_ROWS.map(row => <div key={row.join()}>{row.map(key =>
      <kbd key={key} data-key={key} data-held={KEY_BUTTONS[key].some(button => buttons.has(button)) || undefined}>{key}</kbd>)}</div>)}
  </div>;
}

export function ReplayBar({ time, end, playing, speed, onToggle, onSeek, onRestart, onSpeed, onClose }: {
  time: number; end: number; playing: boolean; speed: number;
  onToggle(): void; onSeek(time: number): void; onRestart(): void; onSpeed(speed: number): void; onClose(): void;
}) {
  const finished = time >= end - 0.02;
  return <div className="throw-replay-bar">
    <Button size="icon" variant="secondary" onClick={finished ? onRestart : onToggle} aria-label={finished ? "Erneut abspielen" : playing ? "Pausieren" : "Abspielen"} aria-keyshortcuts="K">
      {finished ? <RotateCcw /> : playing ? <Pause /> : <Play />}
    </Button>
    <input className="throw-replay-seek" type="range" min={0} max={end} step={0.01} value={Math.min(time, end)} onChange={event => onSeek(Number(event.currentTarget.value))}
      aria-label="Wiedergabeposition" aria-valuetext={`${clock(time)} von ${clock(end)}`} />
    <span className="throw-replay-clock tabular-nums" aria-hidden="true">{clock(time)} / {clock(end)}</span>
    <div className="throw-replay-speed" role="group" aria-label="Geschwindigkeit">
      {REPLAY_SPEEDS.map(value => <button key={value} type="button" aria-pressed={speed === value} onClick={() => onSpeed(value)}>
        {value === 1 ? "1×" : value === 0.5 ? "½×" : "¼×"}</button>)}
    </div>
    <Button size="sm" variant="ghost" onClick={onClose} aria-keyshortcuts="Escape"><X data-icon="inline-start" />Beenden</Button>
  </div>;
}

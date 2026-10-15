import { useEffect, useMemo, useState } from "react";
import type { MapDefinition } from "@/lib/maps";
import { worldPointToRadar, type RadarCalibration } from "@/lib/nade-radar";
import { radarPointVisible, type RadarLevel } from "@/lib/radar-layout";
import type { Point3 } from "../../../shared/demo-insights";
import type { Duel, UtilityGroup } from "../../../shared/opponent-report";
import { RadarBackground } from "./radar-background";
import { RadarLevelSwitch } from "./radar-level-switch";

export type ScoutingLayer = "heat" | "utility" | "duels" | "plants";
export const UTILITY_LABELS = { smoke: "Smoke", flash: "Flash", molotov: "Molotov", he: "HE", decoy: "Decoy" } as const;
export const UTILITY_ICONS = { smoke: "Smoke", flash: "Flash", molotov: "Molly", he: "HE", decoy: "Decoy" } as const;

// The density grid has this many cells along the longer radar edge; the blur spreads each second over a few metres.
const GRID = 240;
const BLUR = 2.2;

function cssColor(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1] || fallback.slice(1);
  return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
}

function blur(grid: Float32Array, width: number, height: number) {
  const radius = Math.ceil(BLUR * 3);
  const kernel = Array.from({ length: radius * 2 + 1 }, (_, index) => Math.exp(-((index - radius) ** 2) / (2 * BLUR * BLUR)));
  const total = kernel.reduce((sum, value) => sum + value, 0);
  const pass = (source: Float32Array, horizontal: boolean) => {
    const target = new Float32Array(source.length);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) {
          const sx = horizontal ? x + k : x, sy = horizontal ? y : y + k;
          if (sx >= 0 && sx < width && sy >= 0 && sy < height) sum += source[sy * width + sx] * kernel[k + radius];
        }
        target[y * width + x] = sum / total;
      }
    return target;
  };
  return pass(pass(grid, true), false);
}

/**
 * Density of positions as an image over the radar. One hue: the side colour, darker and transparent
 * where players rarely stood, brighter and opaque where they spent most of their time.
 */
function heatImage(points: Point3[], map: MapDefinition, calibration: RadarCalibration, level: RadarLevel, side: number) {
  const width = map.radarWidth || 1024, height = map.radarHeight || 1024;
  const scale = GRID / Math.max(width, height);
  const columns = Math.max(1, Math.round(width * scale)), rows = Math.max(1, Math.round(height * scale));
  const grid = new Float32Array(columns * rows);
  let counted = 0;
  for (const [x, y, z] of points) {
    const point = worldPointToRadar(calibration, x, y, z);
    if (!point || !radarPointVisible(map, point, level)) continue;
    grid[Math.min(rows - 1, Math.floor(point.y * rows)) * columns + Math.min(columns - 1, Math.floor(point.x * columns))]++;
    counted++;
  }
  if (!counted) return null;
  const blurred = blur(grid, columns, rows);
  // The 99th percentile keeps one camped corner from washing out every other spot.
  const values = [...blurred].filter((value) => value > 0).sort((a, b) => a - b);
  const top = values[Math.floor(values.length * 0.99)] || values.at(-1) || 1;
  const [r, g, b] = side === 2 ? cssColor("--side-t", "#de9a3a") : cssColor("--side-ct", "#6aa9ec");
  const canvas = document.createElement("canvas");
  canvas.width = columns;
  canvas.height = rows;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(columns, rows);
  for (let index = 0; index < blurred.length; index++) {
    const value = Math.min(1, blurred[index] / top);
    if (value < 0.03) continue;
    const light = value ** 1.6 * 0.65;
    image.data[index * 4] = r + (255 - r) * light;
    image.data[index * 4 + 1] = g + (255 - g) * light;
    image.data[index * 4 + 2] = b + (255 - b) * light;
    image.data[index * 4 + 3] = 255 * (0.18 + 0.72 * Math.sqrt(value));
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

export function ScoutingRadar({
  map,
  calibration,
  side,
  points,
  utility,
  duels,
  plants,
  layers,
  selected,
  onSelect,
  names,
}: {
  map: MapDefinition;
  calibration: RadarCalibration;
  side: number;
  points: Point3[];
  utility: UtilityGroup[];
  duels: Duel[];
  plants: { at: Point3; time: number; playerId: string }[];
  layers: Set<ScoutingLayer>;
  selected: number | null;
  onSelect: (index: number | null) => void;
  names: (id: string) => string;
}) {
  const [level, setLevel] = useState<RadarLevel>("upper");
  useEffect(() => setLevel("upper"), [map.mapName]);
  const heat = useMemo(
    () => (layers.has("heat") ? heatImage(points, map, calibration, level, side) : null),
    [points, map, calibration, level, side, layers.has("heat")],
  );
  const width = map.radarWidth || 1024, height = map.radarHeight || 1024;
  const project = ([x, y, z]: Point3) => {
    const point = worldPointToRadar(calibration, x, y, z);
    return point && radarPointVisible(map, point, level) ? { x: point.x * width, y: point.y * height } : null;
  };
  const unit = width / 100;
  const clock = (time: number) => `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}`;
  return (
    <div className="scout-stage">
      {map.radarLowerUrl && <div className="demo-hud demo-hud-bottom-right"><RadarLevelSwitch level={level} onChange={setLevel} /></div>}
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${map.name}: Aufenthalte, Utility und Duelle`}
        onClick={(event) => { if (event.target === event.currentTarget) onSelect(null); }}>
        <RadarBackground map={map} level={level} />
        {heat && <image href={heat} width={width} height={height} preserveAspectRatio="none" className="scout-heat" />}
        {layers.has("plants") && plants.map((plant, index) => {
          const p = project(plant.at);
          return p && (
            <rect key={`plant-${index}`} className="scout-plant" x={p.x - unit * 0.9} y={p.y - unit * 0.6} width={unit * 1.8} height={unit * 1.2} rx={unit * 0.25}>
              <title>Plant von {names(plant.playerId)} nach {clock(plant.time)}</title>
            </rect>
          );
        })}
        {layers.has("duels") && duels.map((duel, index) => {
          const p = project(duel.at), other = duel.from && project(duel.from);
          if (!p) return null;
          return (
            <g key={`duel-${index}`} className="scout-duel" data-side={side === 2 ? "t" : "ct"} data-won={duel.won}>
              <title>{duel.won ? "Erster Kill" : "Erster Tod"}: {names(duel.playerId)} nach {clock(duel.time)}</title>
              {other && <line x1={p.x} y1={p.y} x2={other.x} y2={other.y} />}
              {duel.won
                ? <circle cx={p.x} cy={p.y} r={unit * 0.75} />
                : <path d={`M${p.x - unit * 0.6},${p.y - unit * 0.6} L${p.x + unit * 0.6},${p.y + unit * 0.6} M${p.x - unit * 0.6},${p.y + unit * 0.6} L${p.x + unit * 0.6},${p.y - unit * 0.6}`} />}
            </g>
          );
        })}
        {layers.has("utility") && utility.map((group, index) => {
          const p = project(group.at);
          if (!p) return null;
          const active = selected === index;
          return (
            <g key={`utility-${index}`} className="scout-utility" data-kind={group.kind} data-active={active}
              onClick={() => onSelect(active ? null : index)}>
              <title>{UTILITY_LABELS[group.kind]} · {group.rounds} {group.rounds === 1 ? "Runde" : "Runden"} · meist nach {clock(group.time)}</title>
              {active && group.throws.map((item, at) => {
                const from = project(item.from), to = project(item.to);
                return from && to && <g key={at} className="scout-throw">
                  <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
                  <circle cx={from.x} cy={from.y} r={unit * 0.35} />
                </g>;
              })}
              <circle cx={p.x} cy={p.y} r={unit * (1.1 + Math.min(1.4, group.rounds * 0.2))} />
              {group.rounds > 1 && <text x={p.x} y={p.y} dy="0.35em" textAnchor="middle" fontSize={unit * 1.3}>{group.rounds}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

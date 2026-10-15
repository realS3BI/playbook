import { useEffect, useRef, useState } from "react";
import { VERTICAL_FOV_DEGREES } from "../../../shared/map-scene";
import { useStoredChoice } from "../lib/stored-choice";

// Sizes in pixels at a screen height of 1080, as in CS2 crosshair generators.
const CROSSHAIRS = [
  { id: "fine", title: "Fein", length: 12, thickness: 1, gap: 0, outline: 0, outlineAlpha: 0 },
  { id: "gap", title: "Mit Lücke", length: 12, thickness: 2, gap: 7, outline: 1, outlineAlpha: 115 / 255 },
  // Lines across the whole view with a tick every 10°, drawn by LineupGuide instead of a glyph.
  { id: "lineup", title: "Lineup-Hilfe", length: 0, thickness: 0, gap: 0, outline: 0, outlineAlpha: 0 },
] as const;
export type CrosshairStyle = typeof CROSSHAIRS[number]["id"];

export function useCrosshairStyle() {
  return useStoredChoice<CrosshairStyle>("playbook.crosshair", CROSSHAIRS.map(item => item.id), "fine");
}

export function useLineupGuide() {
  const [value, choose] = useStoredChoice("playbook.lineupGuide", ["on", "off"], "off");
  return [value === "on", (on: boolean) => choose(on ? "on" : "off")] as const;
}

// Drawn in whole device pixels around the aim point so thin strokes stay sharp. `unit` is CSS pixels per 1080p pixel.
export function CrosshairGlyph({ style, unit }: { style: CrosshairStyle; unit: number }) {
  const spec = CROSSHAIRS.find(item => item.id === style)!;
  if (!spec.length) return null;
  const ratio = window.devicePixelRatio || 1, scale = unit * ratio;
  const t = Math.max(1, Math.round(spec.thickness * scale)), half = Math.floor(t / 2);
  const g = Math.round(spec.gap * scale), l = Math.max(1, Math.round(spec.length * scale));
  const o = spec.outline ? Math.max(1, Math.round(spec.outline * scale)) : 0;
  const arms = [
    [-half + t + g, -half, l, t], [-half - g - l, -half, l, t],
    [-half, -half + t + g, t, l], [-half, -half - g - l, t, l],
    ...(g === 0 ? [[-half, -half, t, t]] : []),
  ];
  return <svg width="1" height="1" overflow="visible" aria-hidden="true">
    <g transform={`scale(${1 / ratio})`} shapeRendering="crispEdges">
      {o > 0 && <g opacity={spec.outlineAlpha}>{arms.map(([x, y, w, h], index) => <rect key={index} x={x - o} y={y - o} width={w + 2 * o} height={h + 2 * o} fill="black" />)}</g>}
      {arms.map(([x, y, w, h], index) => <rect key={index} x={x} y={y} width={w} height={h} fill="white" />)}
    </g>
  </svg>;
}

// Lineup help: one tick every 10° from the aim point. Values count down and right on screen;
// the labels follow the usual lineup overlay instead: 1y is up, -1x is left.
export const GUIDE_STEP_DEGREES = 10;
export const GUIDE_TICKS = [-8, -7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8];
type Point = [number, number];
export type GuideAxis = { origin: Point; direction: Point; ticks: { value: number; at: Point }[] };
export type GuideGeometry = { vertical: GuideAxis | null; horizontal: GuideAxis | null };

// CS2 keeps the vertical field of view, so a screenshot of the game view maps angles through its height.
export function screenGuide(width: number, height: number, pictureHeight: number): GuideGeometry {
  const focal = pictureHeight / 2 / Math.tan(VERTICAL_FOV_DEGREES * Math.PI / 360);
  const offset = (value: number) => focal * Math.tan(value * GUIDE_STEP_DEGREES * Math.PI / 180);
  const x = width / 2, y = height / 2;
  return {
    vertical: { origin: [x, y], direction: [0, 1], ticks: GUIDE_TICKS.map(value => ({ value, at: [x, y + offset(value)] })) },
    horizontal: { origin: [x, y], direction: [1, 0], ticks: GUIDE_TICKS.map(value => ({ value, at: [x + offset(value), y] })) },
  };
}

// Sizes in pixels at a screen height of 1080, measured from the in-game lineup overlay.
const GUIDE = { thickness: 2, alpha: 0.9, tick: 24, label: 16, labelGap: 3, labelLead: 4 };

export function LineupGuide({ geometry, unit }: { geometry: GuideGeometry; unit: number }) {
  const ratio = window.devicePixelRatio || 1, scale = unit * ratio;
  const t = Math.max(1, Math.round(GUIDE.thickness * scale)), tick = Math.max(6, Math.round(GUIDE.tick * scale)) / 2;
  const font = Math.max(10 * ratio, GUIDE.label * scale), gap = GUIDE.labelGap * scale, lead = GUIDE.labelLead * scale;
  const device = ([x, y]: Point): Point => [Math.round(x * ratio), Math.round(y * ratio)];
  const strokes: [Point, Point][] = [], labels: { at: Point; text: string; vertical: boolean }[] = [];
  for (const [axis, vertical] of [[geometry.vertical, true], [geometry.horizontal, false]] as const) {
    if (!axis) continue;
    const [dx, dy] = axis.direction, [ox, oy] = device(axis.origin), far = 40000;
    strokes.push([[ox - dx * far, oy - dy * far], [ox + dx * far, oy + dy * far]]);
    // Ticks run across the line; labels sit right of the vertical line and below the horizontal one.
    const side: Point = (vertical ? -dy : dx) < 0 ? [dy, -dx] : [-dy, dx];
    for (const { value, at } of axis.ticks) {
      const [x, y] = device(at);
      strokes.push([[x - side[0] * tick, y - side[1] * tick], [x + side[0] * tick, y + side[1] * tick]]);
      const along = vertical ? 0 : -lead;
      labels.push({ at: [x + side[0] * (tick + gap) + dx * along, y + side[1] * (tick + gap) + dy * along], text: vertical ? `${-value}y` : `${value}x`, vertical });
    }
  }
  return <svg className="lineup-guide-lines" aria-hidden="true">
    <g transform={`scale(${1 / ratio})`}>
      <g opacity={GUIDE.alpha} stroke="white" strokeWidth={t} shapeRendering="crispEdges" strokeLinecap="butt">
        {strokes.map(([[x1, y1], [x2, y2]], index) => <line key={index} x1={x1} y1={y1} x2={x2} y2={y2} />)}
      </g>
      <g className="lineup-guide-labels" fontSize={font} strokeWidth={Math.max(1.5, 2 * scale)}>
        {labels.map(({ at: [x, y], text, vertical }, index) => <text key={index} x={x} y={y} dominantBaseline={vertical ? "central" : "hanging"}>{text}</text>)}
      </g>
    </g>
  </svg>;
}

// The lineup help over a review photo; `zoom` is the magnification applied to the photo around its centre.
export function PhotoLineupGuide({ src, zoom = 1 }: { src: string; zoom?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [aspect, setAspect] = useState<number | null>(null);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(box.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let live = true;
    const image = new Image();
    image.src = src;
    image.decode().then(() => { if (live) setAspect(image.naturalWidth / image.naturalHeight); }, () => {});
    return () => { live = false; };
  }, [src]);
  // The photo is shown with object-fit: contain, so its visible height may be smaller than the frame.
  const pictureHeight = size && aspect ? Math.min(size.height, size.width / aspect) : 0;
  return <div ref={box} className="lineup-guide" aria-hidden="true">
    {size && pictureHeight > 0 && <LineupGuide geometry={screenGuide(size.width, size.height, pictureHeight * zoom)} unit={pictureHeight / 1080} />}
  </div>;
}

const ICONS: Record<CrosshairStyle, React.ReactNode> = {
  fine: <path d="M8 2.5v11M2.5 8h11" strokeWidth="1.5" />,
  gap: <path d="M8 1.5v4M8 10.5v4M1.5 8h4M10.5 8h4" strokeWidth="2" />,
  lineup: <><rect x="1.5" y="1.5" width="13" height="13" rx="2" strokeWidth="1" opacity="0.5" /><path d="M8 1.5v13M1.5 8h13M6.5 4.5h3M6.5 11.5h3M4.5 6.5v3M11.5 6.5v3" strokeWidth="1.25" /></>,
};

export function CrosshairIcon({ style }: { style: CrosshairStyle }) {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">{ICONS[style]}</svg>;
}

export function CrosshairSwitch({ value, onChange }: { value: CrosshairStyle; onChange: (style: CrosshairStyle) => void }) {
  return <div className="crosshair-switch" role="group" aria-label="Fadenkreuz auswählen">
    {CROSSHAIRS.map(({ id, title }) => <button key={id} type="button" title={`Fadenkreuz: ${title}`} aria-label={`Fadenkreuz: ${title}`} aria-pressed={value === id} onClick={() => onChange(id)}>
      <CrosshairIcon style={id} /><span>{title}</span>
    </button>)}
  </div>;
}

import { useId, useState } from "react";
import { Crosshair, MapPin, RotateCcw, Target } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { isRadarPoint, type MapDefinition, type RadarPoint } from "../lib/maps";
import { cn } from "../lib/utils";
import { resolveRadarPoints, worldToRadar, type RadarCalibration } from "../lib/nade-radar";
import { radarCanvasSize, radarPointVisible, radarInputPoint, type RadarLevel } from "../lib/radar-layout";
import { RadarBackground } from "./radar-background";
import { RadarLevelSwitch } from "./radar-level-switch";

type RadarNade = {
  id?: string;
  name?: string;
  displayName?: string;
  lineupPos?: string;
  landingPos?: string;
  releasePos?: string;
  type?: string;
  throwFromTitle?: string;
  throwToTitle?: string;
  radarFrom?: RadarPoint | null;
  radarTo?: RadarPoint | null;
};

type NadeFlightMapProps = {
  map: MapDefinition;
  nades?: RadarNade[];
  compact?: boolean;
  className?: string;
  emptyMessage?: string;
  onMapClick?: (point: RadarPoint) => void;
  onSelectNade?: (nade: RadarNade) => void;
  calibration?: RadarCalibration | null;
  level?: RadarLevel;
  onLevelChange?: (level: RadarLevel) => void;
};

// Radar-Tinte aus docs/design-system.md; Werte stehen in styles/tokens.css.
const TYPE_COLORS = {
  Smoke: "var(--nade-smoke)",
  Flash: "var(--nade-flash)",
  HE: "var(--nade-he)",
  Molly: "var(--nade-molly)",
  Decoy: "var(--nade-decoy)"
};

function colorForType(type = "") {
  return TYPE_COLORS[type] || "var(--nade-other)";
}

function pixelPoint(point: RadarPoint, width: number, height: number) {
  return { x: point.x * width, y: point.y * height };
}

function flightPath(from: RadarPoint, to: RadarPoint, width: number, height: number) {
  const start = pixelPoint(from, width, height);
  const end = pixelPoint(to, width, height);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.max(Math.hypot(dx, dy), 1);
  const bend = Math.min(Math.max(length * 0.11, 18), 76);
  const controlX = (start.x + end.x) / 2 + (-dy / length) * bend;
  const controlY = (start.y + end.y) / 2 + (dx / length) * bend;
  return `M ${start.x} ${start.y} Q ${controlX} ${controlY} ${end.x} ${end.y}`;
}

export function NadeFlightMap({
  map,
  nades = [],
  compact = false,
  className,
  emptyMessage,
  onMapClick,
  onSelectNade,
  calibration = null,
  level,
  onLevelChange
}: NadeFlightMapProps) {
  const markerPrefix = useId().replace(/:/g, "");
  const [viewLevel, setViewLevel] = useState<RadarLevel>(() => {
    const points = resolveRadarPoints(nades[0] || {}, calibration);
    return points.radarFrom?.level || points.radarTo?.level || "upper";
  });
  const activeLevel = level ?? viewLevel;
  const { width, height } = radarCanvasSize(map);
  const markerRadius = Math.max(map.radarWidth || 1024, height) * (compact ? 0.009 : 0.011);
  const placedCount = nades.filter((nade) => { const p = resolveRadarPoints(nade, calibration); return p.radarFrom && p.radarTo; }).length;

  function handleMapClick(event: React.MouseEvent<SVGSVGElement>) {
    if (!onMapClick) return;
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    // SVG may letterbox a radar when the viewport limits its height.
    if (point.x < 0 || point.y < 0 || point.x > width || point.y > height) return;
    onMapClick(radarInputPoint(map, { x: point.x / width, y: point.y / height }, activeLevel));
  }

  if (!map.radarUrl) {
    return (
      <div className={cn("radar-map radar-map-empty", compact && "radar-map-compact", className)}>
        <MapPin aria-hidden="true" />
        <span>Für diese Map ist noch keine Radaransicht hinterlegt.</span>
      </div>
    );
  }

  return (
    <div className={cn("radar-map", compact && "radar-map-compact", onMapClick && "radar-map-editable", className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role={onSelectNade ? "group" : "img"}
        aria-label={`${map.name}: ${placedCount} Wurfwege auf dem Radar${map.radarLowerUrl ? activeLevel === "lower" ? " · Untere Ebene" : " · Obere Ebene" : ""}`}
        onClick={handleMapClick}
      >
        <RadarBackground map={map} level={activeLevel} />
        <defs>
          {Object.entries(TYPE_COLORS).map(([type, color]) => (
            <marker
              key={type}
              id={`${markerPrefix}-${type.toLowerCase()}`}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth={compact ? 5 : 6}
              markerHeight={compact ? 5 : 6}
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
            </marker>
          ))}
          <marker id={`${markerPrefix}-other`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--nade-other)" />
          </marker>
        </defs>
        <g className="radar-routes">
          {nades.map((nade, index) => {
            const resolved = resolveRadarPoints(nade, calibration);
            const points = { radarFrom: resolved.radarFrom && radarPointVisible(map, resolved.radarFrom, activeLevel) ? resolved.radarFrom : null,
              radarTo: resolved.radarTo && radarPointVisible(map, resolved.radarTo, activeLevel) ? resolved.radarTo : null };
            const from = points.radarFrom ? pixelPoint(points.radarFrom, width, height) : null;
            const to = points.radarTo ? pixelPoint(points.radarTo, width, height) : null;
            // After a run-up the grenade leaves elsewhere: feet path solid, flight dashed from the release spot.
            const releasePoint = from && nade.releasePos ? worldToRadar(nade.releasePos, calibration) : null;
            const release = releasePoint && radarPointVisible(map, releasePoint, activeLevel) ? releasePoint : null;
            const releasePixel = release ? pixelPoint(release, width, height) : null;
            const runUp = from && releasePixel && Math.hypot(releasePixel.x - from.x, releasePixel.y - from.y) > markerRadius * 1.5 ? releasePixel : null;
            const flightFrom = runUp ? release! : points.radarFrom;
            const color = colorForType(nade.type);
            const markerId = TYPE_COLORS[nade.type || ""] ? `${markerPrefix}-${String(nade.type).toLowerCase()}` : `${markerPrefix}-other`;
            const title = `${nade.displayName || nade.name || `Nade ${index + 1}`}: ${nade.throwFromTitle || "Start"} → ${nade.throwToTitle || "Ziel"}`;
            return (
              <g
                key={nade.id || `${nade.name}-${index}`}
                className={cn("radar-route", onSelectNade && "radar-route-selectable")}
                style={{ "--route-color": color } as React.CSSProperties}
                role={onSelectNade && (from || to) ? "button" : undefined}
                tabIndex={onSelectNade && (from || to) ? 0 : undefined}
                aria-label={onSelectNade && (from || to) ? title : undefined}
                onKeyDown={onSelectNade && (from || to) ? event => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectNade(nade);
                  }
                } : undefined}
                onClick={onSelectNade ? (event) => {
                  event.stopPropagation();
                  onSelectNade(nade);
                } : undefined}
              >
                <title>{title}</title>
                {from && runUp ? (
                  <>
                    <line className="radar-runup-halo" x1={from.x} y1={from.y} x2={runUp.x} y2={runUp.y} />
                    <line className="radar-runup" x1={from.x} y1={from.y} x2={runUp.x} y2={runUp.y} />
                    <circle className="radar-release" cx={runUp.x} cy={runUp.y} r={markerRadius * 0.35} />
                  </>
                ) : null}
                {from && to ? (
                  <>
                    <path className="radar-route-halo" d={flightPath(flightFrom!, points.radarTo!, width, height)} />
                    <path className="radar-route-line" d={flightPath(flightFrom!, points.radarTo!, width, height)} markerEnd={`url(#${markerId})`} />
                  </>
                ) : null}
                {from ? (
                  <g transform={`translate(${from.x} ${from.y})`}>
                    <circle className="radar-origin-ring" r={markerRadius * 1.05} />
                    <circle className="radar-origin" r={markerRadius * 0.7} />
                    {!compact && nades.length > 1 ? <text className="radar-marker-label" y={markerRadius * 0.32}>{index + 1}</text> : null}
                  </g>
                ) : null}
                {to ? (
                  <g transform={`translate(${to.x} ${to.y}) rotate(45)`}>
                    <rect className="radar-target-ring" x={-markerRadius * 1.25} y={-markerRadius * 1.25} width={markerRadius * 2.5} height={markerRadius * 2.5} rx={markerRadius * 0.3} />
                    <rect className="radar-target" x={-markerRadius * 0.78} y={-markerRadius * 0.78} width={markerRadius * 1.56} height={markerRadius * 1.56} rx={markerRadius * 0.18} />
                  </g>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>
      {map.radarLowerUrl && <RadarLevelSwitch level={activeLevel} onChange={onLevelChange ?? setViewLevel} />}
      {emptyMessage && placedCount === 0 ? <div className="radar-map-message">{emptyMessage}</div> : null}
    </div>
  );
}

type NadePlacementEditorProps = {
  map?: MapDefinition;
  calibration?: RadarCalibration | null;
  value: {
    id?: string;
    name?: string;
    displayName?: string;
    lineupPos?: string;
    landingPos?: string;
    type?: string;
    throwFromTitle?: string;
    throwToTitle?: string;
    radarFrom?: RadarPoint | null;
    radarTo?: RadarPoint | null;
  };
  onChange: (patch: { radarFrom?: RadarPoint | null; radarTo?: RadarPoint | null }) => void;
};

export function NadePlacementEditor({ map, value, onChange, calibration = null }: NadePlacementEditorProps) {
  const [mode, setMode] = useState<"from" | "to">(() => {
    const points = resolveRadarPoints(value, calibration);
    return points.radarFrom && !points.radarTo ? "to" : "from";
  });
  const points = resolveRadarPoints(value, calibration);
  const [level, setLevel] = useState<RadarLevel>(() => {
    const points = resolveRadarPoints(value, calibration);
    return (mode === "to" ? points.radarTo : points.radarFrom)?.level || "upper";
  });

  function chooseMode(nextMode: "from" | "to") {
    setMode(nextMode);
    const point = nextMode === "from" ? points.radarFrom : points.radarTo;
    if (point?.level) setLevel(point.level);
  }

  function place(point: RadarPoint) {
    const rounded = { x: Number(point.x.toFixed(6)), y: Number(point.y.toFixed(6)), ...(point.level && { level: point.level }) };
    if (mode === "from") {
      onChange({ radarFrom: rounded });
      setMode("to");
      if (points.radarTo?.level) setLevel(points.radarTo.level);
    } else {
      onChange({ radarTo: rounded });
    }
  }

  if (!map) {
    return <div className="radar-placement-empty">Wähle eine bekannte Map, um den Wurf zu platzieren.</div>;
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant={mode === "from" ? "default" : "secondary"} onClick={() => chooseMode("from")}>
            <Crosshair data-icon="inline-start" />Start setzen
          </Button>
          <Button type="button" size="sm" variant={mode === "to" ? "default" : "secondary"} onClick={() => chooseMode("to")}>
            <Target data-icon="inline-start" />Ziel setzen
          </Button>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange({ radarFrom: null, radarTo: null })}>
          <RotateCcw data-icon="inline-start" />{calibration ? "Automatische Positionen" : "Markierungen entfernen"}
        </Button>
      </div>
      <NadeFlightMap map={map} nades={[value]} calibration={calibration} onMapClick={place} level={level} onLevelChange={setLevel} />
      <div className="radar-placement-status">
        <span><i className={cn("radar-status-dot", points.radarFrom && "radar-status-dot-ready")} />Start {value.radarFrom ? "manuell" : points.radarFrom ? "automatisch" : "fehlt"}</span>
        <span><i className={cn("radar-status-diamond", points.radarTo && "radar-status-dot-ready")} />Ziel {value.radarTo ? "manuell" : points.radarTo ? "automatisch" : "fehlt"}</span>
        <Badge variant="outline">{mode === "from" ? "Start" : "Ziel"} per Klick auf die Karte setzen</Badge>
      </div>
    </div>
  );
}

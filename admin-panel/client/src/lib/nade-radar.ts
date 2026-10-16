import { isRadarPoint, mapMatchesNade, type MapDefinition, type RadarPoint } from "./maps.js";
import { BUNDLED_RADAR_CALIBRATIONS } from "./bundled-radar-calibrations.js";

type RadarProjection = { xScale: number; xOffset: number; yScale: number; yOffset: number };
export type RadarCalibration = RadarProjection & { altitudeSplit?: number; lower?: RadarProjection };
export type PositionedNade = {
  lineupPos?: string; landingPos?: string; releasePos?: string;
  radarFrom?: RadarPoint | null; radarTo?: RadarPoint | null;
};

// Valve overview: pos_x=-2796, pos_y=3328, scale=5.22 (1024px).
// The bundled CSNADES Anubis image crops/resizes that overview. Registration against
// the extracted game radar (94 matching features) gives this pixel transform.
// Source: https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/data/radar_info/de_anubis.txt
const ANUBIS_RADAR: RadarCalibration = {
  xScale: 2.07353388 / (5.22 * 2048), xOffset: (2796 / 5.22 * 2.07353388 - 46.5108868) / 2048,
  yScale: -2.07353388 / (5.22 * 2048), yOffset: (3328 / 5.22 * 2.07353388 - 25.9679913) / 2048,
};

// CS2 overview: pos_x=-3453, pos_y=2887, scale=7, lower below z=-495.
// Register each cropped CSNADES image against Valve's extracted 1024px radar.
// Upper: 15 matching features, maximum axis residual 3.36px; lower: 9, 2.35px.
// https://github.com/MurkyYT/cs2-map-icons/blob/main/data/radar_info/de_nuke.txt
const NUKE_RADAR: RadarCalibration = {
  xScale: 1.605056794 / (7 * 1558), xOffset: (3453 / 7 * 1.605056794 - 70.702638359) / 1558,
  yScale: -1.606974478 / (7 * 848), yOffset: (2887 / 7 * 1.606974478 - 419.172130276) / 848,
  altitudeSplit: -495,
  lower: {
    xScale: 1.620856688 / (7 * 1558), xOffset: (3453 / 7 * 1.620856688 - 76.344960301) / 1558,
    yScale: -1.615787574 / (7 * 848), yOffset: (2887 / 7 * 1.615787574 - 424.497446568) / 848,
  },
};

function coordinates(value: string | undefined) {
  const parts = String(value || "").trim().split(/\s+/).map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? parts : null;
}

// The bundled CSNADES images are cropped, not Valve's square overview textures.
// Calibrate against saved manual references on this exact image instead of guessing its bounds.
export function inferRadarCalibration(map: MapDefinition, nades: (PositionedNade & { map?: string })[]): RadarCalibration | null {
  // Fixed transforms apply only to the exact bundled images and their dimensions.
  if (map.mapName === "de_nuke") return map.radarUrl === "/maps/nuke.webp"
    && map.radarLowerUrl === "/maps/nuke-lower.webp" && map.radarWidth === 1558 && map.radarHeight === 848 ? NUKE_RADAR : null;
  if (map.mapName === "de_anubis" && map.radarUrl === "/maps/anubis.webp"
    && map.radarWidth === 2048 && map.radarHeight === 2048) return ANUBIS_RADAR;
  const bundled = BUNDLED_RADAR_CALIBRATIONS.find(entry => entry.mapName === map.mapName
    && entry.radarUrl === map.radarUrl && entry.radarWidth === map.radarWidth && entry.radarHeight === map.radarHeight
    && ("radarLowerUrl" in entry ? entry.radarLowerUrl : undefined) === map.radarLowerUrl);
  if (bundled) return bundled.projection;
  const refs: { world: number[]; radar: RadarPoint }[] = [];
  for (const nade of nades.filter(n => mapMatchesNade(map, n.map || ""))) {
    for (const [pos, point] of [[nade.lineupPos, nade.radarFrom], [nade.landingPos, nade.radarTo]] as const) {
      const world = coordinates(pos);
      if (world && isRadarPoint(point)) refs.push({ world, radar: point });
    }
  }
  if (refs.length < 2) return null;
  function fit(axis: 0 | 1, key: "x" | "y") {
    const meanWorld = refs.reduce((sum, r) => sum + r.world[axis], 0) / refs.length;
    const meanRadar = refs.reduce((sum, r) => sum + r.radar[key], 0) / refs.length;
    const spanWorld = Math.max(...refs.map(r => r.world[axis])) - Math.min(...refs.map(r => r.world[axis]));
    const spanRadar = Math.max(...refs.map(r => r.radar[key])) - Math.min(...refs.map(r => r.radar[key]));
    if (spanWorld < 256 || spanRadar < 0.1) return null;
    const variance = refs.reduce((sum, r) => sum + (r.world[axis] - meanWorld) ** 2, 0);
    const scale = refs.reduce((sum, r) => sum + (r.world[axis] - meanWorld) * (r.radar[key] - meanRadar), 0) / variance;
    const offset = meanRadar - scale * meanWorld;
    if (!Number.isFinite(scale) || (axis === 0 ? scale <= 0 : scale >= 0)) return null;
    // Inconsistent references must be corrected, never silently used to place more markers.
    if (refs.some(r => Math.abs(r.world[axis] * scale + offset - r.radar[key]) > 0.02)) return null;
    return { scale, offset };
  }
  const x = fit(0, "x"), y = fit(1, "y");
  return x && y ? { xScale: x.scale, xOffset: x.offset, yScale: y.scale, yOffset: y.offset } : null;
}

export function worldToRadar(position: string | undefined, calibration: RadarCalibration | null): RadarPoint | null {
  const world = coordinates(position);
  return world ? worldPointToRadar(calibration, world[0], world[1], world[2]) : null;
}

export function worldPointToRadar(calibration: RadarCalibration | null, x: number, y: number, z: number): RadarPoint | null {
  if (!calibration) return null;
  const level = calibration.altitudeSplit === undefined ? undefined : z < calibration.altitudeSplit ? "lower" : "upper";
  const projection = level === "lower" ? calibration.lower : calibration;
  if (!projection) return null;
  const point: RadarPoint = { x: x * projection.xScale + projection.xOffset, y: y * projection.yScale + projection.yOffset,
    ...(level && { level }) };
  // Do not clamp off-map coordinates onto a false point on the image edge.
  return isRadarPoint(point) ? point : null;
}

export function resolveRadarPoints(nade: PositionedNade, calibration: RadarCalibration | null) {
  function resolve(manual: RadarPoint | null | undefined, position: string | undefined) {
    if (!isRadarPoint(manual)) return worldToRadar(position, calibration);
    // Legacy manual points keep their XY; infer only the previously unstored floor.
    const world = coordinates(position);
    const level = manual.level ?? (calibration?.altitudeSplit !== undefined && world
      ? world[2] < calibration.altitudeSplit ? "lower" : "upper" : undefined);
    return level ? { ...manual, level } : manual;
  }
  return {
    radarFrom: resolve(nade.radarFrom, nade.lineupPos),
    radarTo: resolve(nade.radarTo, nade.landingPos)
  };
}

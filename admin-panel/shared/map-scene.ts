// Map scenes are exported by Source 2 Viewer, which converts Source units to metres and
// rotates Z-up into glTF's Y-up: scene = (source.y, source.z, source.x) * 0.0254.
export const SOURCE_UNIT_METRES = 0.0254;
// CS2 view offsets above the player's origin.
export const EYE_HEIGHT = { standing: 64, crouching: 46 };
// fov 90 is defined for 4:3; at 16:9 CS2 keeps the vertical field of view.
export const VERTICAL_FOV_DEGREES = 2 * Math.atan(Math.tan(Math.PI / 4) * 3 / 4) * 180 / Math.PI;
export const MAP_SCENE_NAME = /^[a-z0-9_]{1,64}$/;

export type Vector3 = [number, number, number];

export function parseSourceVector(value: unknown): Vector3 | null {
  const parts = String(value ?? "").trim().split(/[\s,]+/).map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? parts as Vector3 : null;
}

export function sourceToScene([x, y, z]: Vector3): Vector3 {
  return [y * SOURCE_UNIT_METRES, z * SOURCE_UNIT_METRES, x * SOURCE_UNIT_METRES];
}

export function sourceForward(pitch: number, yaw: number): Vector3 {
  const p = pitch * Math.PI / 180, y = yaw * Math.PI / 180;
  return [Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), -Math.sin(p)];
}

// Lineups store the origin 4 units up where the player aims. Lineups without a recorded trace can
// still sit mid-air (old jumpthrows); loading drops the player to the floor below, so the camera stands there.
export const MAX_FLOOR_DROP = 128;

// Camera where the lineup is aimed: on the floor (source z) when known, looking along the eye angles.
export function lineupCamera(nade: { lineupPos?: string; lineupAng?: string; is_crouch?: boolean }, floor: number | null = null) {
  const position = parseSourceVector(nade.lineupPos), angles = parseSourceVector(nade.lineupAng);
  if (!position || !angles) return null;
  const base = floor !== null && floor <= position[2] + 8 && position[2] - floor <= MAX_FLOOR_DROP ? floor : position[2];
  const eye: Vector3 = [position[0], position[1], base + (nade.is_crouch ? EYE_HEIGHT.crouching : EYE_HEIGHT.standing)];
  return { position: sourceToScene(position), eye: sourceToScene(eye), forward: sourceToScene(sourceForward(angles[0], angles[1])).map(value => value / SOURCE_UNIT_METRES) as Vector3 };
}

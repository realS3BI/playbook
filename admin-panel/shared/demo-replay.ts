import { roundEnd, type DemoEvent, type GrenadePath, type PlayerFrame, type PlayerLoadout, type RoundReplay } from "./demos.js";

// Frames are stored every 8 ticks. Gaps longer than this are pauses or missing data, not movement.
const MAX_FRAME_GAP = 0.5;
// Respawns and teleports jump further than anyone moves between two frames.
const MAX_FRAME_STEP = 100;

/** Shortest turn from one yaw to another, so 179° to −179° turns by 2° instead of 358°. */
export function lerpAngle(from: number, to: number, fraction: number) {
  const delta = ((((to - from) % 360) + 540) % 360) - 180;
  return from + delta * fraction;
}

export function frameAt(replay: RoundReplay, time: number): PlayerFrame[] {
  let low = 0,
    high = replay.frames.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (replay.frames[mid].time <= time) low = mid;
    else high = mid - 1;
  }
  const a = replay.frames[low],
    b = replay.frames[low + 1];
  if (!a || a.time > time + MAX_FRAME_GAP) return [];
  if (!b || b.time - a.time > MAX_FRAME_GAP) return a.players;
  const fraction = Math.max(0, Math.min(1, (time - a.time) / (b.time - a.time)));
  return a.players.map((player) => {
    const next = b.players.find((candidate) => candidate.id === player.id);
    if (
      !next ||
      next.side !== player.side ||
      player.health <= 0 ||
      next.health <= 0 ||
      Math.hypot(next.x - player.x, next.y - player.y) > MAX_FRAME_STEP
    )
      return player;
    return {
      ...player,
      x: player.x + (next.x - player.x) * fraction,
      y: player.y + (next.y - player.y) * fraction,
      z: player.z + (next.z - player.z) * fraction,
      yaw: lerpAngle(player.yaw, next.yaw, fraction),
      ...(player.pitch !== undefined &&
        next.pitch !== undefined && { pitch: player.pitch + (next.pitch - player.pitch) * fraction }),
      ...((player.duck || next.duck) && { duck: (player.duck || 0) + ((next.duck || 0) - (player.duck || 0)) * fraction }),
    };
  });
}

export function loadoutsById(replay: RoundReplay) {
  const result = new Map<string, PlayerLoadout[]>();
  for (const loadout of replay.loadouts || []) {
    const list = result.get(loadout.id) || [];
    list.push(loadout);
    result.set(loadout.id, list);
  }
  return result;
}

export function loadoutAt(list: PlayerLoadout[] | undefined, time: number) {
  let found: PlayerLoadout | undefined;
  for (const entry of list || []) {
    if (entry.time > time) break;
    found = entry;
  }
  return found;
}

export type BombState =
  | { kind: "carried"; playerId: string }
  | { kind: "dropped" | "planted" | "defused" | "exploded"; x: number; y: number; z: number };

export function bombAt(
  replay: RoundReplay,
  time: number,
  players: PlayerFrame[],
  carrier: string | undefined,
): BombState | null {
  const positionOf = (event: DemoEvent) => {
    if (event.x !== undefined && event.y !== undefined && event.z !== undefined)
      return { x: event.x, y: event.y, z: event.z };
    const player = frameAt(replay, event.time).find((entry) => entry.id === event.playerId);
    return player ? { x: player.x, y: player.y, z: player.z } : null;
  };
  const past = replay.events.filter((event) => event.kind.startsWith("bomb_") && event.time <= time);
  const plant = [...past].reverse().find((event) => event.kind === "bomb_planted");
  if (plant) {
    const position = positionOf(plant);
    const outcome = [...past].reverse().find((event) => event.kind === "bomb_defused" || event.kind === "bomb_exploded");
    return position && {
      kind: outcome?.kind === "bomb_defused" ? "defused" : outcome ? "exploded" : "planted",
      ...position,
    };
  }
  if (carrier && players.some((player) => player.id === carrier && player.health > 0))
    return { kind: "carried", playerId: carrier };
  const last = [...past].reverse().find((event) => event.kind === "bomb_dropped" || event.kind === "bomb_pickup");
  if (last?.kind !== "bomb_dropped") return null;
  const position = positionOf(last);
  return position && { kind: "dropped", ...position };
}

export type AreaEffect = {
  key: string;
  kind: "smoke" | "fire";
  start: number;
  end: number;
  x: number;
  y: number;
  z: number;
};

/** Smokes and fires with their visible interval. Without an end event they last their usual duration. */
export function areaEffects(replay: RoundReplay): AreaEffect[] {
  return replay.events.flatMap((event, index) => {
    if (
      !["smokegrenade_detonate", "inferno_startburn"].includes(event.kind) ||
      event.x === undefined ||
      event.y === undefined ||
      event.z === undefined
    )
      return [];
    const smoke = event.kind === "smokegrenade_detonate";
    const end = replay.events.find(
      (candidate) =>
        candidate.kind === (smoke ? "smokegrenade_expired" : "inferno_expire") &&
        candidate.entityId === event.entityId &&
        candidate.time >= event.time,
    );
    return [{
      key: `${event.kind}-${event.entityId ?? index}-${event.tick}`,
      kind: smoke ? "smoke" : "fire",
      start: event.time,
      end: end?.time ?? Math.min(roundEnd(replay.round), event.time + (smoke ? 20 : 7)),
      x: event.x,
      y: event.y,
      z: event.z,
    }];
  });
}

/** Where a grenade is in flight at `time`, between its sampled points. */
export function grenadeAt(grenade: GrenadePath, time: number) {
  const points = grenade.points;
  if (!points.length || time < points[0].time || time > points.at(-1)!.time) return null;
  let index = 0;
  while (index < points.length - 1 && points[index + 1].time <= time) index++;
  const a = points[index],
    b = points[index + 1];
  if (!b) return { x: a.x, y: a.y, z: a.z, index };
  const fraction = (time - a.time) / Math.max(0.001, b.time - a.time);
  return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction, z: a.z + (b.z - a.z) * fraction, index };
}

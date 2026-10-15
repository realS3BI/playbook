import type { DemoPlayer, DemoSummary, RoundBuy, RoundReplay } from "./demos.js";
import { frameAt } from "./demo-replay.js";

// Bump when the stored shape or its contents change; cached files of older versions are rebuilt.
export const INSIGHTS_VERSION = 1;

export type Point3 = [number, number, number];
export type UtilityKind = "smoke" | "flash" | "molotov" | "he" | "decoy";
export type InsightRound = {
  id: string;
  number: number;
  winner: number;
  duration: number;
  buy: { t?: RoundBuy; ct?: RoundBuy };
  /** Side of every player at freeze end. */
  sides: Record<string, number>;
  /** Once per second while alive, from freeze end to round end: time, x, y, z, time, x, y, z … */
  tracks: Record<string, number[]>;
  deaths: { time: number; victimId: string; killerId: string; weapon: string; at: Point3; from?: Point3 }[];
  utility: { time: number; kind: UtilityKind; playerId: string; from: Point3; to: Point3 }[];
  plant?: { time: number; playerId: string; at: Point3 };
};
/** Compact per-demo data for comparisons across demos: positions, kills, utility and plants. */
export type DemoInsights = {
  version: number;
  demoId: string;
  map: string;
  players: DemoPlayer[];
  rounds: InsightRound[];
};

const whole = (x: number, y: number, z: number): Point3 => [Math.round(x), Math.round(y), Math.round(z)];
const tenth = (value: number) => Math.round(value * 10) / 10;

export function utilityKind(kind: string): UtilityKind | null {
  return /smoke/i.test(kind) ? "smoke"
    : /flash/i.test(kind) ? "flash"
    : /molotov|incend/i.test(kind) ? "molotov"
    : /hegrenade|he_grenade|^he$/i.test(kind) ? "he"
    : /decoy/i.test(kind) ? "decoy"
    : null;
}

export function roundInsights(replay: RoundReplay): InsightRound {
  const { round } = replay;
  const start = replay.frames.find((frame) => frame.time >= 0) || replay.frames[0];
  const tracks: Record<string, number[]> = {};
  const sampled = new Map<string, number>();
  for (const frame of replay.frames) {
    if (frame.time < 0 || frame.time > round.duration) continue;
    const second = Math.floor(frame.time);
    for (const player of frame.players) {
      if (player.health <= 0 || sampled.get(player.id) === second) continue;
      sampled.set(player.id, second);
      (tracks[player.id] ||= []).push(tenth(frame.time), ...whole(player.x, player.y, player.z));
    }
  }
  const deaths: InsightRound["deaths"] = [];
  for (const event of replay.events) {
    if (event.kind !== "player_death" || !event.targetId) continue;
    // Just before the kill the victim still stands where the duel happened.
    const victim = frameAt(replay, event.time - 0.1).find((player) => player.id === event.targetId);
    if (!victim) continue;
    const killer = event.playerId && event.playerId !== event.targetId
      ? frameAt(replay, event.time).find((player) => player.id === event.playerId)
      : undefined;
    deaths.push({
      time: tenth(event.time),
      victimId: event.targetId,
      killerId: event.playerId === event.targetId ? "" : event.playerId,
      weapon: event.weapon || "",
      at: whole(victim.x, victim.y, victim.z),
      ...(killer && { from: whole(killer.x, killer.y, killer.z) }),
    });
  }
  const utility: InsightRound["utility"] = [];
  for (const path of replay.grenades) {
    const kind = utilityKind(path.kind), first = path.points[0], last = path.points.at(-1);
    if (!kind || !first || !last || !path.playerId) continue;
    utility.push({ time: tenth(first.time), kind, playerId: path.playerId, from: whole(first.x, first.y, first.z), to: whole(last.x, last.y, last.z) });
  }
  const plant = replay.events.find((event) => event.kind === "bomb_planted" && event.x !== undefined);
  return {
    id: round.id,
    number: round.number,
    winner: round.winner,
    duration: round.duration,
    buy: { ...(round.economy?.t && { t: round.economy.t.buy }), ...(round.economy?.ct && { ct: round.economy.ct.buy }) },
    sides: Object.fromEntries((start?.players || []).map((player) => [player.id, player.side])),
    tracks,
    deaths,
    utility,
    ...(plant && { plant: { time: tenth(plant.time), playerId: plant.playerId, at: whole(plant.x!, plant.y!, plant.z!) } }),
  };
}

export function demoInsights(demoId: string, summary: DemoSummary, replays: RoundReplay[]): DemoInsights {
  return { version: INSIGHTS_VERSION, demoId, map: summary.map, players: summary.players, rounds: replays.map(roundInsights) };
}

export type Lineup = { players: string[]; won: number; lost: number };

/**
 * The two teams of a demo. Teams are the players on one side in the first round; they keep
 * together through side switches, and later joiners belong to the team on their side.
 */
export function demoLineups(insights: DemoInsights): Lineup[] {
  const first = insights.rounds.find((round) => Object.keys(round.sides).length);
  if (!first) return [];
  const teams = [2, 3].map((side) => ({
    players: new Set(Object.keys(first.sides).filter((id) => first.sides[id] === side)),
    won: 0,
    lost: 0,
  }));
  for (const round of insights.rounds) {
    const side = teamSide(round, teams[0].players);
    if (!side) continue;
    for (const [id, playerSide] of Object.entries(round.sides))
      if (!teams[0].players.has(id) && !teams[1].players.has(id)) teams[playerSide === side ? 0 : 1].players.add(id);
    if (round.winner !== 2 && round.winner !== 3) continue;
    teams[round.winner === side ? 0 : 1].won++;
    teams[round.winner === side ? 1 : 0].lost++;
  }
  return teams.map((team) => ({ players: [...team.players], won: team.won, lost: team.lost }));
}

/** The side most of these players were on in this round, or 0 if none of them played it. */
export function teamSide(round: InsightRound, players: Set<string> | string[]) {
  let t = 0, ct = 0;
  for (const id of players) {
    if (round.sides[id] === 2) t++;
    else if (round.sides[id] === 3) ct++;
  }
  return t > ct ? 2 : ct > t ? 3 : 0;
}

// A team keeps its identity with a substitute or two; three shared players are the same team.
export const SAME_TEAM = 3;
const overlap = (a: Set<string>, b: Iterable<string>) => {
  let count = 0;
  for (const id of b) if (a.has(id)) count++;
  return count;
};

export type LineupSource = { demoId: string; lineup: Lineup };
export type LineupCluster = { core: string[]; appearances: Map<string, number>; members: LineupSource[] };

/** Groups lineups of different demos that share at least three players. */
export function clusterLineups(sources: LineupSource[]): LineupCluster[] {
  const parent = sources.map((_, index) => index);
  const find = (index: number): number => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  const sets = sources.map((source) => new Set(source.lineup.players));
  for (let a = 0; a < sources.length; a++)
    for (let b = a + 1; b < sources.length; b++)
      if (sources[a].demoId !== sources[b].demoId && overlap(sets[a], sets[b]) >= SAME_TEAM) parent[find(a)] = find(b);
  const groups = new Map<number, LineupSource[]>();
  sources.forEach((source, index) => groups.set(find(index), [...(groups.get(find(index)) || []), source]));
  return [...groups.values()].map((members) => {
    const appearances = new Map<string, number>();
    for (const member of members) for (const id of member.lineup.players) appearances.set(id, (appearances.get(id) || 0) + 1);
    const ranked = [...appearances].sort((a, b) => b[1] - a[1]);
    // Regulars played at least half of the demos; never fewer than the five most frequent.
    const regulars = ranked.filter(([, count]) => count * 2 >= members.length).map(([id]) => id);
    const core = (regulars.length >= 5 ? regulars : ranked.slice(0, 5).map(([id]) => id)).slice(0, 7);
    return { core, appearances, members };
  });
}

/** Lineups of a demo that belong to the given players. */
export function lineupOf(lineups: Lineup[], players: string[]) {
  const wanted = new Set(players);
  const needed = Math.min(SAME_TEAM, wanted.size);
  return lineups.map((lineup) => ({ lineup, shared: overlap(wanted, lineup.players) }))
    .filter(({ shared }) => shared >= needed)
    .sort((a, b) => b.shared - a.shared)[0]?.lineup;
}

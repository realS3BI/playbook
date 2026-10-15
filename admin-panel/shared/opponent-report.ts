import type { RoundBuy } from "./demos.js";
import { economyOptions } from "./strats.js";
import { teamSide, type DemoInsights, type InsightRound, type Point3, type UtilityKind } from "./demo-insights.js";

export type OpponentPlayer = { id: string; name: string; demos: number };
export type OpponentDemo = { id: string; title: string; map: string; date: string; team: string[]; won: number; lost: number };
/** A team found in several demos by its players. */
export type DetectedTeam = {
  key: string;
  name: string;
  own: boolean;
  core: string[];
  players: OpponentPlayer[];
  demos: OpponentDemo[];
};
export type OpponentReport = {
  name: string;
  own: boolean;
  players: OpponentPlayer[];
  demos: OpponentDemo[];
  insights: DemoInsights[];
};

export type TeamRound = {
  demoId: string;
  map: string;
  round: InsightRound;
  /** Side of the analysed team in this round. */
  side: number;
  won: boolean;
  buy?: RoundBuy;
  team: Set<string>;
};

export function teamRounds(report: OpponentReport): TeamRound[] {
  const demos = new Map(report.demos.map((demo) => [demo.id, demo]));
  return report.insights.flatMap((insights) => {
    const demo = demos.get(insights.demoId);
    if (!demo) return [];
    const team = new Set(demo.team);
    return insights.rounds.flatMap((round) => {
      const side = teamSide(round, team);
      if (!side) return [];
      return [{
        demoId: insights.demoId,
        map: insights.map,
        round,
        side,
        won: round.winner === side,
        buy: side === 2 ? round.buy.t : round.buy.ct,
        team,
      }];
    });
  });
}

type Tally = { rounds: number; won: number };
const tally = (rounds: TeamRound[]): Tally => ({ rounds: rounds.length, won: rounds.filter((round) => round.won).length });

export type MapRecord = { map: string; matches: number; wins: number; losses: number; all: Tally; t: Tally; ct: Tally; pistol: Tally };

/** Results per map, most played first. */
export function mapPool(report: OpponentReport, rounds: TeamRound[]): MapRecord[] {
  const maps = [...new Set(report.demos.map((demo) => demo.map))];
  return maps.map((map) => {
    const demos = report.demos.filter((demo) => demo.map === map);
    const played = rounds.filter((round) => round.map === map);
    return {
      map,
      matches: demos.length,
      wins: demos.filter((demo) => demo.won > demo.lost).length,
      losses: demos.filter((demo) => demo.won < demo.lost).length,
      all: tally(played),
      t: tally(played.filter((round) => round.side === 2)),
      ct: tally(played.filter((round) => round.side === 3)),
      pistol: tally(played.filter((round) => round.buy === "pistol")),
    };
  }).sort((a, b) => b.matches - a.matches || b.all.rounds - a.all.rounds);
}

/** The first kill of a round after freeze end, if any. */
export function openingKill(round: InsightRound) {
  return round.deaths.filter((death) => death.time >= 0).sort((a, b) => a.time - b.time)[0];
}

export type PlayerProfile = OpponentPlayer & {
  rounds: number;
  kills: number;
  deaths: number;
  openingKills: number;
  openingDeaths: number;
  utility: number;
  weapon: string;
};

export function playerProfiles(report: OpponentReport, rounds: TeamRound[]): PlayerProfile[] {
  return report.players.map((player) => {
    const profile: PlayerProfile = { ...player, rounds: 0, kills: 0, deaths: 0, openingKills: 0, openingDeaths: 0, utility: 0, weapon: "" };
    const weapons = new Map<string, number>();
    for (const { round, side } of rounds) {
      if (!round.sides[player.id]) continue;
      profile.rounds++;
      for (const death of round.deaths) {
        // Team kills and suicides count as deaths, never as kills.
        if (death.killerId === player.id && round.sides[death.victimId] && round.sides[death.victimId] !== side) {
          profile.kills++;
          weapons.set(death.weapon, (weapons.get(death.weapon) || 0) + 1);
        }
        if (death.victimId === player.id) profile.deaths++;
      }
      const opening = openingKill(round);
      if (opening?.killerId === player.id) profile.openingKills++;
      if (opening?.victimId === player.id) profile.openingDeaths++;
      profile.utility += round.utility.filter((item) => item.playerId === player.id && item.kind !== "decoy").length;
    }
    profile.weapon = [...weapons].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    return profile;
  });
}

export type Window = "all" | "early" | "mid" | "late" | "planted";
export const WINDOWS: { value: Window; label: string; from: number; to: number }[] = [
  { value: "all", label: "Ganze Runde", from: 0, to: Infinity },
  { value: "early", label: "Erste 20 Sekunden", from: 0, to: 20 },
  { value: "mid", label: "20 bis 60 Sekunden", from: 20, to: 60 },
  { value: "late", label: "Ab 60 Sekunden", from: 60, to: Infinity },
  { value: "planted", label: "Nach dem Plant", from: 0, to: Infinity },
];
export type Filters = { map: string; side: number; window: Window; playerId: string; buy: RoundBuy | "" };

export function selectRounds(rounds: TeamRound[], filters: Filters) {
  return rounds.filter((round) =>
    round.map === filters.map &&
    round.side === filters.side &&
    (!filters.buy || round.buy === filters.buy) &&
    (filters.window !== "planted" || !!round.round.plant));
}

function inWindow(round: InsightRound, time: number, window: Window) {
  if (window === "planted") return !!round.plant && time >= round.plant.time;
  const range = WINDOWS.find((entry) => entry.value === window)!;
  return time >= range.from && time < range.to;
}

const wanted = (team: Set<string>, playerId: string, id: string) => (playerId ? id === playerId : team.has(id));

/** Every second a player of the team spent alive, as world positions. */
export function heatPoints(rounds: TeamRound[], filters: Filters): Point3[] {
  const points: Point3[] = [];
  for (const { round, team } of rounds)
    for (const [id, track] of Object.entries(round.tracks)) {
      if (!wanted(team, filters.playerId, id)) continue;
      for (let index = 0; index < track.length; index += 4)
        if (inWindow(round, track[index], filters.window)) points.push([track[index + 1], track[index + 2], track[index + 3]]);
    }
  return points;
}

export type Example = { demoId: string; roundId: string; time: number; playerId: string };
export type UtilityGroup = {
  kind: UtilityKind;
  at: Point3;
  throws: { from: Point3; to: Point3 }[];
  rounds: number;
  time: number;
  players: string[];
  example: Example;
};

// Landings this close count as the same spot; a smoke covers about 144 units around its centre.
const SPOT_RADIUS = 160;
const SPOT_HEIGHT = 120;
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 0;
};

/** Utility landing in the same spot across rounds, most frequent first. */
export function utilityGroups(rounds: TeamRound[], filters: Filters): UtilityGroup[] {
  type Group = { kind: UtilityKind; sum: Point3; items: { item: InsightRound["utility"][number]; round: TeamRound }[] };
  const groups: Group[] = [];
  const items = rounds.flatMap((round) => round.round.utility
    .filter((item) => item.kind !== "decoy" && wanted(round.team, filters.playerId, item.playerId) && inWindow(round.round, item.time, filters.window))
    .map((item) => ({ item, round })));
  for (const entry of items.sort((a, b) => a.item.time - b.item.time)) {
    const { to, kind } = entry.item;
    const group = groups.find((candidate) => {
      if (candidate.kind !== kind) return false;
      const count = candidate.items.length;
      return Math.hypot(candidate.sum[0] / count - to[0], candidate.sum[1] / count - to[1]) < SPOT_RADIUS &&
        Math.abs(candidate.sum[2] / count - to[2]) < SPOT_HEIGHT;
    });
    if (group) {
      group.items.push(entry);
      group.sum = [group.sum[0] + to[0], group.sum[1] + to[1], group.sum[2] + to[2]];
    } else groups.push({ kind, sum: [...to], items: [entry] });
  }
  return groups.map((group) => {
    const count = group.items.length;
    const players = new Map<string, number>();
    for (const { item } of group.items) players.set(item.playerId, (players.get(item.playerId) || 0) + 1);
    const typical = group.items[Math.floor((count - 1) / 2)];
    return {
      kind: group.kind,
      at: group.sum.map((value) => Math.round(value / count)) as Point3,
      throws: group.items.map(({ item }) => ({ from: item.from, to: item.to })),
      rounds: new Set(group.items.map(({ round }) => `${round.demoId}:${round.round.id}`)).size,
      time: median(group.items.map(({ item }) => item.time)),
      players: [...players].sort((a, b) => b[1] - a[1]).map(([id]) => id),
      example: { demoId: typical.round.demoId, roundId: typical.round.round.id, time: typical.item.time, playerId: typical.item.playerId },
    };
  }).sort((a, b) => b.rounds - a.rounds || a.time - b.time);
}

export type Duel = { won: boolean; at: Point3; from?: Point3; time: number; playerId: string; example: Example };

/** Opening duels the team took part in, at the position of the team's player. */
export function openingDuels(rounds: TeamRound[], filters: Filters): Duel[] {
  return rounds.flatMap((round) => {
    const opening = openingKill(round.round);
    if (!opening || !inWindow(round.round, opening.time, filters.window)) return [];
    const won = wanted(round.team, filters.playerId, opening.killerId) && round.round.sides[opening.victimId] !== round.side;
    const lost = wanted(round.team, filters.playerId, opening.victimId);
    if (!won && !lost) return [];
    const at = won ? opening.from : opening.at;
    if (!at) return [];
    const playerId = won ? opening.killerId : opening.victimId;
    return [{
      won,
      at,
      from: won ? opening.at : opening.from,
      time: opening.time,
      playerId,
      example: { demoId: round.demoId, roundId: round.round.id, time: opening.time, playerId },
    }];
  });
}

export function plants(rounds: TeamRound[], filters: Filters) {
  return rounds.flatMap((round) => {
    const plant = round.round.plant;
    if (!plant || round.side !== 2 || !wanted(round.team, filters.playerId, plant.playerId)) return [];
    return [{ ...plant, won: round.won, example: { demoId: round.demoId, roundId: round.round.id, time: plant.time, playerId: plant.playerId } }];
  });
}

export const BUYS = (["pistol", "eco", "semi-buy", "fullbuy"] as const).map(
  (value) => economyOptions.find((option) => option.value === value)!,
);

export function buyBreakdown(rounds: TeamRound[]) {
  return BUYS.map((buy) => ({ ...buy, ...tally(rounds.filter((round) => round.buy === buy.value)) })).filter((entry) => entry.rounds);
}

import test from "node:test";
import assert from "node:assert/strict";
import { clusterLineups, demoLineups, lineupOf, roundInsights, utilityKind, type DemoInsights, type InsightRound } from "../shared/demo-insights.js";
import { heatPoints, mapPool, openingDuels, playerProfiles, selectRounds, teamRounds, utilityGroups, type Filters, type OpponentReport } from "../shared/opponent-report.js";

const round = (number: number, sides: Record<string, number>, winner: number, extra: Partial<InsightRound> = {}): InsightRound => ({
  id: `r${number}`, number, winner, duration: 90, buy: {}, sides, tracks: {}, deaths: [], utility: [], ...extra,
});
const sides = (t: string[], ct: string[]) => ({ ...Object.fromEntries(t.map((id) => [id, 2])), ...Object.fromEntries(ct.map((id) => [id, 3])) });
const team = ["a1", "a2", "a3", "a4", "a5"], rivals = ["b1", "b2", "b3", "b4", "b5"];

test("demo lineups follow teams through the side switch and add late joiners to their side", () => {
  const insights: DemoInsights = {
    version: 1, demoId: "d1", map: "de_mirage", players: [],
    rounds: [
      round(1, sides(team, rivals), 2),
      round(2, sides(team, rivals), 3),
      // Second half: the team plays CT, a substitute replaces a5.
      round(13, sides(rivals, ["a1", "a2", "a3", "a4", "s1"]), 3),
    ],
  };
  const [first, second] = demoLineups(insights);
  assert.deepEqual(first.players.sort(), [...team, "s1"].sort());
  assert.deepEqual([first.won, first.lost], [2, 1]);
  assert.deepEqual([second.won, second.lost], [1, 2]);
});

test("teams across demos share at least three players; pugs with two do not merge", () => {
  const lineup = (players: string[]) => ({ players, won: 13, lost: 7 });
  const clusters = clusterLineups([
    { demoId: "d1", lineup: lineup(team) },
    { demoId: "d1", lineup: lineup(rivals) },
    { demoId: "d2", lineup: lineup(["a1", "a2", "a3", "x1", "x2"]) },
    { demoId: "d3", lineup: lineup(["a1", "a2", "y1", "y2", "y3"]) },
  ]);
  const found = clusters.find((cluster) => cluster.members.length === 2)!;
  assert.deepEqual(found.members.map((member) => member.demoId), ["d1", "d2"]);
  assert.deepEqual(found.core.slice(0, 3).sort(), ["a1", "a2", "a3"]);
  assert.equal(clusters.length, 3);
  assert.equal(lineupOf([lineup(team), lineup(rivals)], ["a1", "a2", "a3", "zz"])?.players, team);
  assert.equal(lineupOf([lineup(team)], ["a1", "x8", "x9"]), undefined);
});

test("round insights sample positions once per second, keep duel positions and utility landings", () => {
  const frame = (time: number, x: number, health = 100) => ({ time, players: [
    { id: "a1", x, y: 0, z: 0, yaw: 0, health, side: 2, weapon: "AK-47" },
    { id: "b1", x: 500, y: 0, z: 0, yaw: 180, health: 100, side: 3, weapon: "M4A4" },
  ] });
  const insights = roundInsights({
    round: { id: "r1", number: 1, startTick: 0, endTick: 0, duration: 3, winner: 3, economy: { t: { buy: "pistol", equipment: 0, money: 0, players: 5 } } },
    frames: [frame(-1, -10), frame(0, 0), frame(0.5, 5), frame(1, 10), frame(1.5, 15), frame(2, 20, 0)],
    events: [{ time: 1.9, tick: 122, kind: "player_death", playerId: "b1", player: "B", targetId: "a1", target: "A", weapon: "m4a1" }],
    grenades: [{ id: "g", kind: "CSmokeGrenadeProjectile", playerId: "a1", points: [{ time: 0.5, x: 5, y: 0, z: 60 }, { time: 2, x: 300, y: 40, z: 0 }] }],
  });
  assert.deepEqual(insights.tracks.a1, [0, 0, 0, 0, 1, 10, 0, 0]);
  assert.deepEqual(insights.sides, { a1: 2, b1: 3 });
  assert.deepEqual(insights.deaths[0], { time: 1.9, victimId: "a1", killerId: "b1", weapon: "m4a1", at: [15, 0, 0], from: [500, 0, 0] });
  assert.deepEqual(insights.utility[0], { time: 0.5, kind: "smoke", playerId: "a1", from: [5, 0, 60], to: [300, 40, 0] });
  assert.deepEqual(insights.buy, { t: "pistol" });
  assert.equal(utilityKind("CHEGrenadeProjectile"), "he");
  assert.equal(utilityKind("CMolotovProjectile"), "molotov");
});

test("opponent report counts map results, side rounds, duels and recurring utility", () => {
  const smoke = (time: number, x: number) => ({ time, kind: "smoke" as const, playerId: "a1", from: [0, 0, 0] as [number, number, number], to: [x, 0, 0] as [number, number, number] });
  const insights: DemoInsights = {
    version: 1, demoId: "d1", map: "de_mirage", players: [],
    rounds: [
      round(1, sides(team, rivals), 2, {
        buy: { t: "pistol" },
        tracks: { a1: [0, 1, 2, 3, 30, 4, 5, 6], b1: [0, 9, 9, 9] },
        deaths: [{ time: 12, victimId: "b1", killerId: "a2", weapon: "glock", at: [0, 0, 0], from: [1, 1, 1] }],
        utility: [smoke(10, 1000)],
      }),
      round(2, sides(team, rivals), 3, {
        deaths: [{ time: 8, victimId: "a3", killerId: "b2", weapon: "usp", at: [2, 2, 2], from: [3, 3, 3] }],
        utility: [smoke(12, 1100), smoke(40, -2000)],
      }),
      round(13, sides(rivals, team), 3),
    ],
  };
  const report: OpponentReport = {
    name: "Team", own: false,
    players: team.map((id) => ({ id, name: id.toUpperCase(), demos: 1 })),
    demos: [{ id: "d1", title: "Match", map: "de_mirage", date: "2026-10-01", team, won: 2, lost: 1 }],
    insights: [insights],
  };
  const rounds = teamRounds(report);
  const [mirage] = mapPool(report, rounds);
  assert.deepEqual([mirage.matches, mirage.wins, mirage.all.won, mirage.t.rounds, mirage.t.won, mirage.ct.won, mirage.pistol.won], [1, 1, 2, 2, 1, 1, 1]);
  const filters: Filters = { map: "de_mirage", side: 2, window: "early", playerId: "", buy: "" };
  const chosen = selectRounds(rounds, filters);
  assert.equal(chosen.length, 2);
  // Only the team's own positions inside the first 20 seconds.
  assert.deepEqual(heatPoints(chosen, filters), [[1, 2, 3]]);
  const [spot, ...rest] = utilityGroups(chosen, filters);
  assert.equal(spot.rounds, 2);
  assert.deepEqual(spot.at, [1050, 0, 0]);
  assert.equal(rest.length, 0);
  assert.deepEqual(openingDuels(chosen, filters).map((duel) => [duel.won, duel.playerId]), [[true, "a2"], [false, "a3"]]);
  const profiles = playerProfiles(report, rounds);
  assert.deepEqual(profiles.find((profile) => profile.id === "a2"), { id: "a2", name: "A2", demos: 1, rounds: 3, kills: 1, deaths: 0, openingKills: 1, openingDeaths: 0, utility: 0, weapon: "glock" });
});

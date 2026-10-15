import { readFile, rename, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { Router } from "express";
import type { Actor } from "../shared/authorization.js";
import type { Demo } from "../shared/demos.js";
import {
  INSIGHTS_VERSION,
  SAME_TEAM,
  clusterLineups,
  demoLineups,
  lineupOf,
  roundInsights,
  type DemoInsights,
  type Lineup,
} from "../shared/demo-insights.js";
import type { DetectedTeam, OpponentDemo, OpponentPlayer, OpponentReport } from "../shared/opponent-report.js";
import { problem } from "./strats.js";

export const INSIGHTS_FILE = "insights.json";
// Bounds the report to what a browser can still aggregate quickly.
const REPORT_DEMOS = 40;
const pack = promisify(gzip);

type Store = {
  analysis: {
    list(actor: Actor): Promise<{ entries: Demo[] }>;
    path(id: string, file: string): string;
  };
  matches?: { entries: { find(query: any, options?: any): { toArray(): Promise<any[]> } } };
  workspace: { listTeams(userId?: string): Promise<{ id: string; name: string; members: { userId: string }[] }[]> };
};

/** Finds teams across demos by their players and prepares the data for an opponent report. */
export class OpponentScouting {
  private building = new Map<string, Promise<DemoInsights>>();
  private lineups = new Map<string, Lineup[]>();
  constructor(private store: Store) {}

  /** Per-demo insights, cached next to the rounds. The worker writes them for new analyses. */
  async insights(demo: Demo): Promise<DemoInsights> {
    const path = this.store.analysis.path(demo.id, INSIGHTS_FILE);
    try {
      const cached: DemoInsights = JSON.parse(await readFile(path, "utf8"));
      if (cached.version === INSIGHTS_VERSION && cached.demoId === demo.id) return cached;
    } catch {}
    let pending = this.building.get(demo.id);
    if (!pending) {
      pending = (async () => {
        const rounds = [];
        for (const round of demo.summary!.rounds)
          rounds.push(roundInsights(JSON.parse(await readFile(this.store.analysis.path(demo.id, `${round.id}.json`), "utf8"))));
        const insights: DemoInsights = { version: INSIGHTS_VERSION, demoId: demo.id, map: demo.summary!.map, players: demo.summary!.players, rounds };
        // A failed cache write only costs the next request the same work.
        const temp = `${path}.${process.pid}.tmp`;
        await writeFile(temp, JSON.stringify(insights)).then(() => rename(temp, path)).catch(() => {});
        return insights;
      })().finally(() => this.building.delete(demo.id));
      this.building.set(demo.id, pending);
    }
    return pending;
  }

  private async lineupsOf(demo: Demo) {
    const key = `${demo.id}:${demo.updatedAt}`;
    let lineups = this.lineups.get(key);
    if (!lineups) {
      lineups = demoLineups(await this.insights(demo));
      this.lineups.set(key, lineups);
    }
    return lineups;
  }

  private async context(actor: Actor) {
    // The same match uploaded twice, privately and for the team or in another archive format, counts once.
    const seen = new Set<string>();
    const demos = (await this.store.analysis.list(actor)).entries.filter((demo) => {
      if (demo.status !== "ready" || !demo.summary) return false;
      const match = `${demo.summary.map}:${demo.summary.rounds.map((round) => round.startTick).join(".")}`;
      if (seen.has(match)) return false;
      seen.add(match);
      return true;
    });
    const matches = demos.length && this.store.matches
      ? await this.store.matches.entries.find({ demoId: { $in: demos.map((demo) => demo.id) } }, { projection: { demoId: 1, playedAt: 1, sides: 1, players: 1 } }).toArray()
      : [];
    const matchOf = new Map(matches.map((match) => [match.demoId, match]));
    const teams = await this.store.workspace.listTeams(actor.identitySteam64);
    // Demos are newest first, so the first name seen is the current one.
    const names = new Map<string, string>();
    for (const demo of demos) for (const player of demo.summary!.players) if (!names.has(player.id)) names.set(player.id, player.name);
    const date = (demo: Demo) => matchOf.get(demo.id)?.playedAt || demo.createdAt;
    const describe = (lineups: { demo: Demo; lineup: Lineup }[]): Pick<DetectedTeam, "name" | "own"> & { players: OpponentPlayer[]; demos: OpponentDemo[] } => {
      const appearances = new Map<string, number>();
      for (const { lineup } of lineups) for (const id of lineup.players) appearances.set(id, (appearances.get(id) || 0) + 1);
      const players = [...appearances].sort((a, b) => b[1] - a[1]).map(([id, count]) => ({ id, name: names.get(id) || id, demos: count }));
      const own = teams.find((team) => team.members.filter((member) => appearances.has(member.userId)).length >= 2);
      // Match imports know the FACEIT team name; otherwise the most frequent player names the team.
      const labels = new Map<string, number>();
      for (const { demo, lineup } of lineups) {
        const match = matchOf.get(demo.id);
        const side = match?.sides?.find((side: any) => {
          const steamIds = new Set((match.players || []).filter((player: any) => side.roster?.includes(player.id)).map((player: any) => player.steamId));
          return lineup.players.filter((id) => steamIds.has(id)).length >= SAME_TEAM;
        });
        if (side?.name) labels.set(side.name, (labels.get(side.name) || 0) + 1);
      }
      const label = [...labels].sort((a, b) => b[1] - a[1])[0]?.[0];
      return {
        name: own?.name || label || `Team um ${players[0]?.name || "unbekannt"}`,
        own: !!own,
        players,
        demos: lineups
          .map(({ demo, lineup }) => ({ id: demo.id, title: demo.title, map: demo.summary!.map, date: date(demo), team: lineup.players, won: lineup.won, lost: lineup.lost }))
          .sort((a, b) => b.date.localeCompare(a.date)),
      };
    };
    return { demos, describe };
  }

  async detect(actor: Actor): Promise<{ teams: DetectedTeam[] }> {
    const { demos, describe } = await this.context(actor);
    const byId = new Map(demos.map((demo) => [demo.id, demo]));
    const sources = [];
    for (const demo of demos) for (const lineup of await this.lineupsOf(demo)) sources.push({ demoId: demo.id, lineup });
    const teams = clusterLineups(sources).map((cluster) => ({
      key: [...cluster.core].sort().join("."),
      core: cluster.core,
      ...describe(cluster.members.map(({ demoId, lineup }) => ({ demo: byId.get(demoId)!, lineup }))),
    }));
    return { teams: teams.sort((a, b) => b.demos.length - a.demos.length || b.demos[0].date.localeCompare(a.demos[0].date)) };
  }

  async report(actor: Actor, players: string[]): Promise<OpponentReport> {
    if (!players.length || players.length > 10 || players.some((id) => !/^[0-9]{1,20}$/.test(id)))
      problem(400, "Wähle die Spieler des Teams aus.");
    const { demos, describe } = await this.context(actor);
    const matched: { demo: Demo; lineup: Lineup }[] = [];
    for (const demo of demos) {
      const lineup = lineupOf(await this.lineupsOf(demo), players);
      if (lineup) matched.push({ demo, lineup });
      if (matched.length >= REPORT_DEMOS) break;
    }
    if (!matched.length) problem(404, "Keine deiner Demos enthält dieses Team.");
    const insights = [];
    for (const { demo, lineup } of matched) {
      const data = await this.insights(demo);
      // Only the team's own movement is needed; the other side stays in kills and plants.
      const team = new Set(lineup.players);
      insights.push({
        ...data,
        rounds: data.rounds.map((round) => ({
          ...round,
          tracks: Object.fromEntries(Object.entries(round.tracks).filter(([id]) => team.has(id))),
        })),
      });
    }
    return { ...describe(matched), insights };
  }
}

export function installOpponents(app, { store }) {
  const scouting = new OpponentScouting(store);
  const router = Router();
  router.get("/analysis/opponents", async (_req, res, next) => {
    try {
      res.json(await scouting.detect(res.locals.user));
    } catch (error) {
      next(error);
    }
  });
  router.get("/analysis/opponents/report", async (req, res, next) => {
    try {
      const players = String(req.query.players || "").split(",").filter(Boolean);
      const body = JSON.stringify(await scouting.report(res.locals.user, players));
      res.type("json").vary("Accept-Encoding");
      // Positions of several demos are a few megabytes of JSON; compressed they are a fraction.
      if (!req.acceptsEncodings("gzip")) return res.send(body);
      res.set("Content-Encoding", "gzip").send(await pack(body));
    } catch (error) {
      next(error);
    }
  });
  app.use("/api", router);
  return scouting;
}

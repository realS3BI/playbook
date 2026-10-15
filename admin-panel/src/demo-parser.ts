import {
  parseEvents,
  parseGrenades,
  parseHeader,
  parseTicks,
} from "@laihoe/demoparser2";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  AFTER_ROUND_LIMIT,
  ANALYSIS_VERSION,
  BUY_PHASE_LIMIT,
  BUY_WINDOW,
  classifyBuy,
  type DemoRound,
  type PlayerLoadout,
  type TeamEconomy,
  type DemoSummary,
  type RoundReplay,
  type GrenadePath,
} from "../shared/demos.js";
import { INSIGHTS_VERSION, roundInsights, type DemoInsights } from "../shared/demo-insights.js";

export const PARSER_VERSION = "0.42.0";
const TICK_RATE = 64;
const EVENT_NAMES = [
  "round_start",
  "round_freeze_end",
  "round_end",
  "player_death",
  "smokegrenade_detonate",
  "smokegrenade_expired",
  "inferno_startburn",
  "inferno_expire",
  "flashbang_detonate",
  "hegrenade_detonate",
  "bomb_planted",
  "bomb_defused",
  "bomb_exploded",
  "bomb_dropped",
  "bomb_pickup",
];
const finite = (value: any) =>
  typeof value === "number" && Number.isFinite(value);

// Rounds are tick intervals. Counters can advance inside the same tick as round_end.
// Times stay relative to freeze end so saved scenes keep their meaning; the buy phase is negative.
export function demoRounds(events: any[]): {
  rounds: (DemoRound & { buyTick: number; afterTick: number })[];
  warnings: string[];
} {
  const starts = [
    ...new Set<number>(
      events
        .filter(
          (event) => event.event_name === "round_start" && finite(event.tick),
        )
        .map((event) => event.tick),
    ),
  ].sort((a, b) => a - b);
  const rounds: (DemoRound & { buyTick: number; afterTick: number })[] = [];
  const warnings = new Set<string>();
  for (let index = 0; index < starts.length; index++) {
    const section = events.filter(
      (event) =>
        event.tick >= starts[index] &&
        event.tick < (starts[index + 1] ?? Infinity),
    );
    const freeze = section.find(
      (event) =>
        event.event_name === "round_freeze_end" &&
        event.is_warmup_period === false,
    );
    const end = section.find(
      (event) =>
        event.event_name === "round_end" && event.is_warmup_period === false,
    );
    if (!freeze && !end) continue;
    if (!end) {
      warnings.add("Eine unvollständige Schlussrunde wurde ausgelassen.");
      continue;
    }
    const startTick = freeze?.tick ?? starts[index];
    if (!freeze)
      warnings.add(
        "Mindestens eine Runde endete während der Vorbereitung. Ihr Ausschnitt beginnt beim Rundenstart.",
      );
    const duration = (end.tick - startTick) / TICK_RATE;
    if (duration <= 0 || duration > 1800) {
      warnings.add("Eine Runde mit ungewöhnlicher Dauer wurde ausgelassen.");
      continue;
    }
    const buyTick = Math.max(
      starts[index],
      startTick - BUY_PHASE_LIMIT * TICK_RATE,
    );
    const afterTick = Math.max(
      end.tick,
      Math.min(
        (starts[index + 1] ?? Infinity) - 1,
        end.tick + AFTER_ROUND_LIMIT * TICK_RATE,
      ),
    );
    const timelimit = Number(
      section.find((event) => event.event_name === "round_start")?.timelimit,
    );
    rounds.push({
      id: `r${rounds.length + 1}`,
      number: rounds.length + 1,
      startTick,
      endTick: end.tick,
      duration,
      winner: Number(end.winner) || 0,
      buyStart: (buyTick - startTick) / TICK_RATE,
      afterEnd: (afterTick - startTick) / TICK_RATE,
      ...(timelimit > 0 && timelimit <= 600 && { roundTime: timelimit }),
      buyTick,
      afterTick,
    });
  }
  if (!rounds.length || rounds.length > 200)
    throw new Error("Keine unterstützten abgeschlossenen CS2-Runden gefunden.");
  return { rounds, warnings: [...warnings] };
}

export async function parseDemo(
  path: string,
  output: string,
): Promise<DemoSummary> {
  const header = parseHeader(path);
  if (
    !header ||
    typeof header.map_name !== "string" ||
    !/^[\w/-]{1,100}$/.test(header.map_name)
  )
    throw new Error("Die Demo enthält keinen gültigen Kartennamen.");
  const events = parseEvents(
    path,
    EVENT_NAMES,
    ["X", "Y", "Z"],
    ["is_warmup_period", "total_rounds_played"],
  ).sort((a, b) => a.tick - b.tick);
  if (!Array.isArray(events))
    throw new Error("Die Demo-Ereignisse konnten nicht gelesen werden.");
  const { rounds, warnings } = demoRounds(events);
  const wantedTicks: number[] = [];
  for (const round of rounds) {
    // Keep the 8-tick grid anchored at freeze end in both directions.
    for (let tick = round.startTick; tick >= round.buyTick; tick -= 8)
      wantedTicks.push(tick);
    for (let tick = round.startTick; tick <= round.afterTick; tick += 8)
      wantedTicks.push(tick);
    wantedTicks.push(round.endTick, round.afterTick);
  }
  if (wantedTicks.length > 120_000)
    throw new Error("Die Demo überschreitet die unterstützte Matchdauer.");
  const ticks = parseTicks(
    path,
    [
      "X",
      "Y",
      "Z",
      "yaw",
      "pitch",
      "duck_amount",
      "is_scoped",
      "health",
      "team_num",
      "active_weapon_name",
      "inventory",
      "balance",
      "cash_spent_this_round",
      "current_equip_value",
      "armor_value",
      "has_helmet",
      "has_defuser",
    ],
    [...new Set(wantedTicks)],
  );
  if (
    !Array.isArray(ticks) ||
    !ticks.some(
      (row) =>
        finite(row.X) &&
        finite(row.Y) &&
        finite(row.Z) &&
        finite(row.team_num) &&
        finite(row.health),
    )
  )
    throw new Error("Spielerpositionen oder Teamdaten fehlen in dieser Demo.");
  const players = new Map<string, string>();
  const byTick = new Map<number, any[]>();
  const stateByTick = new Map<number, Map<string, PlayerState>>();
  for (const row of ticks) {
    if (
      typeof row.steamid !== "string" ||
      !/^[0-9]{1,20}$/.test(row.steamid) ||
      ![row.X, row.Y, row.Z, row.yaw, row.health].every(finite) ||
      ![2, 3].includes(row.team_num)
    )
      continue;
    players.set(row.steamid, String(row.name || row.steamid).slice(0, 100));
    let frame = byTick.get(row.tick);
    if (!frame) byTick.set(row.tick, (frame = []));
    frame.push({
      id: row.steamid,
      x: row.X,
      y: row.Y,
      z: row.Z,
      yaw: row.yaw,
      // The 3D view needs where players look and how low their eyes are; two decimals are enough.
      ...(finite(row.pitch) && { pitch: Math.round(row.pitch * 100) / 100 }),
      ...(finite(row.duck_amount) && row.duck_amount > 0 && { duck: Math.round(Math.min(1, row.duck_amount) * 100) / 100 }),
      ...(row.is_scoped === true && { scoped: true }),
      health: Math.max(0, row.health),
      side: row.team_num,
      weapon: String(row.active_weapon_name || "").slice(0, 80),
    });
    let states = stateByTick.get(row.tick);
    if (!states) stateByTick.set(row.tick, (states = new Map()));
    states.set(row.steamid, playerState(row));
  }
  const grenadeRows = parseGrenades(path, [], false);
  const grenadeByRound = new Map<string, GrenadePath[]>();
  for (const round of rounds) {
    const tracks = new Map<
      string,
      { path: GrenadePath; tick: number; sampled: number }
    >();
    const paths: GrenadePath[] = [];
    for (const row of grenadeRows) {
      if (
        row.tick < round.buyTick ||
        row.tick > round.afterTick ||
        ![row.x, row.y, row.z].every(finite)
      )
        continue;
      const key = `${row.grenade_entity_id}:${row.steamid}:${row.grenade_type}`;
      let track = tracks.get(key);
      if (!track || row.tick - track.tick > 64 || row.tick < track.tick) {
        const path: GrenadePath = {
          id: `${round.id}-${paths.length}`,
          kind: String(row.grenade_type),
          playerId: String(row.steamid || ""),
          points: [],
        };
        track = { path, tick: row.tick, sampled: -Infinity };
        tracks.set(key, track);
        paths.push(path);
      }
      track.tick = row.tick;
      if (row.tick - track.sampled >= 4) {
        track.path.points.push({
          time: (row.tick - round.startTick) / TICK_RATE,
          x: row.x,
          y: row.y,
          z: row.z,
        });
        track.sampled = row.tick;
      }
    }
    grenadeByRound.set(round.id, paths);
  }
  await mkdir(output, { recursive: true });
  const insights: DemoInsights["rounds"] = [];
  for (const round of rounds) {
    const replay: RoundReplay = {
      round,
      frames: [...byTick]
        .filter(([tick]) => tick >= round.buyTick && tick <= round.afterTick)
        .sort(([a], [b]) => a - b)
        .map(([tick, players]) => ({
          time: (tick - round.startTick) / TICK_RATE,
          players,
        })),
      events: events
        .filter(
          (event) =>
            event.tick >= round.buyTick &&
            event.tick <= round.afterTick &&
            !event.event_name.startsWith("round_"),
        )
        .map((event) => ({
          time: (event.tick - round.startTick) / TICK_RATE,
          tick: event.tick,
          kind: event.event_name,
          playerId: String(
            (event.event_name === "player_death"
              ? event.attacker_steamid
              : event.user_steamid) || "",
          ),
          player: String(
            (event.event_name === "player_death"
              ? event.attacker_name
              : event.user_name) || "",
          ).slice(0, 100),
          ...(event.event_name === "player_death" && {
            target: String(event.user_name || "").slice(0, 100),
            targetId: String(event.user_steamid || ""),
            weapon: String(event.weapon || ""),
          }),
          ...([event.x, event.y, event.z].every(finite) && {
            x: event.x,
            y: event.y,
            z: event.z,
          }),
          // Bomb events carry the acting player's position instead of their own coordinates.
          ...(![event.x, event.y, event.z].every(finite) &&
            event.event_name.startsWith("bomb_") &&
            [event.user_X, event.user_Y, event.user_Z].every(finite) && {
              x: event.user_X,
              y: event.user_Y,
              z: event.user_Z,
            }),
          ...(finite(event.entityid) && { entityId: event.entityid }),
        })),
      grenades: grenadeByRound.get(round.id) || [],
    };
    if (!replay.frames.length)
      throw new Error(`Spielerpositionen fehlen in Runde ${round.number}.`);
    // The final round may end before the after-round pause is recorded.
    round.afterEnd = Math.max(round.duration, replay.frames.at(-1)!.time);
    const states = [...stateByTick]
      .filter(([tick]) => tick >= round.buyTick && tick <= round.afterTick)
      .sort(([a], [b]) => a - b);
    replay.loadouts = roundLoadouts(states, round.startTick);
    const economy = roundEconomy(
      states,
      replay.frames,
      round.startTick,
      Math.min(round.endTick, round.startTick + BUY_WINDOW * TICK_RATE),
    );
    if (economy.t || economy.ct) round.economy = economy;
    replay.round = publicRound(round);
    await writeFile(join(output, `${round.id}.json`), JSON.stringify(replay));
    insights.push(roundInsights(replay));
  }
  const summary: DemoSummary = {
    version: ANALYSIS_VERSION,
    parserVersion: PARSER_VERSION,
    map: header.map_name,
    tickRate: TICK_RATE,
    players: [...players].map(([id, name]) => ({ id, name })),
    rounds: rounds.map(publicRound),
    warnings,
  };
  await writeFile(join(output, "summary.json"), JSON.stringify(summary));
  // Opponent reports compare many demos; this compact copy spares them reading every round.
  // The folder is named after the demo.
  await writeFile(join(output, "insights.json"), JSON.stringify({
    version: INSIGHTS_VERSION, demoId: basename(output), map: summary.map, players: summary.players, rounds: insights,
  } satisfies DemoInsights));
  return summary;
}

type PlayerState = {
  items: string[];
  money: number;
  spent: number;
  equipment: number;
  armor: number;
  helmet: boolean;
  defuser: boolean;
};

function playerState(row: any): PlayerState {
  const number = (value: any) => (finite(value) ? Math.max(0, value) : 0);
  return {
    items: (Array.isArray(row.inventory) ? row.inventory : [])
      .filter((item: any) => typeof item === "string" && item)
      .slice(0, 16)
      .map((item: string) => item.slice(0, 40)),
    money: number(row.balance),
    spent: number(row.cash_spent_this_round),
    equipment: number(row.current_equip_value),
    armor: number(row.armor_value),
    helmet: row.has_helmet === true,
    defuser: row.has_defuser === true,
  };
}

function publicRound({
  buyTick: _buy,
  afterTick: _after,
  ...round
}: DemoRound & { buyTick?: number; afterTick?: number }): DemoRound {
  return round;
}

// Only changes are stored; the player reads the latest entry at or before the current time.
export function roundLoadouts(
  states: [number, Map<string, PlayerState>][],
  startTick: number,
): PlayerLoadout[] {
  const last = new Map<string, string>();
  const loadouts: PlayerLoadout[] = [];
  for (const [tick, players] of states)
    for (const [id, state] of players) {
      const loadout = {
        time: (tick - startTick) / TICK_RATE,
        id,
        items: state.items,
        money: state.money,
        armor: state.armor,
        helmet: state.helmet,
        defuser: state.defuser,
      };
      const signature = JSON.stringify({ ...loadout, time: 0 });
      if (last.get(id) === signature) continue;
      last.set(id, signature);
      loadouts.push(loadout);
    }
  return loadouts;
}

// Buying continues briefly after freeze end, so the highest equipment value inside the buy window counts.
export function roundEconomy(
  states: [number, Map<string, PlayerState>][],
  frames: RoundReplay["frames"],
  startTick: number,
  buyEndTick: number,
): { t?: TeamEconomy; ct?: TeamEconomy } {
  const sides = new Map<string, number>();
  const freeze =
    frames.find((frame) => frame.time >= 0) || frames[0];
  for (const player of freeze?.players || []) sides.set(player.id, player.side);
  const freezeStates =
    states.find(([tick]) => tick >= startTick)?.[1] || new Map();
  const result: { t?: TeamEconomy; ct?: TeamEconomy } = {};
  for (const [side, key] of [
    [2, "t"],
    [3, "ct"],
  ] as const) {
    const ids = [...sides].filter(([, value]) => value === side).map(([id]) => id);
    const players = ids.map((id) => {
      let equipment = 0;
      for (const [tick, players] of states)
        if (tick <= buyEndTick)
          equipment = Math.max(equipment, players.get(id)?.equipment || 0);
      const state = freezeStates.get(id);
      return {
        equipment,
        money: state?.money || 0,
        startMoney: (state?.money || 0) + (state?.spent || 0),
      };
    });
    const buy = classifyBuy(players);
    if (buy)
      result[key] = {
        buy,
        equipment: players.reduce((total, player) => total + player.equipment, 0),
        money: players.reduce((total, player) => total + player.money, 0),
        players: players.length,
      };
  }
  return result;
}

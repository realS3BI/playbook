import type { StratEconomy } from "./strats.js";

export const ANALYSIS_VERSION = 1;
export const DEMO_UPLOAD_LIMIT = 1024 * 1024 * 1024;
export const DEMO_EXPANDED_LIMIT = 2 * DEMO_UPLOAD_LIMIT;

export type DemoPlayer = { id: string; name: string };
export type DemoRound = {
  id: string;
  number: number;
  startTick: number;
  endTick: number;
  duration: number;
  winner: number;
  /** Seconds relative to freeze end; negative while the buy phase runs. Missing in older analyses. */
  buyStart?: number;
  /** End of the after-round period, relative to freeze end. */
  afterEnd?: number;
  roundTime?: number;
  economy?: { t?: TeamEconomy; ct?: TeamEconomy };
};
export type RoundBuy = StratEconomy;
export type TeamEconomy = {
  buy: RoundBuy;
  /** Team equipment value after buying. */
  equipment: number;
  /** Money left at freeze end. */
  money: number;
  players: number;
};
export type DemoSummary = {
  version: number;
  parserVersion: string;
  map: string;
  tickRate: number;
  players: DemoPlayer[];
  rounds: DemoRound[];
  warnings: string[];
};
export type Demo = {
  id: string;
  ownerId: string;
  teamId: string | null;
  title: string;
  source: "faceit" | "premier" | "other";
  filename: string;
  status:
    | "uploading"
    | "receiving"
    | "queued"
    | "processing"
    | "ready"
    | "failed";
  createdAt: string;
  updatedAt: string;
  bytes?: number;
  hash?: string;
  error?: string;
  summary?: DemoSummary;
  canEdit?: boolean;
};
export type PlayerFrame = {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Degrees, positive looks down. Missing in analyses made before the 3D view. */
  pitch?: number;
  /** 0 standing to 1 fully crouched; omitted while standing. */
  duck?: number;
  /** Looking through a scope; omitted otherwise. */
  scoped?: boolean;
  health: number;
  side: number;
  weapon: string;
};
/** Emitted whenever a player's inventory, money or armour changes. */
export type PlayerLoadout = {
  time: number;
  id: string;
  items: string[];
  money: number;
  armor: number;
  helmet: boolean;
  defuser: boolean;
};
export type DemoFrame = { time: number; players: PlayerFrame[] };
export type DemoEvent = {
  time: number;
  tick: number;
  kind: string;
  playerId: string;
  player: string;
  target?: string;
  targetId?: string;
  weapon?: string;
  x?: number;
  y?: number;
  z?: number;
  entityId?: number;
};
export type GrenadePath = {
  id: string;
  kind: string;
  playerId: string;
  points: { time: number; x: number; y: number; z: number }[];
};
export type RoundReplay = {
  round: DemoRound;
  frames: DemoFrame[];
  events: DemoEvent[];
  grenades: GrenadePath[];
  loadouts?: PlayerLoadout[];
};
export type SceneReference = {
  demoId: string;
  roundId: string;
  version: number;
  start: number;
  end: number;
  focusId: string;
};
export type DemoScene = SceneReference & {
  id: string;
  title: string;
  note: string;
};
export type ReviewNote = {
  id: string;
  authorId: string;
  authorName: string;
  sceneId: string;
  text: string;
  createdAt: string;
};
export type Playback = {
  sceneIndex: number;
  time: number;
  playing: boolean;
  speed: number;
  anchoredAt: number;
  focusId: string;
};
export type ReviewSession = {
  id: string;
  moderatorId: string;
  scenes: DemoScene[];
  playback: Playback;
};
export type DemoReview = {
  id: string;
  teamId: string;
  title: string;
  revision: number;
  scenes: DemoScene[];
  notes: ReviewNote[];
  session: ReviewSession | null;
  createdBy: string;
  updatedAt: string;
};
export type ReviewParticipant = {
  id: string;
  name: string;
  ready: boolean;
  following: boolean;
};
export type ReviewRoom = {
  review: DemoReview;
  canEdit: boolean;
  participants: ReviewParticipant[];
  pointer: { x: number; y: number; level: string; at: number } | null;
};

export function playbackTime(
  playback: Playback,
  scene: SceneReference,
  now: number,
) {
  return Math.max(
    scene.start,
    Math.min(
      scene.end,
      playback.time +
        (playback.playing
          ? (Math.max(0, now - playback.anchoredAt) / 1000) * playback.speed
          : 0),
    ),
  );
}
export function sceneUrl(scene: SceneReference) {
  return `/analysis/demos/${scene.demoId}?round=${encodeURIComponent(scene.roundId)}&start=${scene.start}&end=${scene.end}&focus=${encodeURIComponent(scene.focusId)}`;
}

export const DEFAULT_ROUND_TIME = 115;
export const BOMB_TIME = 40;
/** Buy windows longer than this (timeouts, pauses) are trimmed to the last seconds before freeze end. */
export const BUY_PHASE_LIMIT = 30;
export const AFTER_ROUND_LIMIT = 10;
export const BUY_WINDOW = 20;

export const roundStart = (round: DemoRound) => round.buyStart ?? 0;
export const roundEnd = (round: DemoRound) => round.afterEnd ?? round.duration;

export type RoundPhase = "buy" | "live" | "planted" | "over";
/** In-game style clock: freeze countdown, round timer, bomb timer and the pause until the next round. */
export function roundClock(round: DemoRound, time: number, plantTime?: number) {
  if (time < 0) return { phase: "buy" as RoundPhase, remaining: -time };
  if (time > round.duration)
    return { phase: "over" as RoundPhase, remaining: Math.max(0, roundEnd(round) - time) };
  if (plantTime !== undefined && time >= plantTime)
    return { phase: "planted" as RoundPhase, remaining: Math.max(0, plantTime + BOMB_TIME - time) };
  return {
    phase: "live" as RoundPhase,
    remaining: Math.max(0, (round.roundTime || DEFAULT_ROUND_TIME) - time),
  };
}

/**
 * Average equipment value after buying decides the buy type. Pistol rounds are
 * recognised by the start money, so overtime and shortened formats need no round numbers.
 */
export function classifyBuy(
  players: { equipment: number; startMoney: number }[],
): RoundBuy | undefined {
  if (!players.length) return undefined;
  if (players.every((player) => player.startMoney <= 1000)) return "pistol";
  const average =
    players.reduce((total, player) => total + player.equipment, 0) / players.length;
  return average >= 3500 ? "fullbuy" : average >= 1500 ? "semi-buy" : "eco";
}

const pistols = new Set(
  ["glock18", "usps", "p2000", "p250", "fiveseven", "tec9", "cz75auto", "deserteagle", "dualberettas", "r8revolver"],
);
const rifles = new Set([
  "ak47", "m4a4", "m4a1s", "awp", "ssg08", "galilar", "famas", "aug", "sg553", "scar20", "g3sg1",
  "mac10", "mp9", "mp7", "mp5sd", "ump45", "p90", "ppbizon", "nova", "xm1014", "sawedoff", "mag7", "m249", "negev",
]);
const grenadeKinds: [RegExp, Grenade][] = [
  [/smoke/, "Smoke"],
  [/flash/, "Flash"],
  [/molotov|incendiary/, "Molly"],
  [/highexplosive|hegrenade/, "HE"],
  [/decoy/, "Decoy"],
];
export type Grenade = "Smoke" | "Flash" | "Molly" | "HE" | "Decoy";
const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
export const isPistol = (name: string) => pistols.has(key(name));
export const isPrimary = (name: string) => rifles.has(key(name));

export function loadoutSummary(items: string[]) {
  const grenades: Grenade[] = [];
  for (const item of items) {
    const kind = grenadeKinds.find(([pattern]) => pattern.test(key(item)))?.[1];
    if (kind) grenades.push(kind);
  }
  return {
    primary: items.find(isPrimary),
    secondary: items.find(isPistol),
    zeus: items.some((item) => key(item).startsWith("zeus")),
    grenades,
    bomb: items.some((item) => key(item).startsWith("c4")),
  };
}

// Death events name weapons by their internal names.
const WEAPONS: Record<string, string> = {
  ak47: "AK-47", m4a1: "M4A4", m4a1_silencer: "M4A1-S", m4a1_silencer_off: "M4A1-S", awp: "AWP", ssg08: "SSG 08",
  famas: "FAMAS", galilar: "Galil AR", aug: "AUG", sg556: "SG 553", scar20: "SCAR-20", g3sg1: "G3SG1",
  glock: "Glock-18", hkp2000: "P2000", usp_silencer: "USP-S", usp_silencer_off: "USP-S", p250: "P250",
  fiveseven: "Five-SeveN", tec9: "Tec-9", cz75a: "CZ75-Auto", deagle: "Desert Eagle", revolver: "R8 Revolver",
  elite: "Dual Berettas", mac10: "MAC-10", mp9: "MP9", mp7: "MP7", mp5sd: "MP5-SD", ump45: "UMP-45", p90: "P90",
  bizon: "PP-Bizon", nova: "Nova", xm1014: "XM1014", sawedoff: "Sawed-Off", mag7: "MAG-7", m249: "M249",
  negev: "Negev", hegrenade: "HE", inferno: "Molotov", taser: "Zeus x27", planted_c4: "Bombe", world: "Welt",
};
export function weaponLabel(name: string) {
  const key = name.toLowerCase().replace(/^weapon_/, "");
  return WEAPONS[key] || (/knife|bayonet/.test(key) ? "Messer" : name);
}

export const shareCodeValid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^CSGO(?:-[ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789]{5}){5}$/.test(value);

export function parseMatchShareCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const input = value.trim();
  if (shareCodeValid(input)) return input;
  let decoded: string;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    return null;
  }
  const match = /^steam:\/\/rungame\/730\/\d{17}\/\+csgo_download_match (CSGO-[A-Za-z0-9-]+)$/.exec(decoded);
  return match && shareCodeValid(match[1]) ? match[1] : null;
}

export type MatchPlayer = { id: string; steamId?: string; name: string };
export type MatchEntry = {
  id: string;
  ownerId: string;
  teamId: string | null;
  source: "faceit" | "premier";
  externalId: string;
  title: string;
  playedAt: string | null;
  map: string;
  players: MatchPlayer[];
  sides: { id: string; name: string; roster: string[]; score: number | null }[];
  competition: string;
  competitionId: string;
  demoId: string | null;
  demoStatus:
    | "unavailable"
    | "access_required"
    | "available"
    | "queued"
    | "imported"
    | "failed";
  error?: string;
  createdAt: string;
};
export type MatchConnection = {
  id: string;
  ownerId: string;
  teamId: string | null;
  source: "faceit" | "premier";
  label: string;
  playerId: string;
  enabled: boolean;
  autoDownload: boolean;
  lastSyncAt: string | null;
  lastError?: string;
  hasHistoryAccess?: boolean;
};
export type Prematch = {
  id: string;
  teamId: string;
  title: string;
  opponent: string;
  roster: string[];
  matchIds: string[];
  days: number;
  competition: string;
  competitionSource?: string;
  notes: string;
  stratIds: string[];
  revision: number;
  published: boolean;
  createdBy: string;
  updatedAt: string;
};

import { randomUUID } from "node:crypto";
import type { Db, Collection } from "mongodb";
import { authorize, isPlatformAdmin, type Actor } from "../shared/authorization.js";
import type { MatchEntry, Prematch } from "../shared/matches.js";
import { parseMatchShareCode, shareCodeValid } from "../shared/matches.js";
export { shareCodeValid } from "../shared/matches.js";
import { problem, textField } from "./strats.js";
import {
  SourceSecrets,
  SteamDemoResolver,
  sourceJson,
} from "./match-sources.js";
import type { DemoStore } from "./demo-store.js";
import type { WorkspaceStore } from "./workspace-store.js";

const uuid = (value: unknown) =>
  typeof value === "string" && /^[\w-]{1,100}$/.test(value);
export class MatchStore {
  readonly entries: Collection<any>;
  readonly connections: Collection<any>;
  readonly preparations: Collection<any>;
  readonly providerCredentials: Collection<any>;
  readonly secrets: SourceSecrets | null;
  readonly steam = new SteamDemoResolver();
  private syncing = new Set<string>();
  constructor(
    db: Db,
    readonly analysis: DemoStore,
    readonly workspace: WorkspaceStore,
    readonly config: any,
  ) {
    this.entries = db.collection("matchIndex");
    this.connections = db.collection("matchConnections");
    this.preparations = db.collection("prematches");
    this.providerCredentials = db.collection("matchProviderCredentials");
    this.secrets = config.sessionSecret
      ? new SourceSecrets(config.sessionSecret)
      : null;
  }
  async initialize() {
    await this.entries.createIndex(
      { scope: 1, source: 1, externalId: 1, mapIndex: 1 },
      { unique: true },
    );
    await this.entries.createIndex({ teamId: 1, playedAt: -1 });
    await this.connections.createIndex({ ownerId: 1 });
    await this.preparations.createIndex({ teamId: 1, updatedAt: -1 });
    const credentials = await this.providerCredentials.findOne({ _id: "faceit" });
    if (credentials && this.secrets) {
      if (credentials.apiKey) this.config.faceitApiKey = this.secrets.decrypt(credentials.apiKey);
      if (credentials.downloadsToken) this.config.faceitDownloadsToken = this.secrets.decrypt(credentials.downloadsToken);
    }
  }
  async configureFaceit(actor: Actor, input: any) {
    if (!isPlatformAdmin(actor)) problem(403, "Nur Plattform-Admins dürfen den FACEIT-Zugang einrichten.");
    if (!this.secrets) problem(503, "Der sichere Quellenzugang ist noch nicht eingerichtet.");
    if (!input || typeof input !== "object" || Array.isArray(input)) problem(400, "Gib einen FACEIT-Zugang ein.");
    for (const field of ["apiKey", "downloadsToken"]) {
      if (input[field] !== undefined && (typeof input[field] !== "string" || !/^[\x21-\x7e]{1,8192}$/.test(input[field])))
        problem(400, "Der FACEIT-Zugang darf keine Leerzeichen enthalten und höchstens 8192 Zeichen lang sein.");
    }
    if (!input.apiKey && !input.downloadsToken) problem(400, "Gib einen API-Schlüssel oder einen Downloads-Token ein.");
    if (!input.apiKey && !this.config.faceitApiKey) problem(400, "Richte zuerst den FACEIT-API-Schlüssel ein.");
    if (input.apiKey) {
      await sourceJson("https://open.faceit.com/data/v4/games/cs2", {
        headers: { Authorization: `Bearer ${input.apiKey}` },
      });
    }
    const encrypted: Record<string, string> = {};
    if (input.apiKey) encrypted.apiKey = this.secrets.encrypt(input.apiKey);
    if (input.downloadsToken) encrypted.downloadsToken = this.secrets.encrypt(input.downloadsToken);
    await this.providerCredentials.updateOne(
      { _id: "faceit" },
      { $set: { ...encrypted, updatedAt: new Date(), updatedBy: actor.identitySteam64 } },
      { upsert: true },
    );
    if (input.apiKey) this.config.faceitApiKey = input.apiKey;
    if (input.downloadsToken) this.config.faceitDownloadsToken = input.downloadsToken;
    if (input.downloadsToken) {
      await this.entries.updateMany(
        { source: "faceit", demoId: null, demoStatus: "access_required", "demoUrls.0": { $exists: true } },
        { $set: { demoStatus: "available", nextDownloadAt: new Date() }, $unset: { error: "" } },
      );
    }
    await this.connections.updateMany(
      { source: "faceit", enabled: true },
      { $set: { nextSyncAt: new Date() }, $unset: { lastError: "" } },
    );
    this.analysis.changed();
    return { ok: true };
  }
  async scope(actor: Actor, teamId?: string | null, edit = false) {
    if (teamId) {
      await this.analysis.team(
        teamId,
        actor,
        edit ? "analysis.import" : "analysis.read",
      );
      return `team:${teamId}`;
    }
    if (!authorize(actor, "demos.personal"))
      problem(403, "Melde dich mit Steam an.");
    return `user:${actor.identitySteam64}`;
  }
  async visible(actor: Actor) {
    const teams = await this.workspace.listTeams(actor.identitySteam64);
    return {
      $or: [
        { ownerId: actor.identitySteam64, teamId: null },
        { teamId: { $in: teams.map((t) => t.id) } },
      ],
    };
  }
  async list(actor: Actor) {
    const entries = await this.entries
      .find(await this.visible(actor), {
        projection: { _id: 0, scope: 0, demoUrls: 0, shareCode: 0 },
      })
      .sort({ playedAt: -1 })
      .limit(300)
      .toArray();
    for (const match of entries)
      if (match.demoId) {
        const demo = await this.analysis.demos.findOne(
          { _id: match.demoId },
          { projection: { status: 1 } },
        );
        if (!demo) {
          match.demoId = null;
          match.demoStatus = "unavailable";
        } else
          match.demoStatus =
            demo.status === "failed"
              ? "failed"
              : demo.status === "ready"
                ? "imported"
                : "queued";
      }
    return { entries };
  }
  async connection(id: string, actor: Actor) {
    if (!uuid(id)) problem(404, "Matchquelle nicht gefunden.");
    const value = await this.connections.findOne({ _id: id });
    if (!value || value.ownerId !== actor.identitySteam64)
      problem(404, "Matchquelle nicht gefunden.");
    await this.scope(actor, value.teamId, true);
    return value;
  }
  async listConnections(actor: Actor) {
    return {
      entries: await this.connections
        .find(
          { ownerId: actor.identitySteam64 },
          { projection: { _id: 0, historySecret: 0, cursor: 0, lease: 0 } },
        )
        .toArray(),
      capabilities: {
        faceit: !!this.config.faceitApiKey,
        faceitDownloads: !!this.config.faceitDownloadsToken,
        steamHistory: !!this.config.steamWebApiKey,
        steamDownloads: this.steam.ready,
      },
    };
  }
  async connect(actor: Actor, input: any) {
    const scope = await this.scope(actor, input?.teamId || null, true);
    if (!["faceit", "premier"].includes(input.source))
      problem(400, "Wähle FACEIT oder Premier.");
    let playerId = actor.identitySteam64,
      historySecret = "",
      cursor = "";
    if (input.source === "faceit") {
      const player = await this.faceit(
        `/players?game=cs2&game_player_id=${encodeURIComponent(actor.identitySteam64)}`,
      );
      if (!uuid(player.player_id))
        problem(
          404,
          "Zu deinem Steam-Konto wurde kein FACEIT-Spieler gefunden.",
        );
      playerId = player.player_id;
    } else {
      const shareCode = parseMatchShareCode(input.shareCode);
      if (
        !shareCode ||
        typeof input.authenticationCode !== "string" ||
        !/^[A-Za-z0-9-]{10,100}$/.test(input.authenticationCode)
      )
        problem(
          400,
          "Gib den Game Authentication Code und einen aktuellen Match-Sharecode oder Steam-Match-Link ein.",
        );
      if (!this.secrets)
        problem(503, "Der sichere Quellenzugang ist noch nicht eingerichtet.");
      historySecret = this.secrets.encrypt(input.authenticationCode);
      cursor = shareCode;
    }
    if (
      (await this.connections.countDocuments({
        ownerId: actor.identitySteam64,
      })) >= 10
    )
      problem(400, "Es sind bereits zehn Matchquellen verbunden.");
    const value = {
      _id: randomUUID(),
      id: "",
      ownerId: actor.identitySteam64,
      teamId: input.teamId || null,
      scope,
      source: input.source,
      label:
        input.source === "faceit"
          ? "Meine FACEIT-Matches"
          : "Meine Premier-/Matchmaking-Matches",
      playerId,
      enabled: true,
      autoDownload: input.autoDownload === true,
      historySecret,
      cursor,
      hasHistoryAccess: !!historySecret,
      lastSyncAt: null,
      nextSyncAt: new Date(),
      createdAt: new Date().toISOString(),
    };
    value.id = value._id;
    await this.connections.insertOne(value);
    this.analysis.changed();
    return { id: value.id };
  }
  async faceit(path: string) {
    if (!this.config.faceitApiKey)
      problem(503, "Der Betreiber muss den FACEIT-Zugang noch einrichten.");
    return sourceJson(`https://open.faceit.com/data/v4${path}`, {
      headers: { Authorization: `Bearer ${this.config.faceitApiKey}` },
    });
  }
  async saveFaceit(raw: any, ownerId: string, teamId: string | null) {
    if (!uuid(raw.match_id))
      problem(502, "FACEIT lieferte keine gültige Match-ID.");
    const sides = Object.values(raw.teams || {}).map((side: any) => ({
      id: String(side.faction_id || side.team_id || ""),
      name: String(side.name || "Team").slice(0, 120),
      roster: (side.roster || side.players || [])
        .map((p) => String(p.player_id))
        .filter(uuid),
      score: null as number | null,
    }));
    const players: any[] = Object.values(raw.teams || {}).flatMap((side: any) =>
      (side.roster || side.players || []).map((p) => ({
        id: String(p.player_id),
        steamId:
          p.game_player_id && /^\d{17}$/.test(p.game_player_id)
            ? p.game_player_id
            : undefined,
        name: String(p.nickname || "Spieler").slice(0, 100),
      })),
    );
    const urls = Array.isArray(raw.demo_url)
      ? raw.demo_url.filter((u) => typeof u === "string").slice(0, 5)
      : [];
    const maps = Array.isArray(raw.voting?.map?.pick)
      ? raw.voting.map.pick.slice(0, 5)
      : [];
    const now = new Date().toISOString(),
      scope = teamId ? `team:${teamId}` : `user:${ownerId}`,
      output: string[] = [];
    for (
      let mapIndex = 0;
      mapIndex < Math.max(1, urls.length, maps.length);
      mapIndex++
    ) {
      const score =
        Math.max(1, urls.length, maps.length) === 1
          ? raw.results?.score || {}
          : {};
      let i = 0;
      for (const side of sides) {
        const value = score[`faction${++i}`];
        side.score =
          Number.isFinite(Number(value)) && value !== undefined
            ? Number(value)
            : null;
      }
      const data: MatchEntry & any = {
        ownerId,
        teamId,
        scope,
        source: "faceit",
        externalId: raw.match_id,
        mapIndex,
        title: sides.map((s) => s.name).join(" gegen ") || "FACEIT-Match",
        playedAt: new Date(
          (Number(raw.started_at || raw.finished_at) || Date.now() / 1000) *
            1000,
        ).toISOString(),
        map: typeof maps[mapIndex] === "string" ? maps[mapIndex] : "",
        players,
        sides,
        competition: String(raw.competition_name || "FACEIT").slice(0, 120),
        competitionId: String(raw.competition_id || ""),
        demoUrls: urls[mapIndex] ? [urls[mapIndex]] : [],
        demoStatus: urls[mapIndex]
          ? this.config.faceitDownloadsToken
            ? "available"
            : "access_required"
          : "unavailable",
      };
      const existing = await this.entries.findOneAndUpdate(
        { scope, source: "faceit", externalId: raw.match_id, mapIndex },
        {
          $set: data,
          $setOnInsert: { _id: randomUUID(), demoId: null, createdAt: now },
        },
        { upsert: true, returnDocument: "after" },
      );
      await this.entries.updateOne(
        { _id: existing._id },
        { $set: { id: existing._id } },
      );
      output.push(existing._id);
    }
    this.analysis.changed();
    return output;
  }
  async importFaceit(actor: Actor, input: any) {
    await this.scope(actor, input?.teamId || null, true);
    const value =
      String(input.matchId || "").match(/(?:room\/)?(1-[a-f0-9-]{36})/i)?.[1] ||
      input.matchId;
    if (!uuid(value))
      problem(400, "Gib eine FACEIT-Match-ID oder einen Matchroom-Link ein.");
    return this.saveFaceit(
      await this.faceit(`/matches/${encodeURIComponent(value)}`),
      actor.identitySteam64,
      input.teamId || null,
    );
  }
  async sync(connection: any) {
    if (this.syncing.has(connection._id))
      problem(409, "Diese Matchquelle wird bereits abgeglichen.");
    this.syncing.add(connection._id);
    try {
      return await this.syncConnection(connection);
    } finally {
      this.syncing.delete(connection._id);
    }
  }
  private async syncConnection(connection: any) {
    if (connection.source === "faceit") {
      const from = Math.floor(
        (connection.lastSyncAt
          ? Date.parse(connection.lastSyncAt) - 2 * 86400_000
          : Date.now() - 30 * 86400_000) / 1000,
      );
      for (let offset = 0; offset < 500; offset += 100) {
        const history = await this.faceit(
          `/players/${encodeURIComponent(connection.playerId)}/history?game=cs2&from=${from}&offset=${offset}&limit=100`,
        );
        for (const match of history.items || []) {
          const details = await this.faceit(
            `/matches/${encodeURIComponent(match.match_id)}`,
          );
          const ids = await this.saveFaceit(
            details,
            connection.ownerId,
            connection.teamId,
          );
          if (connection.autoDownload)
            await this.entries.updateMany(
              { _id: { $in: ids }, demoId: null },
              {
                $set: { autoDownload: true },
                $addToSet: { connectionIds: connection.id || connection._id },
              },
            );
        }
        if ((history.items || []).length < 100) break;
      }
    } else {
      if (!this.secrets)
        problem(503, "Der sichere Quellenzugang ist noch nicht eingerichtet.");
      if (!this.config.steamWebApiKey)
        problem(
          503,
          "Der Betreiber muss den Steam-History-Zugang noch einrichten.",
        );
      let cursor = connection.cursor;
      await this.saveShareCode(connection, cursor);
      for (let count = 0; count < 100; count++) {
        const params = new URLSearchParams({
          key: this.config.steamWebApiKey,
          steamid: connection.ownerId,
          steamidkey: this.secrets.decrypt(connection.historySecret),
          knowncode: cursor,
        });
        const next = await sourceJson(
          `https://api.steampowered.com/ICSGOPlayers_730/GetNextMatchSharingCode/v1/?${params}`,
        );
        const code = next.result?.nextcode;
        if (!code || code === "n/a" || code === cursor) break;
        if (!shareCodeValid(code))
          problem(502, "Steam lieferte keinen gültigen Folgematch-Code.");
        await this.saveShareCode(connection, code);
        cursor = code;
        await this.connections.updateOne(
          { _id: connection._id },
          { $set: { cursor } },
        );
      }
    }
    await this.connections.updateOne(
      { _id: connection._id },
      {
        $set: {
          lastSyncAt: new Date().toISOString(),
          nextSyncAt: new Date(Date.now() + 15 * 60_000),
        },
        $unset: { lastError: "" },
      },
    );
    this.analysis.changed();
  }
  async saveShareCode(connection: any, shareCode: string) {
    const require = (await import("node:module")).createRequire(
        import.meta.url,
      ),
      { ShareCode } = require("globaloffensive-sharecode");
    let decoded: any;
    try {
      decoded = new ShareCode(shareCode).decode();
    } catch {
      problem(400, "Der Match-Sharecode ist ungültig.");
    }
    const externalId = String(decoded.matchId);
    const value = await this.entries.findOneAndUpdate(
      { scope: connection.scope, source: "premier", externalId, mapIndex: 0 },
      {
        $setOnInsert: {
          _id: randomUUID(),
          ownerId: connection.ownerId,
          teamId: connection.teamId,
          scope: connection.scope,
          source: "premier",
          externalId,
          mapIndex: 0,
          title: "Premier / Matchmaking",
          playedAt: null,
          map: "",
          players: [],
          sides: [],
          competition: "Valve Matchmaking",
          competitionId: "",
          demoId: null,
          demoStatus: "access_required",
          shareCode,
          createdAt: new Date().toISOString(),
        },
        $set: { autoDownload: connection.autoDownload },
        $addToSet: { connectionIds: connection.id || connection._id },
      },
      { upsert: true, returnDocument: "after" },
    );
    await this.entries.updateOne(
      { _id: value._id },
      { $set: { id: value._id } },
    );
    return value._id;
  }
  async preparation(id: string, actor: Actor): Promise<Prematch> {
    if (!uuid(id)) problem(404, "Matchvorbereitung nicht gefunden.");
    const value = await this.preparations.findOne(
      { _id: id },
      { projection: { _id: 0 } },
    );
    if (!value) problem(404, "Matchvorbereitung nicht gefunden.");
    const team = await this.analysis.team(value.teamId, actor);
    if (!value.published && !authorize(actor, "analysis.scout", team))
      problem(404, "Die Vorbereitung ist noch nicht veröffentlicht.");
    return value as Prematch;
  }
  async savePreparation(actor: Actor, input: any, id?: string) {
    const previous = id ? await this.preparation(id, actor) : null;
    const teamId = previous?.teamId || input?.teamId;
    await this.analysis.team(teamId, actor, "analysis.scout");
    if (previous && previous.revision !== input.revision)
      problem(409, "Die Vorbereitung wurde inzwischen geändert.");
    const matchIds = input.matchIds || [],
      roster = input.roster || [],
      stratIds = input.stratIds || [];
    if (
      !Array.isArray(matchIds) ||
      matchIds.length > 200 ||
      matchIds.some((id) => !uuid(id)) ||
      !Array.isArray(roster) ||
      roster.length > 5 ||
      roster.some((id) => !uuid(id)) ||
      new Set(roster).size !== roster.length ||
      !Array.isArray(stratIds) ||
      stratIds.length > 20
    )
      problem(400, "Ungültige Match-, Spieler- oder Strat-Auswahl.");
    for (const matchId of matchIds)
      if (!(await this.entries.findOne({ _id: matchId, teamId })))
        problem(400, "Ein Match gehört nicht zu diesem Team.");
    for (const stratId of stratIds) {
      const strat = await this.workspace.getStrat(stratId);
      if (!strat || strat.teamId !== teamId || !strat.published)
        problem(400, "Wähle veröffentlichte Strats dieses Teams.");
    }
    const days = input.days || 90;
    if (![14, 30, 90, 180].includes(days))
      problem(400, "Wähle einen gültigen Zeitraum.");
    const value: Prematch = {
      id: previous?.id || randomUUID(),
      teamId,
      title: textField(input.title, "Name der Vorbereitung", 120, true),
      opponent: textField(input.opponent, "FACEIT-Team oder Matchroom", 300),
      competition: textField(input.competition || "", "Wettbewerb", 120),
      competitionSource: textField(
        input.competitionSource || "",
        "Turnier-Link",
        300,
      ),
      roster,
      matchIds: [...new Set(matchIds)] as string[],
      days,
      notes: textField(input.notes || "", "Matchplan", 10_000),
      stratIds: [...new Set(stratIds)] as string[],
      published: input.published === true,
      revision: (previous?.revision || 0) + 1,
      createdBy: previous?.createdBy || actor.identitySteam64,
      updatedAt: new Date().toISOString(),
    };
    await this.preparations.replaceOne(
      { _id: value.id, ...(previous && { revision: previous.revision }) },
      { _id: value.id, ...value },
      { upsert: !previous },
    );
    this.analysis.changed();
    return value;
  }
  async syncOpponent(id: string, actor: Actor) {
    const prep = await this.preparation(id, actor);
    await this.analysis.team(prep.teamId, actor, "analysis.scout");
    const matchId = prep.opponent.match(/room\/(1-[a-f0-9-]{36})/i)?.[1];
    let roster = prep.roster,
      ids: string[] = [];
    if (matchId)
      ids = await this.saveFaceit(
        await this.faceit(`/matches/${matchId}`),
        actor.identitySteam64,
        prep.teamId,
      );
    else {
      const teamId =
        prep.opponent.match(/teams\/([a-f0-9-]{36})/i)?.[1] || prep.opponent;
      if (!uuid(teamId))
        problem(400, "Gib eine FACEIT-Team-ID oder einen Team-Link ein.");
      const team = await this.faceit(`/teams/${encodeURIComponent(teamId)}`);
      if (!roster.length)
        roster = (team.members || [])
          .slice(0, 5)
          .map((p) => p.user_id || p.player_id)
          .filter(uuid);
      if (!roster.length)
        problem(404, "Bestätige zuerst das erwartete Gegner-Lineup.");
      const seen = new Set<string>();
      for (const player of roster) {
        const history = await this.faceit(
          `/players/${encodeURIComponent(player)}/history?game=cs2&from=${Math.floor(Date.now() / 1000 - prep.days * 86400)}&limit=30`,
        );
        for (const match of history.items || [])
          if (!seen.has(match.match_id) && seen.size < 100) {
            seen.add(match.match_id);
            ids.push(
              ...(await this.saveFaceit(
                await this.faceit(
                  `/matches/${encodeURIComponent(match.match_id)}`,
                ),
                actor.identitySteam64,
                prep.teamId,
              )),
            );
          }
      }
    }
    let competition = prep.competition;
    if (prep.competitionSource) {
      const parsed = prep.competitionSource.match(
        /(?:championship|tournament)\/([a-f0-9-]{36})/i,
      );
      if (!parsed)
        problem(400, "Gib einen FACEIT-Championship- oder Turnier-Link ein.");
      const kind = prep.competitionSource.includes("/tournament/")
        ? "tournaments"
        : "championships";
      const competitionId = parsed[1];
      const details = await this.faceit(`/${kind}/${competitionId}`);
      competition = String(details.name || competition).slice(0, 120);
      for (let offset = 0; offset < 500; offset += 100) {
        const history = await this.faceit(
          `/${kind}/${competitionId}/matches?${kind === "championships" ? "type=past&" : ""}offset=${offset}&limit=100`,
        );
        for (const match of history.items || []) {
          const players = Object.values(match.teams || {}).flatMap(
            (side: any) =>
              (side.roster || side.players || []).map((p) => p.player_id),
          );
          if (!players.some((player) => roster.includes(player))) continue;
          ids.push(
            ...(await this.saveFaceit(
              await this.faceit(
                `/matches/${encodeURIComponent(match.match_id)}`,
              ),
              actor.identitySteam64,
              prep.teamId,
            )),
          );
        }
        if ((history.items || []).length < 100) break;
      }
    }
    // Long provider requests must not overwrite a captain's newer selection.
    await this.preparations.updateOne(
      { _id: id, revision: prep.revision },
      {
        $set: {
          competition,
          roster,
          matchIds: [...new Set([...prep.matchIds, ...ids])].slice(0, 200),
          updatedAt: new Date().toISOString(),
        },
        $inc: { revision: 1 },
      },
    );
    this.analysis.changed();
  }
  async report(id: string, actor: Actor) {
    const preparation = await this.preparation(id, actor),
      team = await this.analysis.team(preparation.teamId, actor);
    const entries = await this.entries
      .find(
        {
          _id: { $in: preparation.matchIds },
          teamId: preparation.teamId,
          playedAt: {
            $gte: new Date(
              Date.now() - preparation.days * 86400_000,
            ).toISOString(),
          },
        },
        { projection: { _id: 0, demoUrls: 0, shareCode: 0, scope: 0 } },
      )
      .toArray();
    const maps = new Map<string, any>(),
      observations: any[] = [];
    let exact = 0,
      partial = 0,
      analyzed = 0,
      // Steam IDs of the confirmed five open the opponent analysis across their demos.
      opponentSteamIds: string[] = [];
    for (const match of entries) {
      if (
        preparation.competitionSource &&
        match.competitionId !==
          preparation.competitionSource.match(
            /(?:championship|tournament)\/([a-f0-9-]{36})/i,
          )?.[1]
      )
        continue;
      if (
        !preparation.competitionSource &&
        preparation.competition &&
        !match.competition
          .toLowerCase()
          .includes(preparation.competition.toLowerCase())
      )
        continue;
      const side = match.sides.find(
        (s) =>
          preparation.roster.length &&
          s.roster.length === 5 &&
          preparation.roster.every((p) => s.roster.includes(p)),
      );
      const overlap = Math.max(
        0,
        ...match.sides.map(
          (s) => s.roster.filter((p) => preparation.roster.includes(p)).length,
        ),
      );
      if (preparation.roster.length === 5 && side) exact++;
      else {
        partial += overlap > 0 ? 1 : 0;
      }
      if (!side || preparation.roster.length !== 5) continue;
      if (!opponentSteamIds.length)
        opponentSteamIds = match.players
          .filter((p) => side.roster.includes(p.id) && p.steamId)
          .map((p) => p.steamId);
      const demo = match.demoId
        ? await this.analysis.demo(match.demoId, actor).catch(() => null)
        : null;
      const map = demo?.summary?.map || match.map;
      if (map) {
        const bucket = maps.get(map) || {
          map,
          matches: 0,
          wins: 0,
          results: 0,
          matchIds: [],
        };
        bucket.matches++;
        bucket.matchIds.push(match.id);
        const rival = match.sides.find((s) => s !== side);
        if (side.score !== null && rival?.score !== null) {
          bucket.results++;
          if (side.score > rival.score) bucket.wins++;
        }
        maps.set(map, bucket);
      }
      if (demo?.status !== "ready") continue;
      analyzed++;
      const steamRoster = new Set(
        match.players
          .filter((p) => side.roster.includes(p.id) && p.steamId)
          .map((p) => p.steamId),
      );
      if (!steamRoster.size) continue;
      const groups = new Map<string, { rounds: number; scenes: any[] }>();
      for (const round of demo.summary.rounds.slice(0, 100)) {
        const replay = await this.analysis.replay(demo.id, round.id, actor);
        for (const kind of ["smokegrenade_detonate", "inferno_startburn"]) {
          const group = groups.get(kind) || { rounds: 0, scenes: [] };
          group.rounds++;
          const event = replay.events.find(
            (e) =>
              e.kind === kind && e.time <= 20 && steamRoster.has(e.playerId),
          );
          if (event && group.scenes.length < 12)
            group.scenes.push({
              demoId: demo.id,
              roundId: round.id,
              version: demo.summary.version,
              start: Math.max(0, event.time - 3),
              end: Math.min(round.duration, event.time + 5),
              focusId: event.playerId,
            });
          groups.set(kind, group);
        }
      }
      for (const [kind, group] of groups)
        if (group.scenes.length)
          observations.push({
            matchId: match.id,
            map,
            text: `Frühe ${kind === "smokegrenade_detonate" ? "Smoke" : "Molotov"} des Gegners`,
            rounds: group.rounds,
            examples: group.scenes,
            filter:
              "Erste 20 Sekunden nach Freeze-Ende, ohne Einkaufsfilter. Beispiele sind auf zwölf begrenzt.",
          });
    }
    return {
      preparation,
      entries,
      maps: [...maps.values()],
      observations,
      coverage: { found: entries.length, exact, partial, analyzed },
      steamRoster: opponentSteamIds,
      canEdit: authorize(actor, "analysis.scout", team),
    };
  }
}

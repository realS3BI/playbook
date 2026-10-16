import crypto from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { applyPlayerNadeRequest, applyGameReviewDecision } from "./nade-review.js";
import { replaceMeasuredLineup } from "./measured-lineup.js";
import { THROW_ATTRIBUTE_FIELDS } from "../shared/throw-attributes.js";
import { describeLineupThrow, withThrowSetup } from "../shared/throw-motion.js";
import {
  matchZySavedNadesConfigToNades,
  nadesToMatchZySavedNadesConfig,
  sanitizeNades
} from "./validators.js";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableNades(entries) {
  return JSON.stringify(sanitizeNades(entries).map((entry) => ({
    id: entry.id,
    name: entry.name,
    displayName: entry.displayName,
    mustKnow: entry.mustKnow === true,
    official: entry.official === true,
    reviewStatus: entry.reviewStatus || "",
    reviewMedia: entry.reviewMedia,
    landingPos: entry.landingPos,
    releasePos: entry.releasePos,
    releaseAng: entry.releaseAng,
    captureId: entry.captureId,
    throwTechnique: entry.throwTechnique,
    throwTrace: entry.throwTrace,
    ...Object.fromEntries([...THROW_ATTRIBUTE_FIELDS, "flightDuration", "throwFromTitle", "throwToTitle", "radarFrom", "radarTo"].map(key => [key, entry[key]])),
    map: entry.map,
    type: entry.type,
    team: entry.team,
    desc: entry.desc,
    lineupPos: entry.lineupPos,
    lineupAng: entry.lineupAng,
    owner: entry.owner
  })).sort((left, right) => `${left.owner}\0${left.map}\0${left.name}`.localeCompare(`${right.owner}\0${right.map}\0${right.name}`)));
}

function nadeKey(entry) {
  return `${entry.owner}\0${entry.map}\0${entry.name}`.toLowerCase();
}

function preservePanelMetadata(importedEntries, currentEntries) {
  const currentByKey = new Map(sanitizeNades(currentEntries).map((entry) => [nadeKey(entry), entry]));
  return importedEntries.map((entry) => {
    const current = currentByKey.get(nadeKey(entry));
    if (!current) return entry;
    // savednades.json is a training snapshot. Only explicit measured replacements may change a saved throw.
    return current;
  });
}

function captureKey(entry) {
  return `${nadeKey(entry)}\0${entry.captureId || ""}`;
}

function sameVector(left, right) {
  const a = String(left || "").trim().split(/\s+/).map(Number);
  const b = String(right || "").trim().split(/\s+/).map(Number);
  return a.length === 3 && b.length === 3 && a.every((n, i) => Number.isFinite(n) && Number.isFinite(b[i]) && Math.abs(n - b[i]) < 0.001);
}

export function mergeNadeCaptures(entries, captures) {
  if (!Array.isArray(captures)) throw new Error("Grenade captures must be an array");
  const byKey = new Map(captures.filter(c => c && typeof c === "object").map(c => [nadeKey(c), c]));
  const mergedEntries = entries.map(entry => {
    const capture = byKey.get(nadeKey(entry));
    if (!capture?.editRevision) return entry;
    try { return replaceMeasuredLineup(entry, capture); } catch { return entry; }
  });
  for (const capture of captures) {
    if (capture?.newLineup !== true || !capture.name || !/^[0-9]{17}$/.test(capture.owner || "") ||
        !capture.captureId || !sameVector(capture.landingPos, capture.landingPos) ||
        THROW_ATTRIBUTE_FIELDS.some(key => capture[key] === undefined || capture[key] === null) ||
        typeof capture.flightDuration !== "number" || !Number.isFinite(capture.flightDuration) || capture.flightDuration < 0 || mergedEntries.some(entry => nadeKey(entry) === nadeKey(capture))) continue;
    try {
      const [entry] = sanitizeNades([withThrowSetup({
        name: capture.name, displayName: capture.displayName, map: capture.map, type: capture.type,
        desc: capture.description || capture.throwTechnique || "Im Spiel aufgenommen",
        lineupPos: capture.lineupPos, lineupAng: capture.lineupAng, landingPos: capture.landingPos,
        owner: capture.owner, captureId: capture.captureId,
        throwTechnique: capture.throwTechnique, throwTrace: capture.throwTrace,
        team: capture.team,
        ...Object.fromEntries(THROW_ATTRIBUTE_FIELDS.filter(key => capture[key] !== null).map(key => [key, capture[key]])),
        ...(capture.flightDuration !== undefined && capture.flightDuration !== null ? { flightDuration: capture.flightDuration } : {}),
        updatedAt: capture.capturedAt
      })]);
      mergedEntries.push(entry);
    } catch { /* Ignore malformed capture entries; regular MatchZy sync remains available. */ }
  }
  return mergedEntries;
}

async function readJsonFile(path) {
  const content = await readFile(path, "utf8");
  return {
    content,
    hash: sha256(content),
    value: JSON.parse(content)
  };
}

async function writeJsonFileAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const content = `${JSON.stringify(value, null, 2)}\n`;
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  try {
    await writeFile(tmpPath, content, "utf8");
    await rename(tmpPath, path);
  } catch (error) {
    await unlink(tmpPath).catch(() => {});
    throw error;
  }
  return {
    content,
    hash: sha256(content)
  };
}

export class NadesSyncService {
  private queue: Promise<unknown> = Promise.resolve();

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(operation);
    this.queue = pending.catch(() => {});
    return pending;
  }

  // Persist processed capture IDs separately: old recording files may outlive a
  // lineup deletion, a service restart, or the plugin's in-memory capture list.
  private async captureReceipts(): Promise<Set<string>> {
    try {
      const { value } = await readJsonFile(`${dirname(this.liveFile)}/savednades.capture-receipts.json`);
      if (!Array.isArray(value) || value.some(item => typeof item !== "string")) throw new Error("Invalid capture receipts");
      return new Set(value);
    } catch (error) { if (error?.code === "ENOENT") return new Set(); throw error; }
  }

  private async rememberCaptures(entries, receipts?: Set<string>) {
    const known = receipts ?? await this.captureReceipts();
    const size = known.size;
    for (const entry of entries) if (entry.captureId) known.add(captureKey(entry));
    if (known.size !== size)
      await writeJsonFileAtomic(`${dirname(this.liveFile)}/savednades.capture-receipts.json`, [...known]);
  }

  async saveFromPanel(entries, mode: "replace" | "merge" = "replace") {
    return this.exclusive(async () => {
      const current = await this.store.getNades();
      // Seed receipts for captures imported before this version, before removing them.
      if (this.enabled) await this.rememberCaptures(current);
      const next = mode === "merge"
        ? [...new Map([...current, ...entries].map(entry => [nadeKey(entry), entry])).values()]
        : entries;
      const revised = next.map(entry => {
        const previous = current.find(n => nadeKey(n) === nadeKey(entry));
        const content = value => JSON.stringify({ ...value, updatedAt: undefined });
        return previous && content(previous) === content(entry) ? entry : {
          ...entry, updatedAt: new Date(Math.max(Date.now(), Date.parse(previous?.updatedAt) + 1 || 0)).toISOString()
        };
      });
      const saved = await this.store.saveNades(revised);
      await this.writeFromMongoUnlocked(saved);
      return saved;
    });
  }

  async changeFromPanel(change: (entries: any[]) => any[]) {
    return this.exclusive(async () => {
      const current = await this.store.getNades();
      const next = change(current);
      if (this.enabled) await this.rememberCaptures(current);
      const saved = await this.store.saveNades(next);
      await this.writeFromMongoUnlocked(saved);
      return saved;
    });
  }
  config: any;
  store: any;
  liveFile: string;
  runtimeFile: string;
  matchZyConfigFile: string;
  intervalMs: number;
  enabled: boolean;
  running: boolean;
  polling: boolean;
  timer: NodeJS.Timeout | null;
  lastSeenMtimeMs: number;
  lastSeenHash: string;
  lastSelfWrittenHash: string;
  lastReadAt: string;
  lastWriteAt: string;
  lastError: string;
  lastCheckAt: string;
  lastConfirmedAt: string;
  lastDirection: string;
  liveFilePresent: boolean;
  runtimeFilePresent: boolean;
  matchZyConfigPresent: boolean;
  globalSavesEnabled: boolean | null;

  constructor({ config, store }) {
    this.config = config;
    this.store = store;
    this.liveFile = config.liveNadesFile;
    this.runtimeFile = config.runtimeNadesFile;
    this.matchZyConfigFile = config.liveMatchZyConfigFile || `${dirname(this.liveFile)}/config.cfg`;
    this.intervalMs = Number.isFinite(config.nadesSyncIntervalMs) && config.nadesSyncIntervalMs > 0
      ? config.nadesSyncIntervalMs
      : 2000;
    this.enabled = config.nadesSyncEnabled !== false;
    this.running = false;
    this.polling = false;
    this.timer = null;
    this.lastSeenMtimeMs = 0;
    this.lastSeenHash = "";
    this.lastSelfWrittenHash = "";
    this.lastReadAt = "";
    this.lastWriteAt = "";
    this.lastError = "";
    this.lastCheckAt = "";
    this.lastConfirmedAt = "";
    this.lastDirection = "";
    this.liveFilePresent = false;
    this.runtimeFilePresent = false;
    this.matchZyConfigPresent = false;
    this.globalSavesEnabled = null;
  }

  status() {
    const state = !this.enabled
      ? "disabled"
      : this.lastError
          ? "error"
          : !this.running
            ? "stopped"
            : this.liveFilePresent && this.runtimeFilePresent && this.lastConfirmedAt
              ? "healthy"
              : "waiting";
    return {
      enabled: this.enabled,
      state,
      liveFile: this.liveFile,
      runtimeFile: this.runtimeFile,
      intervalMs: this.intervalMs,
      running: this.running,
      liveFilePresent: this.liveFilePresent,
      runtimeFilePresent: this.runtimeFilePresent,
      matchZyConfigPresent: this.matchZyConfigPresent,
      globalSavesEnabled: this.globalSavesEnabled,
      lastCheckAt: this.lastCheckAt,
      lastConfirmedAt: this.lastConfirmedAt,
      lastDirection: this.lastDirection,
      lastReadAt: this.lastReadAt,
      lastWriteAt: this.lastWriteAt,
      lastError: this.lastError
    };
  }

  async start() {
    if (!this.enabled || this.running) return;
    this.running = true;
    await this.exclusive(() => this.bootstrap());
    this.schedule();
  }

  async stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async bootstrap() {
    try {
      await this.refreshFileState();
      if (this.liveFilePresent) {
        await this.importLiveFile("startup");
        await this.importCaptures();
        return;
      }

      const nades = await this.store.getNades();
      if (nades.length > 0) {
        await this.writeFromMongoUnlocked(nades);
      }
    } catch (error) {
      await this.handleError(error, "startup");
    }
  }

  schedule() {
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      await this.poll();
      this.schedule();
    }, this.intervalMs);
  }

  async poll() {
    return this.exclusive(() => this.pollUnlocked());
  }

  private async pollUnlocked() {
    if (this.polling) return;
    this.polling = true;
    try {
      const fileStat = await this.refreshFileState();
      this.lastCheckAt = new Date().toISOString();
      if (!fileStat) {
        this.lastError = "";
        return;
      }

      const { content, hash, value } = await readJsonFile(this.liveFile);
      this.lastReadAt = this.lastCheckAt;
      this.lastConfirmedAt = this.lastCheckAt;
      this.lastError = "";
      if (fileStat.mtimeMs === this.lastSeenMtimeMs && hash === this.lastSeenHash) { await this.importCaptures(); return; }
      this.lastSeenMtimeMs = fileStat.mtimeMs;
      this.lastSeenHash = hash;

      if (hash === this.lastSelfWrittenHash) { await this.importCaptures(); return; }

      await this.importParsedConfig(value, hash, content.length, "poll");
      await this.importCaptures();
    } catch (error) {
      await this.handleError(error, "poll");
    } finally {
      this.polling = false;
    }
  }

  async importLiveFile(source) {
    const fileStat = await stat(this.liveFile);
    const { content, hash, value } = await readJsonFile(this.liveFile);
    this.lastSeenMtimeMs = fileStat.mtimeMs;
    this.lastSeenHash = hash;
    this.liveFilePresent = true;
    await this.importParsedConfig(value, hash, content.length, source);
  }

  async importParsedConfig(config, hash, bytes, source) {
    const importedEntries = matchZySavedNadesConfigToNades(config);
    const current = await this.store.getNades();
    const entries = preservePanelMetadata(importedEntries, current);
    if (stableNades(entries) !== stableNades(current)) {
      await this.store.replaceNadesFromSync(entries, { source, hash, bytes });
      this.lastDirection = "server-to-panel";
    }
    if (stableNades(entries) !== stableNades(importedEntries)) await this.writeFromMongoUnlocked(entries);
    else await this.writeMetadata(entries);
    this.lastReadAt = new Date().toISOString();
    this.lastConfirmedAt = this.lastReadAt;
    this.lastError = "";
  }

  async writeFromMongo(entries) {
    return this.exclusive(() => this.writeFromMongoUnlocked(entries));
  }

  private async writeFromMongoUnlocked(entries) {
    if (!this.enabled) return;
    const cleanEntries = sanitizeNades(entries);
    const config = nadesToMatchZySavedNadesConfig(cleanEntries);

    const liveWrite = await writeJsonFileAtomic(this.liveFile, config);
    this.lastSelfWrittenHash = liveWrite.hash;
    this.lastSeenHash = liveWrite.hash;
    const fileStat = await stat(this.liveFile).catch(() => null);
    this.lastSeenMtimeMs = fileStat?.mtimeMs || 0;

    await writeJsonFileAtomic(this.runtimeFile, config);
    await this.writeMetadata(cleanEntries);
    this.lastWriteAt = new Date().toISOString();
    this.lastConfirmedAt = this.lastWriteAt;
    this.lastDirection = "panel-to-server";
    await this.refreshFileState();
    this.lastError = "";
  }

  // Traces rarely change, while the metadata is rewritten on every capture poll.
  private steps = new Map<string, string[] | null>();
  private throwSteps(entry) {
    if (!entry.throwTrace) return null;
    const key = `${entry.throwTrace}\0${THROW_ATTRIBUTE_FIELDS.map(field => entry[field]).join("\0")}`;
    if (!this.steps.has(key)) {
      if (this.steps.size > 2000) this.steps.clear();
      const description = describeLineupThrow(entry);
      this.steps.set(key, description ? [description.lineup, description.movement, description.release] : null);
    }
    return this.steps.get(key);
  }

  async writeMetadata(entries) {
    await writeJsonFileAtomic(`${dirname(this.liveFile)}/savednades.metadata.json`, entries.map(entry => ({
      owner: entry.owner, map: entry.map, name: entry.name, team: entry.team, displayName: entry.displayName || "",
      mustKnow: entry.mustKnow === true, official: entry.official === true, reviewStatus: entry.reviewStatus || "", updatedAt: entry.updatedAt,
      reviewMediaSlots: Object.keys(entry.reviewMedia || {}),
      landingPos: entry.landingPos || null,
      ...Object.fromEntries([...THROW_ATTRIBUTE_FIELDS, "flightDuration", "throwFromTitle", "throwToTitle", "throwTechnique"].map(key => [key, entry[key]])),
      throwSteps: this.throwSteps(entry),
    })));
  }

  async importCaptures() {
    await this.importRequests();
    let captures;
    try { captures = (await readJsonFile(`${dirname(this.liveFile)}/savednades.captures.json`)).value; }
    catch (error) { if (error?.code === "ENOENT") return; throw error; }
    const current = await this.store.getNades();
    if (!Array.isArray(captures)) throw new Error("Grenade captures must be an array");
    const receipts = await this.captureReceipts();
    const present = new Set(current.map(nadeKey));
    const entries = mergeNadeCaptures(current, captures.filter(capture => capture &&
      (present.has(nadeKey(capture)) || !receipts.has(captureKey(capture)))));
    if (stableNades(entries) !== stableNades(current)) {
      await this.store.replaceNadesFromSync(entries, { source: "grenade-capture" });
      await this.writeFromMongoUnlocked(entries);
      this.lastDirection = "server-to-panel";
    }
    await this.writeMetadata(entries);
    await this.rememberCaptures(entries, receipts);
  }

  async importRequests() {
    const directory = `${dirname(this.liveFile)}/savednades.requests`;
    let files: string[];
    try { files = await readdir(directory); }
    catch (error) { if (error?.code === "ENOENT") return; throw error; }
    for (const file of files.filter(name => /^[0-9a-f]{32}\.json$/.test(name)).sort()) {
      const path = `${directory}/${file}`;
      // Persist completion independently of result delivery/deletion by the game.
      // A request that cannot be unlinked must never be applied again next poll.
      const receipt = `${directory}/processed/${file}`;
      if (await stat(receipt).then(() => true).catch(error => { if (error.code === "ENOENT") return false; throw error; })) {
        await unlink(path).catch(error => { if (!["ENOENT", "EACCES", "EPERM"].includes(error.code)) throw error; });
        continue;
      }
      const { value: request } = await readJsonFile(path);
      const current = await this.store.getNades();
      let next;
      try {
        next = ["approve", "reject"].includes(request.action)
          ? applyGameReviewDecision(current, request, await this.store.getUser(request.actor))
          : applyPlayerNadeRequest(current, request);
      }
      catch (error) {
        await writeJsonFileAtomic(receipt, { ok: false, message: error.message });
        await writeJsonFileAtomic(`${directory}/results/${file}`, { ok: false, message: error.message });
        await unlink(path);
        continue;
      }
      await this.rememberCaptures(current);
      const saved = await this.store.saveNades(next);
      await this.writeFromMongoUnlocked(saved);
      await writeJsonFileAtomic(receipt, { ok: true, message: "Änderung übernommen." });
      await writeJsonFileAtomic(`${directory}/results/${file}`, { ok: true, message: "Änderung übernommen." });
      await unlink(path);
    }
  }

  async refreshFileState() {
    const [liveFileStat, runtimeFileStat, matchZyConfig] = await Promise.all([
      stat(this.liveFile).catch((error) => {
        if (error?.code === "ENOENT") return null;
        throw error;
      }),
      stat(this.runtimeFile).catch((error) => {
        if (error?.code === "ENOENT") return null;
        throw error;
      }),
      readFile(this.matchZyConfigFile, "utf8").catch((error) => {
        if (error?.code === "ENOENT") return null;
        throw error;
      })
    ]);

    this.liveFilePresent = Boolean(liveFileStat);
    this.runtimeFilePresent = Boolean(runtimeFileStat);
    this.matchZyConfigPresent = matchZyConfig !== null;
    const globalSavesMatch = matchZyConfig?.match(/^\s*matchzy_save_nades_as_global_enabled\s+"?([^"\s]+)"?/m);
    this.globalSavesEnabled = globalSavesMatch
      ? ["1", "true"].includes(globalSavesMatch[1].toLowerCase())
      : null;
    return liveFileStat;
  }

  async handleError(error, source) {
    this.lastError = error?.message || String(error);
    this.lastCheckAt = new Date().toISOString();
    await this.store.logAction("nades_sync", "failed", this.lastError, { source }).catch(() => {});
  }
}

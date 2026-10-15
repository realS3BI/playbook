import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { createGunzip, gzip } from "node:zlib";
import { MAP_SCENE_NAME } from "../shared/map-scene.js";

// Bump to re-export every map after changing the export or optimisation settings.
export const MAP_SCENE_PIPELINE = 3;
const MANIFEST = "manifest.json";
const STATUS = "status.json";
const LOG_LINES = 300;
// The worker refreshes its status at least this often, also during a long export.
export const SCENE_HEARTBEAT_MS = 30 * 1000;
const SCENE_FILE = /^[a-z0-9_]{1,64}-[0-9a-f]{16}\.(?:glb|webp)$/;
const STORED_FILE = /^([a-z0-9_]{1,64}-[0-9a-f]{16}\.(?:glb|webp))(?:\.gz)?$/;
// SteamCMD rewrites map archives in place. Wait until an update has settled.
const SETTLE_MS = 5 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000;

type Source = { size: number; mtimeMs: number };
type SceneEntry = { scene: string; lightmap: string | null; source: Source; pipeline: number; bytes: number; exportedAt: string };
type Failure = { source: Source; pipeline: number; error: string; at: string };
export type SceneManifest = { maps: Record<string, SceneEntry>; failures: Record<string, Failure> };
export type SceneBuild = { scene: Uint8Array; lightmap: Uint8Array | null };
export type SceneStatus = {
  startedAt: string; updatedAt: string; intervalSeconds: number; maps: string[];
  current: { map: string; startedAt: string } | null; nextCheckAt: string | null; log: { at: string; message: string }[];
};

export async function readSceneManifest(directory: string): Promise<SceneManifest> {
  try {
    const parsed = JSON.parse(await readFile(join(directory, MANIFEST), "utf8"));
    return { maps: parsed?.maps || {}, failures: parsed?.failures || {} };
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return { maps: {}, failures: {} };
    throw error;
  }
}

async function writeJson(directory: string, name: string, value: unknown) {
  const temp = join(directory, `${name}.${process.pid}.tmp`);
  await writeFile(temp, JSON.stringify(value, null, 2));
  await rename(temp, join(directory, name));
}

async function readSceneStatus(directory: string): Promise<SceneStatus | null> {
  try { return JSON.parse(await readFile(join(directory, STATUS), "utf8")); }
  catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

// The worker runs in its own container; status.json tells the panel what it is doing.
export function sceneActivity(directory: string, intervalSeconds: number, print: (message: string) => void = console.log) {
  const startedAt = new Date().toISOString();
  const status: SceneStatus = { startedAt, updatedAt: startedAt, intervalSeconds, maps: [], current: null, nextCheckAt: null, log: [] };
  let writing = Promise.resolve();
  const save = () => {
    status.updatedAt = new Date().toISOString();
    const snapshot = structuredClone(status);
    writing = writing.then(() => mkdir(directory, { recursive: true })).then(() => writeJson(directory, STATUS, snapshot))
      .catch(error => print(`Status der Abwurfsichten nicht gespeichert: ${error.message}`));
    return writing;
  };
  return {
    status, save,
    log(message: string) {
      print(message);
      status.log.push({ at: new Date().toISOString(), message });
      status.log.splice(0, status.log.length - LOG_LINES);
      void save();
    },
    exporting(map: string | null) {
      status.current = map ? { map, startedAt: new Date().toISOString() } : null;
      void save();
    },
  };
}

// Per-map state for platform admins: ready, failed (with the next attempt), exporting or waiting.
export async function describeMapScenes(directory: string, now = Date.now()) {
  const [manifest, status] = await Promise.all([readSceneManifest(directory), readSceneStatus(directory)]);
  const alive = !!status && now - Date.parse(status.updatedAt) < 4 * SCENE_HEARTBEAT_MS;
  const current = alive ? status!.current : null;
  const maps = [...new Set([...(status?.maps || []), ...Object.keys(manifest.maps), ...Object.keys(manifest.failures)])];
  return {
    worker: status && { alive, startedAt: status.startedAt, updatedAt: status.updatedAt, intervalSeconds: status.intervalSeconds, current, nextCheckAt: alive ? status.nextCheckAt : null },
    maps: maps.map(map => {
      const scene = manifest.maps[map], failure = manifest.failures[map]?.pipeline === MAP_SCENE_PIPELINE ? manifest.failures[map] : undefined;
      const state = current?.map === map ? "exporting" : failure ? "failed" : scene?.pipeline === MAP_SCENE_PIPELINE ? "ready" : "waiting";
      return {
        map, state, available: !!scene, bytes: scene?.bytes ?? null, exportedAt: scene?.exportedAt ?? null,
        error: failure?.error ?? null, failedAt: failure?.at ?? null,
        retryAt: failure ? new Date(Date.parse(failure.at) + RETRY_MS).toISOString() : null,
      };
    }),
    log: status?.log || [],
  };
}

export function mapSceneSourcePath(gameDir: string, map: string) {
  return join(gameDir, "csgo", "maps", `${map}.vpk`);
}

// Meshopt output is meant to be followed by gzip. Scenes are stored compressed once,
// the name keeps the hash of the uncompressed file.
async function storeSceneFile(directory: string, map: string, extension: string, content: Uint8Array, compress = false) {
  const name = `${map}-${createHash("sha256").update(content).digest("hex").slice(0, 16)}.${extension}`;
  const stored = compress ? `${name}.gz` : name, temp = join(directory, `${stored}.tmp`);
  await writeFile(temp, compress ? await promisify(gzip)(content, { level: 9 }) : content);
  await rename(temp, join(directory, stored));
  return name;
}

async function removeUnusedSceneFiles(directory: string, manifest: SceneManifest) {
  const used = new Set(Object.values(manifest.maps).flatMap(entry => [entry.scene, entry.lightmap]));
  for (const name of await readdir(directory)) {
    const file = STORED_FILE.exec(name)?.[1];
    if (file && !used.has(file)) await rm(join(directory, name), { force: true });
  }
}

// Exports maps whose archive is new or changed since the last export, in the given order. A failed
// export is retried after an hour, or as soon as Valve ships a new version of the map.
export async function refreshMapScenes({ maps, gameDir, directory, build, now = Date.now(), log = console.log, signal = undefined as AbortSignal | undefined,
  onExport = (_map: string | null) => {} }) {
  await mkdir(directory, { recursive: true });
  const passStarted = Date.now(), at = () => new Date(now + Date.now() - passStarted).toISOString();
  const manifest = await readSceneManifest(directory);
  const sameSource = (a: Source | undefined, b: Source) => a?.size === b.size && a?.mtimeMs === b.mtimeMs;
  let exported = 0;
  for (const map of [...new Set<string>(maps)].filter(map => MAP_SCENE_NAME.test(map))) {
    if (signal?.aborted) break;
    let source: Source;
    try {
      const info = await stat(mapSceneSourcePath(gameDir, map));
      source = { size: info.size, mtimeMs: Math.round(info.mtimeMs) };
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (now - source.mtimeMs < SETTLE_MS) continue;
    const current = manifest.maps[map], failure = manifest.failures[map];
    if (current?.pipeline === MAP_SCENE_PIPELINE && sameSource(current.source, source)) continue;
    if (failure?.pipeline === MAP_SCENE_PIPELINE && sameSource(failure.source, source) && now - Date.parse(failure.at) < RETRY_MS) continue;
    const started = Date.now();
    try {
      log(`Abwurfsicht für ${map} wird exportiert ...`);
      onExport(map);
      const result: SceneBuild = await build(map);
      const scene = await storeSceneFile(directory, map, "glb", result.scene, true);
      const lightmap = result.lightmap ? await storeSceneFile(directory, map, "webp", result.lightmap) : null;
      manifest.maps[map] = { scene, lightmap, source, pipeline: MAP_SCENE_PIPELINE,
        bytes: result.scene.byteLength + (result.lightmap?.byteLength || 0), exportedAt: at() };
      delete manifest.failures[map];
      exported++;
      log(`Abwurfsicht für ${map} bereit: ${(manifest.maps[map].bytes / 1048576).toFixed(1)} MB in ${Math.round((Date.now() - started) / 1000)} s.`);
    } catch (error) {
      if (signal?.aborted) break;
      manifest.failures[map] = { source, pipeline: MAP_SCENE_PIPELINE, error: String(error.message || error).slice(0, 2000), at: at() };
      log(`Abwurfsicht für ${map} fehlgeschlagen: ${manifest.failures[map].error}`);
    } finally { onExport(null); }
    await writeJson(directory, MANIFEST, manifest);
    await removeUnusedSceneFiles(directory, manifest);
  }
  return exported;
}

export function installMapScenes(app, { directory }: { directory: string }) {
  app.locals.live?.get(app, "/api/admin/map-scenes", () => describeMapScenes(directory), 5000, true);
  app.get("/api/map-scenes/:map", async (req, res, next) => {
    try {
      const map = String(req.params.map || "");
      const entry = MAP_SCENE_NAME.test(map) ? (await readSceneManifest(directory)).maps[map] : undefined;
      if (!entry) return res.status(404).json({ error: "Für diese Map gibt es noch keine Abwurfsicht." });
      res.set("Cache-Control", "no-cache").json({
        map, scene: `/api/map-scenes/files/${entry.scene}`, lightmap: entry.lightmap ? `/api/map-scenes/files/${entry.lightmap}` : null,
        bytes: entry.bytes, exportedAt: entry.exportedAt,
      });
    } catch (error) { next(error); }
  });
  // Names contain the content hash, so a new export always gets a new URL.
  app.get("/api/map-scenes/files/:file", async (req, res, next) => {
    const file = String(req.params.file || "");
    if (!SCENE_FILE.test(file)) return res.status(404).end();
    res.type(file.endsWith(".glb") ? "model/gltf-binary" : "image/webp");
    const compressed = join(directory, `${file}.gz`);
    try {
      await stat(compressed);
    } catch (error) {
      if (error.code !== "ENOENT") return next(error);
      return res.sendFile(join(directory, file), { maxAge: "365d", immutable: true, dotfiles: "deny" }, error => {
        if (!error) return;
        if ((error as any).code === "ENOENT" || (error as any).status === 404) { if (!res.headersSent) res.status(404).end(); }
        else next(error);
      });
    }
    res.vary("Accept-Encoding");
    if (req.acceptsEncodings("gzip")) {
      res.set("Content-Encoding", "gzip");
      return res.sendFile(compressed, { maxAge: "365d", immutable: true, dotfiles: "deny" }, error => { if (error) next(error); });
    }
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    try { await pipeline(createReadStream(compressed), createGunzip(), res); }
    catch (error) { if (!res.headersSent) next(error); else res.destroy(error); }
  });
}

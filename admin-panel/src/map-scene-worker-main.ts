import { MongoClient } from "mongodb";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { refreshMapScenes } from "./map-scenes.js";
import { buildMapScene } from "./map-scene-export.js";
import { ACTIVE_DUTY_MAPS } from "../shared/maps.js";

const abort = new AbortController();
process.on("SIGTERM", () => abort.abort());
process.on("SIGINT", () => abort.abort());

const gameDir = process.env.MAP_SCENE_GAME_DIR || "/cs2-data/game";
const directory = process.env.MAP_SCENE_DIR || "/uploads/map-scenes";
const viewer = process.env.MAP_SCENE_VIEWER || "/opt/source2viewer/Source2Viewer-CLI";
const interval = Math.max(60, Number(process.env.MAP_SCENE_INTERVAL_SECONDS) || 600) * 1000;
const workRoot = join(directory, ".work");
const client = new MongoClient(process.env.MAP_SCENE_MONGODB_URI || "mongodb://mongodb:27017/cs2_admin_panel");

// Active duty maps always get a scene. Other maps follow with their first lineup.
async function sceneMaps(db) {
  const document = await db.collection("nades").findOne({ _id: "current" }, { projection: { "entries.map": 1 } });
  return [...ACTIVE_DUTY_MAPS.map(map => map.mapName), ...(document?.entries || []).map(entry => String(entry?.map || ""))];
}

try {
  await client.connect();
  const db = client.db(process.env.MAP_SCENE_DATABASE || "cs2_admin_panel");
  await rm(workRoot, { recursive: true, force: true });
  console.log(`Abwurfsichten: prüfe ${gameDir} alle ${interval / 1000} s.`);
  while (!abort.signal.aborted) {
    try {
      await refreshMapScenes({ maps: await sceneMaps(db), gameDir, directory, signal: abort.signal,
        build: map => buildMapScene({ viewer, gameDir, map, workRoot, signal: abort.signal }) });
    } catch (error) {
      if (!abort.signal.aborted) console.error("Abwurfsichten vorübergehend nicht verfügbar:", error.message);
    }
    await wait(interval, undefined, { signal: abort.signal }).catch(() => {});
  }
} finally {
  await client.close();
}

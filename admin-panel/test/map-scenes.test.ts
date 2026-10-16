import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import express from "express";
import { lineupCamera, sourceToScene, VERTICAL_FOV_DEGREES } from "../shared/map-scene.js";
import { describeMapScenes, installMapScenes, MAP_SCENE_PIPELINE, readSceneManifest, refreshMapScenes, sceneActivity } from "../src/map-scenes.js";
import { hiddenSceneMaterial, lightmapCoordinates } from "../src/map-scene-export.js";
import { createApp } from "../src/app.js";

const close = (a: number[], b: number[]) => a.every((value, index) => Math.abs(value - b[index]) < 1e-9);

test("lineup cameras sit at eye height and look along the stored angles", () => {
  assert.deepEqual(sourceToScene([100, 200, 300]), [200 * 0.0254, 300 * 0.0254, 100 * 0.0254]);
  const standing = lineupCamera({ lineupPos: "-160 888 -89", lineupAng: "0 0 0" })!;
  assert.ok(close(standing.eye, sourceToScene([-160, 888, -25])));
  assert.ok(close(standing.forward, [0, 0, 1]));
  const crouching = lineupCamera({ lineupPos: "-160 888 -89", lineupAng: "-90 0 0", is_crouch: true })!;
  assert.ok(close(crouching.eye, sourceToScene([-160, 888, -43])));
  assert.ok(close(crouching.forward, [0, 1, 0]), "negative pitch looks up");
  assert.ok(close(lineupCamera({ lineupPos: "0 0 0", lineupAng: "0 90 0" })!.forward, [1, 0, 0]), "yaw 90 looks along +Y");
  assert.equal(lineupCamera({ lineupPos: "1 2", lineupAng: "0 0 0" }), null);
  assert.equal(Math.round(VERTICAL_FOV_DEGREES * 100) / 100, 73.74);
});

test("the camera stands on the floor below a mid-air release point, like a loaded lineup in game", () => {
  const jumpthrow = { lineupPos: "-160.073 887.9539 -88.98438", lineupAng: "-50.9 -146.8 0" };
  assert.ok(close(lineupCamera(jumpthrow, -135.67)!.eye, sourceToScene([-160.073, 887.9539, -135.67 + 64])));
  assert.ok(close(lineupCamera({ ...jumpthrow, is_crouch: true }, -135.67)!.eye, sourceToScene([-160.073, 887.9539, -135.67 + 46])));
  assert.ok(close(lineupCamera(jumpthrow, -400)!.eye, sourceToScene([-160.073, 887.9539, -88.98438 + 64])), "a floor far below is a different level");
  assert.ok(close(lineupCamera(jumpthrow, null)!.eye, sourceToScene([-160.073, 887.9539, -88.98438 + 64])), "without a floor the stored origin is used");
  assert.ok(close(lineupCamera(jumpthrow, -135.67)!.position, sourceToScene([-160.073, 887.9539, -88.98438])));
});

test("tool, sky and light shaft materials are left out of the scene", () => {
  assert.equal(hiddenSceneMaterial({ Name: "materials/tools/toolsblocklight.vmat", ShaderName: "csgo_lightmappedgeneric.vfx" }), true);
  assert.equal(hiddenSceneMaterial({ Name: "materials/effects/light_shaft.vmat", ShaderName: "csgo_effects.vfx" }), true);
  assert.equal(hiddenSceneMaterial({ Name: "materials/skybox/sky.vmat", ShaderName: "sky.vfx" }), true);
  assert.equal(hiddenSceneMaterial({ Name: "materials/de_anubis/caustics_001_decal.vmat", ShaderName: "csgo_static_overlay.vfx" }), true);
  assert.equal(hiddenSceneMaterial({ Name: "materials/de_mirage/plaster.vmat", ShaderName: "csgo_lightmappedgeneric.vfx" }), false);
});

test("the lightmap UV set is the one inside the atlas, wherever the shader put it", () => {
  const uv = (min: number[], max: number[]) => ({ getElementSize: () => 2, getMin: () => min, getMax: () => max });
  const atlas = uv([0.06, 0.09], [0.97, 0.99]), tiling = uv([-6.26, -2.48], [2.48, 4.89]);
  const primitive = (sets: Record<string, any>) => ({ getAttribute: (name: string) => sets[name] || null });
  assert.equal(lightmapCoordinates(primitive({ TEXCOORD_0: tiling, TEXCOORD_1: tiling, TEXCOORD_2: atlas })), atlas, "csgo_environment keeps it in the third set");
  assert.equal(lightmapCoordinates(primitive({ TEXCOORD_0: tiling, TEXCOORD_1: atlas })), atlas);
  assert.equal(lightmapCoordinates(primitive({ TEXCOORD_0: tiling, TEXCOORD_1: tiling })), null, "tiling texture coordinates never sample the atlas");
  assert.equal(lightmapCoordinates(primitive({ TEXCOORD_0: atlas })), null);
});

async function sceneFixture() {
  const root = await mkdtemp(join(tmpdir(), "map-scenes-"));
  const gameDir = join(root, "game"), directory = join(root, "scenes");
  await mkdir(join(gameDir, "csgo", "maps"), { recursive: true });
  const archive = async (map: string, content: string, age = 60 * 60 * 1000) => {
    const path = join(gameDir, "csgo", "maps", `${map}.vpk`);
    await writeFile(path, content);
    const time = new Date(Date.now() - age);
    await utimes(path, time, time);
  };
  return { root, gameDir, directory, archive };
}

test("scenes are exported once per map version and replaced files are removed", async () => {
  const { root, gameDir, directory, archive } = await sceneFixture();
  try {
    await archive("de_mirage", "version 1");
    await archive("de_updating", "half written", 1000);
    const built: string[] = [];
    const build = async map => { built.push(map); return { scene: Buffer.from(`${map} scene ${built.length}`), lightmap: map === "de_mirage" ? Buffer.from("atlas") : null }; };
    const options = { gameDir, directory, build, log: () => {} };
    assert.equal(await refreshMapScenes({ ...options, maps: ["de_mirage", "de_mirage", "de_missing", "de_updating", "../etc"] }), 1);
    assert.deepEqual(built, ["de_mirage"], "missing, still changing and invalid maps are skipped");
    const first = (await readSceneManifest(directory)).maps.de_mirage;
    assert.equal(first.pipeline, MAP_SCENE_PIPELINE);
    assert.match(first.scene, /^de_mirage-[0-9a-f]{16}\.glb$/);
    assert.match(first.lightmap!, /^de_mirage-[0-9a-f]{16}\.webp$/);
    assert.equal(gunzipSync(await readFile(join(directory, `${first.scene}.gz`))).toString(), "de_mirage scene 1", "scenes are stored compressed");

    assert.equal(await refreshMapScenes({ ...options, maps: ["de_mirage"] }), 0);
    assert.deepEqual(built, ["de_mirage"], "an unchanged archive is not exported again");

    const oldPipeline = await readSceneManifest(directory);
    oldPipeline.maps.de_mirage.pipeline = MAP_SCENE_PIPELINE - 1;
    await writeFile(join(directory, "manifest.json"), JSON.stringify(oldPipeline));
    assert.equal(await refreshMapScenes({ ...options, maps: ["de_mirage"] }), 1, "pipeline changes replace cached scenes even when the map archive is unchanged");

    await archive("de_mirage", "version 2 is longer");
    assert.equal(await refreshMapScenes({ ...options, maps: ["de_mirage"] }), 1);
    const second = (await readSceneManifest(directory)).maps.de_mirage;
    assert.notEqual(second.scene, first.scene);
    const files = (await readdir(directory)).filter(name => name !== "manifest.json").sort();
    assert.deepEqual(files, [second.lightmap, `${second.scene}.gz`].sort(), "the previous scene is deleted, the identical atlas is kept");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a failed export keeps the previous scene and waits an hour or for a new map version", async () => {
  const { root, gameDir, directory, archive } = await sceneFixture();
  try {
    await archive("de_nuke", "version 1");
    let attempts = 0, fail = false;
    const build = async () => { attempts++; if (fail) throw new Error("viewer crashed"); return { scene: Buffer.from(`scene ${attempts}`), lightmap: null }; };
    const options = { maps: ["de_nuke"], gameDir, directory, build, log: () => {} };
    await refreshMapScenes(options);
    const previous = (await readSceneManifest(directory)).maps.de_nuke;
    fail = true;
    await archive("de_nuke", "version 2 changed");
    assert.equal(await refreshMapScenes(options), 0);
    let manifest = await readSceneManifest(directory);
    assert.equal(manifest.maps.de_nuke.scene, previous.scene);
    assert.match(manifest.failures.de_nuke.error, /viewer crashed/);
    await refreshMapScenes(options);
    assert.equal(attempts, 2, "the same failing version is not retried immediately");
    await refreshMapScenes({ ...options, now: Date.now() + 61 * 60 * 1000 });
    assert.equal(attempts, 3);
    fail = false;
    await archive("de_nuke", "version 3 fixed it");
    await refreshMapScenes(options);
    manifest = await readSceneManifest(directory);
    assert.equal(manifest.failures.de_nuke, undefined);
    assert.notEqual(manifest.maps.de_nuke.scene, previous.scene);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("scene routes describe exported maps and serve hashed files with a long cache lifetime", async () => {
  const { root, gameDir, directory, archive } = await sceneFixture();
  const app = express();
  installMapScenes(app, { directory });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/map-scenes`;
  try {
    assert.equal((await fetch(`${base}/de_mirage`)).status, 404);
    await archive("de_mirage", "archive");
    await refreshMapScenes({ maps: ["de_mirage"], gameDir, directory, log: () => {}, build: async () => ({ scene: Buffer.from("glb"), lightmap: null }) });
    const response = await fetch(`${base}/de_mirage`);
    assert.equal(response.status, 200);
    const scene: any = await response.json();
    assert.equal(scene.lightmap, null);
    assert.match(scene.scene, /^\/api\/map-scenes\/files\/de_mirage-[0-9a-f]{16}\.glb$/);
    const fileUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}${scene.scene}`;
    const file = await fetch(fileUrl);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get("content-type"), "model/gltf-binary");
    assert.equal(file.headers.get("content-encoding"), "gzip");
    assert.match(file.headers.get("cache-control")!, /immutable/);
    assert.equal(await file.text(), "glb");
    const plain = await fetch(fileUrl, { headers: { "Accept-Encoding": "identity" } });
    assert.equal(plain.headers.get("content-encoding"), null);
    assert.match(plain.headers.get("cache-control")!, /immutable/);
    assert.equal(await plain.text(), "glb", "clients without gzip get the decompressed scene");
    assert.equal((await fetch(`${base}/files/manifest.json`)).status, 404);
    assert.equal((await fetch(`${base}/files/de_mirage-0000000000000000.glb`)).status, 404);
    assert.equal((await fetch(`${base}/De_Mirage`)).status, 404);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("every website role may load scenes, anonymous requests are rejected", async () => {
  let role = "training_player";
  const app = createApp({ config: { sessionSecret: "scene-test-secret", uploadDir: join(tmpdir(), "missing-uploads") }, compose: {}, nadesSync: null,
    store: {
      getSession: async () => ({ purpose: "user", steamId: "76561198000000001" }),
      getUser: async () => ({ identitySteam64: "76561198000000001", role }),
      getNades: async () => [],
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/map-scenes/de_mirage`;
  try {
    assert.equal((await fetch(url)).status, 401);
    for (role of ["player", "training_player", "match_admin", "admin"])
      assert.equal((await fetch(url, { headers: { Cookie: `cs2_panel_session=${"a".repeat(43)}` } })).status, 404, role);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("platform admins see per map whether a scene is ready, failed, exporting or waiting", async () => {
  const { root, gameDir, directory, archive } = await sceneFixture();
  try {
    await archive("de_mirage", "archive");
    await archive("de_nuke", "archive");
    const activity = sceneActivity(directory, 600, () => {});
    activity.status.maps = ["de_mirage", "de_nuke", "de_inferno", "de_ancient"];
    const exporting: (string | null)[] = [];
    await refreshMapScenes({ maps: ["de_mirage", "de_nuke"], gameDir, directory, log: activity.log, onExport: map => { exporting.push(map); activity.exporting(map); },
      build: async map => { if (map === "de_nuke") throw new Error("Source 2 Viewer nach 30 Minuten abgebrochen"); return { scene: Buffer.from("glb"), lightmap: null }; } });
    assert.deepEqual(exporting, ["de_mirage", null, "de_nuke", null]);
    activity.exporting("de_inferno");
    await activity.save();
    const status = await describeMapScenes(directory);
    assert.equal(status.worker?.alive, true);
    assert.equal(status.worker?.current?.map, "de_inferno");
    const byMap = Object.fromEntries(status.maps.map(entry => [entry.map, entry]));
    assert.equal(byMap.de_mirage.state, "ready");
    assert.equal(byMap.de_nuke.state, "failed");
    assert.match(byMap.de_nuke.error!, /30 Minuten/);
    assert.equal(Date.parse(byMap.de_nuke.retryAt!) - Date.parse(byMap.de_nuke.failedAt!), 60 * 60 * 1000);
    assert.equal(byMap.de_inferno.state, "exporting");
    assert.equal(byMap.de_ancient.state, "waiting");
    assert.deepEqual(status.log.map(line => line.message).slice(-1), ["Abwurfsicht für de_nuke fehlgeschlagen: Source 2 Viewer nach 30 Minuten abgebrochen"]);

    const stale = await describeMapScenes(directory, Date.now() + 5 * 60 * 1000);
    assert.equal(stale.worker?.alive, false);
    assert.equal(stale.maps.find(entry => entry.map === "de_inferno")!.state, "waiting", "a silent worker is not exporting anything");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("only platform admins read the export status", async () => {
  let role = "match_admin";
  const app = createApp({ config: { sessionSecret: "scene-test-secret", uploadDir: join(tmpdir(), "missing-uploads") }, compose: {}, nadesSync: null,
    store: {
      getSession: async () => ({ purpose: "user", steamId: "76561198000000001" }),
      getUser: async () => ({ identitySteam64: "76561198000000001", role }),
      getNades: async () => [],
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/admin/map-scenes`;
  const headers = { Cookie: `cs2_panel_session=${"a".repeat(43)}` };
  try {
    assert.equal((await fetch(url, { headers })).status, 403);
    role = "admin";
    const response = await fetch(url, { headers });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { worker: null, maps: [], log: [] });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

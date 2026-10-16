import { reviewMediaFixture } from "./review-fixtures.js";
import { assignNadeIds } from "../src/nade-ids.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as wait } from "node:timers/promises";
import { mergeNadeCaptures, NadesSyncService } from "../src/nades-sync.js";
import { applyWebNadeAction } from "../src/nade-review.js";
import { sanitizeNades } from "../src/validators.js";

test("game requests round-trip through sync and cannot undo a newer admin approval", async (t) => {
  const owner = "76561198000000001";
  const [entry] = sanitizeNades([sampleEntry({ owner, updatedAt: "2026-09-01T00:00:00.000Z" })]);
  const { service, store } = await createHarness(t, [entry]);
  await service.writeFromMongo([entry]);
  const directory = join(dirname(service.liveFile), "savednades.requests");
  const request = { id: "b".repeat(32), owner, actor: owner, map: entry.map, name: entry.name, revision: entry.updatedAt, action: "review" };
  await writeJson(join(directory, request.id + ".json"), request);
  await service.poll();
  assert.equal(store.entries[0].reviewStatus, "pending");
  const metadata = JSON.parse(await readFile(join(dirname(service.liveFile), "savednades.metadata.json"), "utf8"));
  assert.equal(metadata[0].reviewStatus, "pending");
  assert.equal(metadata[0].updatedAt, store.entries[0].updatedAt);
  const previousRevision = store.entries[0].updatedAt;
  await service.saveFromPanel([{ ...store.entries[0], desc: "Vom Admin korrigiert" }]);
  assert.notEqual(store.entries[0].updatedAt, previousRevision);
  const oldEdit = { ...request, id: "d".repeat(32), revision: previousRevision, action: "desc", value: "Veraltete Eingabe" };
  await writeJson(join(directory, oldEdit.id + ".json"), oldEdit);
  await service.poll();
  assert.equal(store.entries[0].desc, "Vom Admin korrigiert");
  const stale = { ...request, id: "c".repeat(32), revision: store.entries[0].updatedAt, action: "delete" };
  await service.saveFromPanel([{ ...store.entries[0], official: true, reviewStatus: "approved" }]);
  await writeJson(join(directory, stale.id + ".json"), stale);
  await service.poll();
  assert.equal(store.entries.length, 1);
  assert.equal(store.entries[0].official, true);
  const result = JSON.parse(await readFile(join(directory, "results", stale.id + ".json"), "utf8"));
  assert.equal(result.ok, false);
  // MatchZy may strip custom fields when rewriting its JSON; curator metadata survives.
  await writeJson(service.liveFile, sampleConfig({ owner }));
  await service.poll();
  assert.equal(store.entries[0].official, true);
  assert.equal(store.entries[0].reviewStatus, "approved");
});

function sampleEntry(patch: Record<string, any> = {}): any {
  return {
    name: "window_smoke",
    map: "de_mirage",
    type: "Smoke",
    desc: "from T roof",
    lineupPos: "1 2 3",
    lineupAng: "4 5 6",
    lineupImages: [],
    owner: "default",
    ...patch
  };
}

test("automatic throw data reaches the panel metadata and survives a training snapshot", async t => {
  const owner = "76561198000000001";
  const capture = sampleCapture({ owner, newLineup: true, team: "ct", is_jumpthrow: true, is_stepping: true, click_type: "both" });
  const { service, store } = await createHarness(t);
  await service.writeFromMongo([]);
  await writeJson(join(dirname(service.liveFile), "savednades.captures.json"), [capture]);
  await service.poll();
  assert.equal(store.entries[0].flightDuration, 3.125);
  let metadata = JSON.parse(await readFile(join(dirname(service.liveFile), "savednades.metadata.json"), "utf8"));
  assert.equal(metadata[0].flightDuration, 3.125);
  assert.equal(metadata[0].landingPos, capture.landingPos);
  assert.equal(metadata[0].click_type, "both");
  await writeJson(service.liveFile, sampleConfig({ owner, lineupPos: "99 99 99" }));
  await service.poll();
  assert.equal(store.entries[0].lineupPos, capture.lineupPos);
  assert.equal(store.entries[0].flightDuration, 3.125);
  assert.equal(store.entries[0].is_jumpthrow, true);
  const request = { id: "e".repeat(32), actor: owner, owner, map: capture.map, name: capture.name, revision: store.entries[0].updatedAt, action: "is_crouch", value: true };
  await writeJson(join(dirname(service.liveFile), "savednades.requests", request.id + ".json"), request);
  await service.poll();
  const result = JSON.parse(await readFile(join(dirname(service.liveFile), "savednades.requests", "results", request.id + ".json"), "utf8"));
  assert.equal(result.ok, false);
  metadata = JSON.parse(await readFile(join(dirname(service.liveFile), "savednades.metadata.json"), "utf8"));
  assert.equal(metadata[0].is_crouch, false);
  assert.equal(metadata[0].flightDuration, 3.125);
});

function sampleConfig(patch = {}) {
  const entry = sampleEntry(patch);
  return {
    [entry.owner]: {
      [entry.name]: {
        Id: assignNadeIds([entry])[0].id,
        LineupPos: entry.lineupPos,
        LineupAng: entry.lineupAng,
        Desc: entry.desc,
        Map: entry.map,
        Type: entry.type
      }
    }
  };
}

function comparable(entries) {
  return entries.map(({ updatedAt, id, ...entry }) => entry);
}

class FakeStore {
  entries: any[];
  actions: any[];

  constructor(entries = []) {
    this.entries = entries;
    this.actions = [];
  }

  async getNades() {
    return this.entries;
  }

  async saveNades(entries) {
    this.entries = entries;
    return entries;
  }

  async replaceNadesFromSync(entries, details = {}) {
    this.entries = entries;
    await this.logAction("nades_sync", "success", "Nades imported from MatchZy savednades.json", details);
    return entries;
  }

  async logAction(type, status, message, details = {}) {
    this.actions.push({ type, status, message, details });
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createHarness(t, entries = []) {
  const dir = await mkdtemp(join(tmpdir(), "nades-sync-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const store = new FakeStore(entries);
  const service = new NadesSyncService({
    config: {
      liveNadesFile: join(dir, "cs2", "savednades.json"),
      runtimeNadesFile: join(dir, "runtime", "playbook-lineups.json"),
      nadesSyncEnabled: true,
      nadesSyncIntervalMs: 10000
    },
    store
  });
  return { dir, store, service };
}

test("nades sync imports existing live file on startup", async (t) => {
  const { store, service } = await createHarness(t);
  await writeJson(service.liveFile, sampleConfig());

  await service.start();
  await service.stop();

  assert.deepEqual(comparable(store.entries), [sampleEntry()]);
  assert.equal(store.actions.at(-1).type, "nades_sync");
  assert.equal(store.actions.at(-1).status, "success");
});

test("nades sync writes Mongo entries when live file is missing on startup", async (t) => {
  const { service } = await createHarness(t, [sampleEntry()]);

  await service.start();
  await service.stop();

  assert.deepEqual(JSON.parse(await readFile(service.liveFile, "utf8")), sampleConfig());
  assert.deepEqual(JSON.parse(await readFile(service.runtimeFile, "utf8")), sampleConfig());
});

test("writeFromMongo atomically updates live and runtime files", async (t) => {
  const { service } = await createHarness(t);
  const updated = sampleEntry({ name: "stairs_flash", type: "Flash", desc: "pop flash" });

  await service.writeFromMongo([updated]);

  assert.deepEqual(JSON.parse(await readFile(service.liveFile, "utf8")), sampleConfig(updated));
  assert.deepEqual(JSON.parse(await readFile(service.runtimeFile, "utf8")), sampleConfig(updated));
  assert.ok(service.status().lastWriteAt);
  assert.equal(service.status().state, "stopped");

  await service.start();

  assert.equal(service.status().state, "healthy");
  assert.equal(service.status().liveFilePresent, true);
  assert.equal(service.status().runtimeFilePresent, true);
  await service.stop();
});

test("poll ignores a file change written by the service itself", async (t) => {
  const { store, service } = await createHarness(t);

  await service.writeFromMongo([sampleEntry()]);
  await service.poll();

  assert.deepEqual(store.actions, []);
});

test("poll imports external live file changes", async (t) => {
  const { store, service } = await createHarness(t, [sampleEntry()]);
  const external = sampleEntry({ name: "connector_molly", type: "Molly", desc: "deep molly" });

  await service.writeFromMongo([sampleEntry()]);
  await wait(5);
  await writeJson(service.liveFile, sampleConfig(external));
  await stat(service.liveFile);
  await service.poll();

  assert.deepEqual(comparable(store.entries), [external]);
  assert.equal(store.actions.at(-1).status, "success");
  assert.equal(service.status().lastDirection, "server-to-panel");
});

test("sync keeps lineup images when MatchZy updates the same nade", async (t) => {
  const image = {
    key: "lineup-image",
    url: "https://example.com/lineup.jpg",
    name: "lineup.jpg",
    size: 1234,
    uploadedAt: "2026-09-04T00:00:00.000Z"
  };
  const existing = sampleEntry({ lineupImages: [image] });
  const { store, service } = await createHarness(t, [existing]);
  const updated = sampleEntry({ desc: "updated in game" });
  await writeJson(service.liveFile, sampleConfig(updated));

  await service.importLiveFile("test");

  assert.equal(store.entries[0].desc, existing.desc);
  assert.deepEqual(store.entries[0].lineupImages, [image]);
});

test("sync keeps panel-only landing and radar positions", async (t) => {
  const existing = sampleEntry({
    landingPos: "7 8 9",
    throwFromTitle: "T Spawn",
    throwToTitle: "Window",
    radarFrom: { x: 0.72, y: 0.18 },
    radarTo: { x: 0.43, y: 0.49 }
  });
  const { store, service } = await createHarness(t, [existing]);
  await writeJson(service.liveFile, sampleConfig({ desc: "updated in game" }));

  await service.importLiveFile("test");

  assert.equal(store.entries[0].desc, existing.desc);
  assert.equal(store.entries[0].landingPos, "7 8 9");
  assert.equal(store.entries[0].throwFromTitle, "T Spawn");
  assert.equal(store.entries[0].throwToTitle, "Window");
  assert.deepEqual(store.entries[0].radarFrom, { x: 0.72, y: 0.18 });
  assert.deepEqual(store.entries[0].radarTo, { x: 0.43, y: 0.49 });
});

test("status reports the applied MatchZy global-save setting", async (t) => {
  const { service } = await createHarness(t, [sampleEntry()]);
  await writeJson(service.liveFile, sampleConfig());
  await writeJson(service.runtimeFile, sampleConfig());
  await writeFile(service.matchZyConfigFile, 'matchzy_save_nades_as_global_enabled "true"\n', "utf8");

  await service.start();

  assert.equal(service.status().state, "healthy");
  assert.equal(service.status().matchZyConfigPresent, true);
  assert.equal(service.status().globalSavesEnabled, true);
  await service.stop();
});

test("invalid live JSON is logged and does not overwrite Mongo entries", async (t) => {
  const existing = sampleEntry();
  const { store, service } = await createHarness(t, [existing]);
  await mkdir(dirname(service.liveFile), { recursive: true });
  await writeFile(service.liveFile, "{invalid", "utf8");

  await service.poll();

  assert.deepEqual(comparable(store.entries), [existing]);
  assert.equal(store.actions.at(-1).type, "nades_sync");
  assert.equal(store.actions.at(-1).status, "failed");
  assert.equal(service.status().state, "error");
});

function sampleCapture(patch = {}) {
  return { ...sampleEntry({ owner: "76561198000000001", updatedAt: "2026-09-01T00:00:00.000Z", is_jumpthrow: false, is_crouch: false, is_walking: false, is_running: false, is_stepping: false, click_type: "left" }), flightDuration: 3.125, newLineup: false, captureId: "throw-1", landingPos: "700 -800 900", capturedAt: "2026-09-29T16:00:00Z", ...patch };
}

test("new capture polling works even when MatchZy's library file is unchanged", async t => {
  const { store, service } = await createHarness(t);
  await service.writeFromMongo([]);
  await writeJson(join(dirname(service.liveFile), "savednades.captures.json"), [sampleCapture({ newLineup: true, displayName: "Fenster vom Spawn" })]);
  await service.poll();
  assert.equal(store.entries[0].landingPos, "700 -800 900");
  assert.equal(store.entries[0].flightDuration, 3.125);
  assert.equal(store.entries[0].displayName, "Fenster vom Spawn");
  const actionCount = store.actions.length;
  await service.poll();
  assert.equal(store.actions.length, actionCount);
});

test("sync keeps titles and landing points and publishes metadata when MatchZy omits extended fields", async (t) => {
  const existing = sampleEntry({ id: "Ab1Cd2E", displayName: "Fenster – T-Spawn", landingPos: "10 20 30" });
  const { store, service } = await createHarness(t, [existing]);
  await writeJson(service.liveFile, sampleConfig({ desc: "new instructions" }));
  await service.importLiveFile("test");
  assert.equal(store.entries[0].displayName, existing.displayName);
  assert.equal(store.entries[0].id, existing.id);
  const metadata = JSON.parse(await readFile(join(dirname(service.liveFile), "savednades.metadata.json"), "utf8"));
  assert.equal(metadata[0].displayName, existing.displayName);
  assert.equal(metadata[0].landingPos, existing.landingPos);
  await writeJson(service.liveFile, sampleConfig({ lineupPos: "2 3 4" }));
  await service.importLiveFile("test");
  const changed = JSON.parse(await readFile(join(dirname(service.liveFile), "savednades.metadata.json"), "utf8"));
  assert.equal(changed[0].landingPos, existing.landingPos);
});

test("captures respect owner, map, technical key, position and angle", () => {
  const entry = sampleEntry();
  for (const patch of [{ owner: "someone-else" }, { map: "de_dust2" }, { name: "other" },
    { lineupPos: "2 2 3" }, { lineupAng: "4 6 6" }, { landingPos: "NaN 0 0" }, { landingPos: "" }]) {
    assert.deepEqual(mergeNadeCaptures([entry], [sampleCapture(patch)]), [entry]);
  }

  const edited = sampleEntry({ captureId: "throw-1", landingPos: "9 8 7" });
  assert.deepEqual(mergeNadeCaptures([edited], [sampleCapture()]), [edited]);
  const next = mergeNadeCaptures([edited], [sampleCapture({ captureId: "throw-2" })]);
  assert.equal(next[0].landingPos, edited.landingPos);
});

test("a training snapshot cannot change saved throw data or manual references", async (t) => {
  const existing = sampleEntry({ landingPos: "7 8 9", captureId: "throw-1", radarFrom: { x: 0.1, y: 0.2 }, radarTo: { x: 0.4, y: 0.5 } });
  const { store, service } = await createHarness(t, [existing]);
  await writeJson(service.liveFile, sampleConfig({ lineupPos: "20 30 40" }));
  await service.importLiveFile("test");
  assert.equal(store.entries[0].landingPos, existing.landingPos);
  assert.deepEqual(store.entries[0].radarFrom, existing.radarFrom);
  assert.deepEqual(store.entries[0].radarTo, existing.radarTo);
  assert.equal(store.entries[0].captureId, existing.captureId);
  assert.equal(store.entries[0].lineupPos, existing.lineupPos);
});

test("deleting captured lineups survives polling and restart without blocking a new recording", async (t) => {
  const { store, service } = await createHarness(t);
  const captureFile = join(dirname(service.liveFile), "savednades.captures.json");
  const capture = sampleCapture({ newLineup: true });
  await service.writeFromMongo([]);
  await writeJson(captureFile, [capture]);
  await service.poll();
  assert.equal(store.entries.length, 1);

  await service.saveFromPanel([]);
  await service.poll();
  assert.equal(store.entries.length, 0);
  assert.deepEqual(JSON.parse(await readFile(service.liveFile, "utf8")), {});
  assert.deepEqual(JSON.parse(await readFile(service.runtimeFile, "utf8")), {});
  assert.deepEqual(JSON.parse(await readFile(join(dirname(service.liveFile), "savednades.metadata.json"), "utf8")), []);

  const restarted = new NadesSyncService({ config: service.config, store });
  await restarted.start();
  await restarted.stop();
  assert.equal(store.entries.length, 0);
  await writeJson(captureFile, [{ ...capture, captureId: "throw-2" }]);
  await restarted.poll();
  assert.equal(store.entries.length, 1);
  assert.equal(store.entries[0].captureId, "throw-2");
});

test("deleting a capture imported by an older panel seeds its receipt before saving", async (t) => {
  const captured = sampleEntry({ owner: "76561198000000001", captureId: "throw-1" });
  const { store, service } = await createHarness(t, [captured]);
  await service.writeFromMongo([captured]);
  await writeJson(join(dirname(service.liveFile), "savednades.captures.json"), [sampleCapture({ newLineup: true })]);
  await Promise.all([service.saveFromPanel([]), service.poll()]);
  assert.deepEqual(store.entries, []);
});

test("a new capture queued during a panel save is still imported", async (t) => {
  const { store, service } = await createHarness(t, [sampleEntry({ owner: "76561198000000001", captureId: "throw-1" })]);
  await service.writeFromMongo(store.entries);
  await writeJson(join(dirname(service.liveFile), "savednades.captures.json"), [
    sampleCapture({ newLineup: true }),
    sampleCapture({ newLineup: true, name: "new_flash", captureId: "throw-2", type: "Flash" })
  ]);
  await Promise.all([service.saveFromPanel([]), service.poll()]);
  assert.deepEqual(store.entries.map(entry => entry.name), ["new_flash"]);
});

test("Must Know survives MatchZy writes, publishes metadata and can be removed", async (t) => {
  const existing = sampleEntry({ mustKnow: true });
  const { store, service } = await createHarness(t, [existing]);
  await service.saveFromPanel([existing]);
  const metadataFile = join(dirname(service.liveFile), "savednades.metadata.json");
  assert.equal(JSON.parse(await readFile(metadataFile, "utf8"))[0].mustKnow, true);
  await writeJson(service.liveFile, sampleConfig({ desc: "updated by MatchZy" }));
  await service.poll();
  assert.equal(store.entries[0].mustKnow, true);
  await service.saveFromPanel([{ ...store.entries[0], mustKnow: false }]);
  await writeJson(service.liveFile, sampleConfig({ desc: "updated again" }));
  await service.poll();
  assert.equal(store.entries[0].mustKnow, false);
  assert.equal(JSON.parse(await readFile(metadataFile, "utf8"))[0].mustKnow, false);
});

test("completed request is never reapplied after a lost unlink or service restart", async (t) => {
  const owner = "76561198000000001";
  const [entry] = sanitizeNades([sampleEntry({ owner, updatedAt: "2026-09-01T00:00:00.000Z" })]);
  const { service, store } = await createHarness(t, [entry]);
  await service.writeFromMongo([entry]);
  const directory = join(dirname(service.liveFile), "savednades.requests");
  const request = { id: "f".repeat(32), owner, actor: owner, map: entry.map, name: entry.name, revision: entry.updatedAt, action: "review" };
  const file = join(directory, request.id + ".json");
  await writeJson(file, request);
  await service.poll();
  const revision = store.entries[0].updatedAt;
  const resultFile = join(directory, "results", request.id + ".json");
  const originalResult = await readFile(resultFile, "utf8");
  await writeJson(file, request); // A failed unlink leaves the same input on disk.
  const restarted = new NadesSyncService({ config: service.config, store });
  await restarted.poll();
  assert.equal(store.entries[0].updatedAt, revision);
  assert.equal(await readFile(resultFile, "utf8"), originalResult);
  await rm(resultFile);
  await writeJson(file, request);
  await restarted.poll();
  await assert.rejects(stat(resultFile), { code: "ENOENT" });
  assert.equal(store.entries[0].updatedAt, revision);
});


test("web edits share the sync queue and stale writes cannot replace a newer revision", async t => {
  const owner = "76561198000000001";
  const [entry, other] = sanitizeNades([sampleEntry({ owner }), sampleEntry({ name: "other" })]);
  const { service, store } = await createHarness(t, [entry, other]);
  await service.writeFromMongo([entry, other]);
  const request = { owner, map: entry.map, name: entry.name, revision: entry.updatedAt, action: "edit", patch: { throwToTitle: "Im Web geändert" } };
  const change = entries => applyWebNadeAction(entries, request, { identitySteam64: owner, role: "player" });
  const results = await Promise.allSettled([service.changeFromPanel(change), service.changeFromPanel(change)]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  if (results[1].status === "rejected") assert.equal(results[1].reason.status, 409);
  assert.equal(store.entries[0].throwToTitle, "Im Web geändert");
  assert.deepEqual(store.entries[1], other);
  const metadata = JSON.parse(await readFile(join(dirname(service.liveFile), "savednades.metadata.json"), "utf8"));
  assert.equal(metadata.find(n => n.owner === owner).updatedAt, store.entries[0].updatedAt);
  await service.poll();
  assert.equal(store.entries[0].throwToTitle, "Im Web geändert");
});

test("manual web creation publishes a playable nade and preserves its metadata through game sync", async t => {
  const owner = "76561198000000002";
  const [existing] = sanitizeNades([sampleEntry()]);
  const { service, store } = await createHarness(t, [existing]);
  await service.writeFromMongo([existing]);
  const entries = await service.changeFromPanel(entries => applyWebNadeAction(entries, {
    action: "create", map: "de_mirage", patch: { displayName: "Fenster über T-Spawn", type: "Smoke",
      lineupPos: "1 2 3", lineupAng: "0 90 0", team: "t", radarTo: { x: .5, y: .1 }, desc: "Jumpthrow" },
  }, { identitySteam64: owner, role: "admin" }));
  const created = entries.at(-1);
  const live = JSON.parse(await readFile(service.liveFile, "utf8"));
  assert.equal(live[owner][created.name].Map, "de_mirage");
  assert.equal(live[owner][created.name].LineupPos, "1 2 3");
  assert.equal(live[owner][created.name].LineupAng, "0 90 0");
  await writeJson(service.liveFile, live);
  await service.poll();
  const persisted = store.entries.find(n => n.owner === owner && n.name === created.name);
  assert.equal(persisted.displayName, "Fenster über T-Spawn");
  assert.deepEqual(persisted.radarTo, { x: .5, y: .1 });
  assert.equal(persisted.official, false);
  assert.equal(store.entries.length, 2);
});

test("explicit replacements use the request queue and reject stale replacement attempts", async t => {
  const owner = "76561198000000001";
  const [entry] = sanitizeNades([sampleEntry({ owner, flightDuration: 3.125, is_walking: true, reviewStatus: "pending", reviewMedia: reviewMediaFixture })]);
  const { service, store } = await createHarness(t, [entry]);
  await service.writeFromMongo([entry]);
  const oldLive = JSON.parse(await readFile(service.liveFile, "utf8"));
  const directory = join(dirname(service.liveFile), "savednades.requests");
  const replacement = sampleCapture({ editRevision: entry.updatedAt, captureId: "improved", lineupPos: "10 20 30", is_running: true, flightDuration: 2.5 });
  const request = { id: "e".repeat(32), actor: owner, owner, map: entry.map, name: entry.name, revision: entry.updatedAt, action: "replace", value: replacement };
  await writeJson(join(directory, request.id + ".json"), request);
  await service.poll();
  assert.equal(store.entries[0].flightDuration, 2.5);
  assert.equal(store.entries[0].is_running, true);
  assert.equal(store.entries[0].lineupPos, "10 20 30");
  assert.equal(store.entries[0].reviewStatus, "");
  assert.equal(store.entries[0].reviewMedia, undefined);
  let result = JSON.parse(await readFile(join(directory, "results", request.id + ".json"), "utf8"));
  assert.equal(result.ok, true);
  await writeJson(service.liveFile, oldLive);
  await service.poll();
  assert.equal(store.entries[0].flightDuration, 2.5);
  assert.equal(store.entries[0].lineupPos, "10 20 30");
  await writeJson(join(directory, "d".repeat(32) + ".json"), { ...request, id: "d".repeat(32) });
  await service.poll();
  result = JSON.parse(await readFile(join(directory, "results", "d".repeat(32) + ".json"), "utf8"));
  assert.equal(result.ok, false);
  const live = JSON.parse(await readFile(service.liveFile, "utf8"));
  assert.equal(live[owner][entry.name].LineupPos, "10 20 30");
});

test("team assignments survive game sync, captures and web revisions", async t => {
  const owner = "76561198000000001";
  const [entry] = sanitizeNades([sampleEntry({ owner, team: "t" })]);
  const { service, store } = await createHarness(t, [entry]);
  await service.writeFromMongo([entry]);
  await writeJson(service.liveFile, sampleConfig({ owner, desc: "Im Spiel geändert" }));
  await service.poll();
  assert.equal(store.entries[0].team, "t");
  assert.equal(store.entries[0].desc, entry.desc);
  await service.changeFromPanel(entries => applyWebNadeAction(entries, {
    owner, name: entry.name, map: entry.map, revision: entries[0].updatedAt, action: "edit", patch: { team: "both" },
  }, { identitySteam64: owner, role: "player" }));
  const metadata = JSON.parse(await readFile(join(dirname(service.liveFile), "savednades.metadata.json"), "utf8"));
  assert.equal(metadata[0].team, "both");
  await writeJson(service.liveFile, sampleConfig({ owner, desc: "Neue Beschreibung" }));
  await service.poll();
  assert.equal(store.entries[0].team, "both");
  const merged = mergeNadeCaptures(store.entries, [{ ...store.entries[0], captureId: "new-capture", landingPos: "10 20 30", capturedAt: new Date().toISOString() }]);
  assert.equal(merged[0].team, "both");
});


test("review media survive game rewrites and only current platform admins approve via the game queue", async t => {
  const actor = "76561198000000002";
  const [entry] = sanitizeNades([sampleEntry({ owner: "76561198000000001", throwFromTitle: "Start", throwToTitle: "Ende", reviewMedia: reviewMediaFixture })]);
  const { service, store } = await createHarness(t, [entry]);
  let role = "match_admin";
  Object.assign(store, { getUser: async steamId => steamId === actor ? { identitySteam64: actor, role } : null });
  await service.writeFromMongo([entry]);
  await writeJson(service.liveFile, sampleConfig({ owner: entry.owner, desc: "Im Spiel aktualisiert" }));
  await service.poll();
  assert.deepEqual(store.entries[0].reviewMedia, reviewMediaFixture);
  const metadata = JSON.parse(await readFile(join(dirname(service.liveFile), "savednades.metadata.json"), "utf8"));
  assert.deepEqual(metadata[0].reviewMediaSlots.sort(), Object.keys(reviewMediaFixture).sort());
  assert.equal(metadata[0].reviewMedia, undefined);
  const directory = join(dirname(service.liveFile), "savednades.requests");
  const request = { id: "f".repeat(32), actor, owner: entry.owner, map: entry.map, name: entry.name, revision: store.entries[0].updatedAt, action: "approve" };
  await writeJson(join(directory, request.id + ".json"), request);
  await service.poll();
  assert.notEqual(store.entries[0].official, true);
  role = "admin";
  await writeJson(join(directory, "a".repeat(32) + ".json"), { ...request, id: "a".repeat(32) });
  await service.poll();
  assert.equal(store.entries[0].official, true);
  assert.deepEqual(store.entries[0].reviewMedia, reviewMediaFixture);
});

test("recorded run-ups reach the panel as lineup, movement and release steps", async t => {
  const owner = "76561198000000001";
  const fixture = JSON.parse(await readFile("../server-plugin/Playbook.Tests/Fixtures/throw-motion.json", "utf8"));
  const run = fixture.find(item => item.name.startsWith("dust2 window"));
  const capture = sampleCapture({ owner, newLineup: true, lineupPos: "-1049.476 -961.8234 167.9531", lineupAng: "-18.45 93.16 0",
    throwTrace: JSON.stringify(run.trace), ...run.expected.attributes });
  const { service, store } = await createHarness(t);
  await service.writeFromMongo([]);
  await writeJson(join(dirname(service.liveFile), "savednades.captures.json"), [capture]);
  await service.poll();
  assert.equal(store.entries[0].lineupPos, "-1044.044 -1059.969 132.4067");
  assert.equal(store.entries[0].releasePos, capture.lineupPos);
  const metadata = JSON.parse(await readFile(join(dirname(service.liveFile), "savednades.metadata.json"), "utf8"));
  assert.deepEqual(metadata[0].throwSteps, run.expected.steps);
  const live = JSON.parse(await readFile(service.liveFile, "utf8"));
  assert.equal(live[owner][capture.name].LineupPos, "-1044.044 -1059.969 132.4067", "MatchZy loads the lineup spot as well");
});

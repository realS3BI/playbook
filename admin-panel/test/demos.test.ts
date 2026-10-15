import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { WebSocket } from "ws";
import { workspaceFixture, ids } from "./workspace-fixture.js";
import { demoRounds, roundEconomy, roundLoadouts } from "../src/demo-parser.js";
import { processDemoJob, removeAnalyzedOriginals } from "../src/demo-worker.js";
import {
  classifyBuy,
  loadoutSummary,
  playbackTime,
  roundClock,
  type SceneReference,
} from "../shared/demos.js";
import { areaEffects, frameAt, grenadeAt, lerpAngle } from "../shared/demo-replay.js";
import { newStratContent } from "../shared/strats.js";

const mongo = { skip: !process.env.TEST_MONGODB_URI };
test("folder import lookup finds content only within an authorized personal or team scope", mongo, async t => {
  const f = await workspaceFixture();
  t.after(() => f.close());
  const hash = "a".repeat(64);
  const personal = await f.request(0, "/analysis/demos", "POST", { title: "Ordnerdemo", source: "faceit", filename: "first.dem" });
  await f.store.analysis.demos.updateOne({ _id: personal.demo.id }, { $set: { hash, status: "queued" } });
  const own = await f.request(0, "/analysis/demos/lookup", "POST", { hash });
  assert.deepEqual(own.demo, { id: personal.demo.id, status: "queued" });
  assert.equal((await f.request(1, "/analysis/demos/lookup", "POST", { hash })).demo, null);
  assert.equal((await f.request(0, "/analysis/demos/lookup", "POST", { hash: "invalid" })).status, 400);
  const team = (await f.request(0, "/teams", "POST", { name: "Import-Team" })).team;
  assert.equal((await f.request(0, "/analysis/demos/lookup", "POST", { hash, teamId: team.id })).demo, null);
  assert.equal((await f.request(1, "/analysis/demos/lookup", "POST", { hash, teamId: team.id })).status, 404);
  const shared = await f.request(0, "/analysis/demos", "POST", { title: "Teamdemo", source: "faceit", filename: "team.dem", teamId: team.id });
  await f.store.analysis.demos.updateOne({ _id: shared.demo.id }, { $set: { hash, status: "ready" } });
  assert.equal((await f.request(0, "/analysis/demos/lookup", "POST", { hash, teamId: team.id })).demo.id, shared.demo.id);
});
async function fixture(t) {
  const f = await workspaceFixture();
  t.after(() => f.close());
  let team = (await f.request(0, "/teams", "POST", { name: "Demo-Team" })).team;
  for (const user of [1, 2]) {
    const invite = await f.request(0, `/teams/${team.id}/invitations`, "POST", {
      revision: team.revision,
    });
    team = (
      await f.request(
        user,
        `/team-invitations/${invite.url.split("/").at(-1)}`,
        "POST",
        { accept: true },
      )
    ).team;
  }
  team = (
    await f.request(0, `/teams/${team.id}`, "PATCH", {
      revision: team.revision,
      action: "role",
      userId: ids[1],
      role: "captain",
    })
  ).team;
  assert.ok(team);
  return { ...f, team };
}
async function readyDemo(f, teamId: string | null, owner = 0) {
  const demo = (
    await f.request(owner, "/analysis/demos", "POST", {
      title: "Mirage Review",
      filename: "match.dem",
      source: "faceit",
      teamId,
    })
  ).demo;
  assert.ok(demo);
  const round = {
    id: "r1",
    number: 1,
    startTick: 64,
    endTick: 6464,
    duration: 100,
    winner: 2,
  };
  const summary = {
    version: 1,
    parserVersion: "test",
    map: "de_mirage",
    tickRate: 64,
    players: [{ id: ids[0], name: "Entry" }],
    rounds: [round],
    warnings: [],
  };
  await f.store.analysis.demos.updateOne(
    { _id: demo.id },
    { $set: { status: "ready", summary } },
  );
  const path = f.store.analysis.path(demo.id, "r1.json");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({ round, frames: [], events: [], grenades: [] }),
  );
  const scene: SceneReference = {
    demoId: demo.id,
    roundId: "r1",
    version: 1,
    start: 10,
    end: 40,
    focusId: "",
  };
  return { demo, scene };
}
async function socket(f, index: number, path: string) {
  const ws = new WebSocket(f.base.replace("http:", "ws:") + "/api/live", {
    headers: {
      Origin: f.config.publicUrl,
      Cookie: `cs2_panel_session=${String(index + 1).repeat(43)}`,
    },
  });
  const messages: any[] = [];
  const listeners = new Set<() => void>();
  ws.on("message", (raw) => {
    messages.push(JSON.parse(raw.toString()));
    for (const listener of listeners) listener();
  });
  const wait = (predicate): Promise<any> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        listeners.delete(check);
        reject(new Error("Live message missing"));
      }, 5000);
      function check() {
        const index = messages.findIndex(predicate);
        if (index < 0) return;
        clearTimeout(timer);
        listeners.delete(check);
        resolve(messages.splice(index, 1)[0]);
      }
      listeners.add(check);
      check();
    });
  await once(ws, "open");
  ws.send(JSON.stringify({ type: "subscribe", paths: [path] }));
  const command = (body, requestId = randomUUID()) => {
    ws.send(JSON.stringify({ type: "command", requestId, path, body }));
    return wait(
      (message) => message.type === "result" && message.requestId === requestId,
    );
  };
  return { ws, wait, command, messages };
}

test("round intervals handle warmup transitions, counter rollover, overtime and incomplete endings", () => {
  const events: any[] = [
    { event_name: "round_start", tick: 1, is_warmup_period: true },
  ];
  for (let round = 0; round < 26; round++) {
    const tick = round * 6400 + 100;
    if (round)
      events.push({ event_name: "round_start", tick, is_warmup_period: false });
    events.push({
      event_name: "round_freeze_end",
      tick: tick + 64,
      is_warmup_period: false,
    });
    events.push({
      event_name: "round_end",
      tick: tick + 3200,
      is_warmup_period: false,
      total_rounds_played: round,
      winner: (round % 2) + 2,
    });
  }
  events.push(
    { event_name: "round_start", tick: 180000 },
    { event_name: "round_freeze_end", tick: 180064, is_warmup_period: false },
  );
  const result = demoRounds(events);
  assert.equal(result.rounds.length, 26);
  assert.equal(result.rounds[0].startTick, 164);
  // Times stay relative to freeze end: the buy phase reaches back to round start, the after-round pause is capped.
  assert.equal(result.rounds[0].buyStart, -163 / 64);
  assert.equal(result.rounds[0].afterEnd, 3136 / 64 + 10);
  assert.equal(result.rounds[1].buyStart, -1);
  assert.equal(result.rounds[25].afterEnd, 3136 / 64 + 10);
  assert.equal(result.rounds[25].number, 26);
  assert.equal(result.warnings.length, 1);
  const scene = {
    demoId: "id",
    roundId: "r1",
    version: 1,
    start: 10,
    end: 20,
    focusId: "",
  };
  const state = {
    sceneIndex: 0,
    time: 12,
    playing: true,
    speed: 2,
    anchoredAt: 1000,
    focusId: "",
  };
  assert.equal(playbackTime(state, scene, 2500), 15);
  assert.equal(playbackTime(state, scene, 30000), 20);
  assert.equal(playbackTime({ ...state, playing: false }, scene, 30000), 12);
});

test(
  "private/team scopes, validated scene references and immutable published examples",
  mongo,
  async (t) => {
    const f = await fixture(t);
    const { demo, scene } = await readyDemo(f, null, 1);
    // Platform administration does not expose somebody else's private match.
    assert.equal(
      (await f.request(0, `/analysis/demos/${demo.id}`)).status,
      404,
    );
    assert.equal(
      (await f.request(3, `/analysis/demos/${demo.id}/rounds/r1`)).status,
      404,
    );
    const create = {
      teamId: f.team.id,
      scene,
      title: "A-Execute",
      note: "Gemeinsam traden",
    };
    assert.equal(
      (await f.request(1, "/analysis/strats", "POST", create)).status,
      400,
    );
    assert.equal(
      (
        await f.request(1, `/analysis/demos/${demo.id}/share`, "POST", {
          teamId: f.team.id,
        })
      ).status,
      200,
    );
    assert.equal(
      (await f.request(2, `/analysis/demos/${demo.id}/rounds/r1`)).status,
      200,
    );
    assert.equal(
      (await f.request(3, `/analysis/demos/${demo.id}`)).status,
      404,
    );
    assert.equal(
      (await f.request(2, "/analysis/strats", "POST", create)).status,
      404,
    );
    for (const patch of [
      { version: 9 },
      { end: 101 },
      { focusId: ids[3] },
      { start: -1 },
      { start: -31 },
    ])
      assert.equal(
        (
          await f.request(1, "/analysis/strats", "POST", {
            ...create,
            scene: { ...scene, ...patch },
          })
        ).status,
        400,
      );
    const created = await f.request(1, "/analysis/strats", "POST", create);
    assert.equal(created.status, 201);
    const content = { ...created.strat.draft, slots: newStratContent().slots };
    content.slots[0].userId = ids[2];
    content.slots[0].steps = [
      {
        id: "step",
        text: "Entry traden",
        timing: "Auf Call",
        position: "A",
        nadeIds: [],
        scene: { ...scene, focusId: ids[0] },
      },
    ];
    let result = await f.request(1, `/strats/${created.strat.id}`, "PUT", {
      revision: 1,
      content,
    });
    assert.equal(result.status, 200);
    result = await f.request(1, `/strats/${created.strat.id}/publish`, "POST", {
      revision: result.strat.revision,
    });
    assert.equal(result.status, 200);
    const published = result.strat;
    assert.deepEqual(
      (await f.request(2, `/strats/${published.id}`)).strat.content.slots[0]
        .steps[0].scene,
      { ...scene, focusId: ids[0] },
    );
    const invalidMap = await f.request(1, `/strats/${published.id}`, "PUT", {
      revision: published.revision,
      content: { ...content, map: "de_nuke" },
    });
    assert.equal(invalidMap.status, 400);
    assert.equal(
      (await f.request(1, `/analysis/demos/${demo.id}`, "DELETE", {})).status,
      409,
    );
    const removed = await f.request(0, `/teams/${f.team.id}`, "PATCH", {
      revision: f.team.revision,
      action: "remove",
      userId: ids[1],
    });
    assert.equal(removed.status, 200);
    assert.equal(
      (await f.request(1, `/analysis/demos/${demo.id}`)).status,
      404,
    );
    const parallel = await readyDemo(f, f.team.id);
    const [attached, deleted] = await Promise.all([
      f.request(0, "/analysis/strats", "POST", { teamId: f.team.id, scene: parallel.scene, title: "Parallel reference", note: "" }),
      f.request(0, `/analysis/demos/${parallel.demo.id}`, "DELETE", {}),
    ]);
    if (attached.status === 201) {
      assert.equal(deleted.status, 409);
      assert.equal((await f.request(0, `/analysis/demos/${parallel.demo.id}`)).status, 200);
    } else {
      assert.equal(deleted.status, 200);
      assert.equal(attached.status, 404);
    }
  },
);

test(
  "two authenticated clients synchronize reviews, enforce control, replay commands and reconnect",
  mongo,
  async (t) => {
    const f = await fixture(t);
    const { scene } = await readyDemo(f, f.team.id);
    let review = (
      await f.request(0, "/analysis/reviews", "POST", {
        teamId: f.team.id,
        title: "Trades",
      })
    ).review;
    review = (
      await f.request(0, `/analysis/reviews/${review.id}`, "PATCH", {
        revision: review.revision,
        action: "scene",
        scene: { ...scene, title: "A-Entry", note: "Abstand prüfen" },
      })
    ).review;
    const path = `/api/analysis/reviews/${review.id}/room`;
    const captain = await socket(f, 1, path);
    const member = await socket(f, 2, path);
    await captain.wait((m) => m.type === "snapshot");
    await member.wait((m) => m.type === "snapshot");
    assert.equal(
      (await member.command({ action: "start", revision: review.revision }))
        .status,
      403,
    );
    const requestId = randomUUID();
    const start = { action: "start", revision: review.revision };
    const started = await captain.command(start, requestId);
    assert.ok(!started.error);
    assert.deepEqual(await captain.command(start, requestId), started);
    let room = (
      await member.wait((m) => m.type === "snapshot" && m.data.review.session)
    ).data;
    assert.equal(room.review.session.moderatorId, ids[1]);
    assert.ok(!JSON.stringify(room).includes("claim"));
    assert.ok(
      !(
        await member.command({
          action: "presence",
          readyKey: `${room.review.session.id}:0`,
          following: true,
        })
      ).error,
    );
    assert.equal(
      (
        await captain.wait(
          (m) =>
            m.type === "snapshot" &&
            m.data.participants.some((p) => p.id === ids[2] && p.ready),
        )
      ).data.participants[0].ready,
      true,
    );
    const playing = await captain.command({
      action: "playback",
      revision: room.review.revision,
      time: 15,
      playing: true,
      speed: 2,
      focusId: ids[0],
    });
    assert.ok(!playing.error, JSON.stringify(playing));
    room = (
      await member.wait(
        (m) => m.type === "snapshot" && m.data.review.session?.playback.playing,
      )
    ).data;
    assert.equal(room.review.session.playback.time, 15);
    assert.equal(room.review.session.playback.speed, 2);
    assert.equal(
      (await captain.command({ action: "stop", revision: 1 })).status,
      409,
    );
    assert.equal(
      (
        await captain.command({
          action: "playback",
          revision: room.review.revision,
          time: 1000,
          speed: 1,
          playing: true,
          focusId: "",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request(0, `/analysis/reviews/${review.id}`, "PATCH", {
          revision: room.review.revision,
          action: "scene",
          scene: { ...scene, title: "Nächste Sitzung", note: "Neu" },
        })
      ).status,
      200,
    );
    const current = await f.request(0, `/analysis/reviews/${review.id}/room`);
    assert.equal(current.review.scenes.length, 2);
    assert.equal(current.review.session.scenes.length, 1);
    member.ws.close();
    await once(member.ws, "close");
    const reconnected = await socket(f, 2, path);
    const caughtUp = (await reconnected.wait((m) => m.type === "snapshot"))
      .data;
    assert.equal(caughtUp.review.session.playback.time, 15);
    assert.equal(
      (
        await f.request(2, `/analysis/reviews/${review.id}/notes`, "POST", {
          sceneId: review.scenes[0].id,
          text: "Enger nachrücken",
        })
      ).status,
      200,
    );
    const removed = await f.request(0, `/teams/${f.team.id}`, "PATCH", {
      revision: f.team.revision,
      action: "remove",
      userId: ids[2],
    });
    assert.equal(removed.status, 200);
    assert.equal(
      (await reconnected.wait((m) => m.type === "error")).status,
      404,
    );
    assert.equal(
      (
        await reconnected.command({
          action: "presence",
          readyKey: "",
          following: true,
        })
      ).status,
      404,
    );
  },
);

test(
  "uploads stream, deduplicate per scope and report parser failures",
  mongo,
  async (t) => {
    const f = await fixture(t);
    const body = {
      title: "Broken",
      source: "premier",
      filename: "match.dem",
      teamId: null,
    };
    const data = Buffer.from(
      "This is not a real CS2 demo, but a test fixture.",
    );
    async function upload() {
      const demo = (await f.request(1, "/analysis/demos", "POST", body)).demo;
      const response = await fetch(
        `${f.base}/api/analysis/demos/${demo.id}/file`,
        {
          method: "PUT",
          headers: {
            Cookie: `cs2_panel_session=${"2".repeat(43)}`,
            "Content-Type": "application/octet-stream",
          },
          body: data,
        },
      );
      assert.equal(response.status, 200);
      return (await response.json()) as any;
    }
    const first = await upload();
    const duplicate = await upload();
    assert.equal(duplicate.demo.id, first.demo.id);
    assert.equal(duplicate.duplicate, true);
    assert.equal(
      await processDemoJob(f.store.db, f.store.analysis.directory),
      true,
    );
    const failed = await f.request(1, `/analysis/demos/${first.demo.id}`);
    assert.equal(failed.demo.status, "failed");
    assert.match(failed.demo.error, /CS2-Demo/);
    assert.deepEqual(await readFile(f.store.analysis.path(first.demo.id, "source")), data);
    assert.equal(
      (await f.request(3, `/analysis/demos/${first.demo.id}`)).status,
      404,
    );
    assert.equal(
      (await f.request(1, `/analysis/demos/${first.demo.id}`, "DELETE", {}))
        .status,
      200,
    );
  },
);

test(
  "real CS2 file completes streamed upload, isolated parsing and round retrieval",
  {
    skip: !process.env.TEST_MONGODB_URI || !process.env.TEST_DEMO_FILE,
    timeout: 300000,
  },
  async (t) => {
    const f = await fixture(t);
    const filename = process.env.TEST_DEMO_FILE!;
    const demo = (
      await f.request(1, "/analysis/demos", "POST", {
        title: "Valve integration",
        source: "premier",
        filename: filename.split("/").at(-1),
        teamId: f.team.id,
      })
    ).demo;
    const response = await fetch(
      `${f.base}/api/analysis/demos/${demo.id}/file`,
      {
        method: "PUT",
        headers: {
          Cookie: `cs2_panel_session=${"2".repeat(43)}`,
          "Content-Type": "application/octet-stream",
        },
        body: createReadStream(filename) as any,
        duplex: "half",
      } as any,
    );
    assert.equal(response.status, 200);
    await processDemoJob(f.store.db, f.store.analysis.directory);
    const result = await f.request(2, `/analysis/demos/${demo.id}`);
    assert.equal(result.demo.status, "ready", result.demo.error);
    assert.ok(result.demo.summary.rounds.length > 0);
    assert.ok(result.demo.summary.players.length >= 2);
    const replay = await f.request(2, `/analysis/demos/${demo.id}/rounds/r1`);
    assert.equal(replay.status, 200);
    assert.ok(replay.frames.length);
    assert.ok(replay.events.length);
    assert.ok(
      replay.frames.every(
        (frame) =>
          frame.time >= replay.round.buyStart &&
          frame.time <= replay.round.afterEnd,
      ),
    );
    assert.ok(replay.round.buyStart < 0);
    assert.ok(replay.round.afterEnd > replay.round.duration);
    assert.ok(replay.loadouts.length);
    assert.ok(result.demo.summary.rounds.every((round) => round.economy?.t && round.economy?.ct));
    assert.ok(replay.grenades.length);
    assert.equal(result.demo.originalRetained, false);
    await assert.rejects(stat(f.store.analysis.path(demo.id, "source")), { code: "ENOENT" });
    assert.equal((await f.store.storage.usage(`team:${f.team.id}`)).originals, 0);
  },
);

test("original cleanup preserves replay and grenades, resumes after deletion and leaves incomplete analyses intact", mongo, async (t) => {
  const f = await fixture(t);
  for (const mode of ["complete", "missing-round", "incomplete-round", "already-deleted", "legacy"] as const) {
    const { demo } = await readyDemo(f, f.team.id);
    const path = f.store.analysis.path(demo.id, "source");
    const replayPath = f.store.analysis.path(demo.id, "r1.json");
    const replay = JSON.parse(await readFile(replayPath, "utf8"));
    const asset = await f.store.analysis.demos.findOne({ _id: demo.id });
    await writeFile(f.store.analysis.path(demo.id, "summary.json"), JSON.stringify(asset.summary));
    replay.frames = [{ time: 0, players: [] }];
    replay.events = [{ time: 1, kind: "smokegrenade_detonate" }];
    replay.grenades = [{ id: "smoke", kind: "smoke", points: [{ time: 0, x: 1, y: 2, z: 3 }] }];
    if (mode === "incomplete-round") delete replay.grenades;
    await writeFile(replayPath, JSON.stringify(replay));
    if (mode === "missing-round") await rm(replayPath);
    if (mode !== "already-deleted") await writeFile(path, "original demo");
    await f.store.analysis.demos.updateOne({ _id: demo.id }, {
      $set: { originalCleanupPending: mode !== "legacy", originalRetained: true, bytes: 13, derivedBytes: 42,
        autoImport: true, pinned: false, analysisExpiresAt: new Date(0).toISOString() },
    });
    await removeAnalyzedOriginals(f.store.db, f.store.analysis.directory);
    const stored = await f.store.analysis.demos.findOne({ _id: demo.id });
    assert.equal(stored.status, "ready");
    if (mode === "missing-round" || mode === "incomplete-round" || mode === "legacy") {
      assert.equal(await readFile(path, "utf8"), "original demo");
      assert.equal(stored.originalRetained, true);
      continue;
    }
    assert.equal(stored.originalRetained, false);
    assert.equal(stored.originalCleanupPending, undefined);
    await assert.rejects(stat(path), { code: "ENOENT" });
    const fetched = await f.request(2, `/analysis/demos/${demo.id}/rounds/r1`);
    assert.equal(fetched.status, 200);
    assert.deepEqual(fetched.grenades, replay.grenades);
    assert.deepEqual(fetched.events, replay.events);
    await f.store.imports.cleanup();
    assert.ok(await f.store.analysis.demos.findOne({ _id: demo.id }));
    await removeAnalyzedOriginals(f.store.db, f.store.analysis.directory);
    assert.deepEqual(JSON.parse(await readFile(replayPath, "utf8")), replay);
  }
});

test("buy types follow start money and equipment value", () => {
  const team = (equipment: number, startMoney = 4000) =>
    Array.from({ length: 5 }, () => ({ equipment, startMoney }));
  assert.equal(classifyBuy(team(900, 800)), "pistol");
  assert.equal(classifyBuy(team(4500)), "fullbuy");
  assert.equal(classifyBuy([...team(4800).slice(0, 4), { equipment: 700, startMoney: 1500 }]), "fullbuy");
  assert.equal(classifyBuy(team(2400)), "semi-buy");
  assert.equal(classifyBuy(team(650, 1900)), "eco");
  // Overtime money is never mistaken for a pistol round.
  assert.equal(classifyBuy(team(800, 12500)), "eco");
  assert.equal(classifyBuy([]), undefined);
});

test("round clock covers buy phase, round timer, bomb timer and after-round pause", () => {
  const round = { id: "r1", number: 1, startTick: 0, endTick: 0, duration: 100, winner: 2, buyStart: -20, afterEnd: 107 };
  assert.deepEqual(roundClock(round, -12), { phase: "buy", remaining: 12 });
  assert.deepEqual(roundClock(round, 15), { phase: "live", remaining: 100 });
  assert.deepEqual(roundClock({ ...round, roundTime: 135 }, 15), { phase: "live", remaining: 120 });
  assert.deepEqual(roundClock(round, 70, 60), { phase: "planted", remaining: 30 });
  assert.deepEqual(roundClock(round, 103, 60), { phase: "over", remaining: 4 });
});

test("loadouts list the active kit, grenades and bomb and only store changes", () => {
  assert.deepEqual(
    loadoutSummary(["Butterfly Knife", "Glock-18", "AK-47", "Smoke Grenade", "Flashbang", "Molotov", "C4 Explosive"]),
    { primary: "AK-47", secondary: "Glock-18", zeus: false, grenades: ["Smoke", "Flash", "Molly"], bomb: true },
  );
  assert.deepEqual(loadoutSummary(["Knife", "USP-S", "Incendiary Grenade", "High Explosive Grenade", "Decoy Grenade"]).grenades, ["Molly", "HE", "Decoy"]);
  const state = (items: string[], money: number, equipment = 200, spent = 0) => ({
    items, money, spent, equipment, armor: 0, helmet: false, defuser: false,
  });
  const states: [number, Map<string, any>][] = [
    [0, new Map([["a", state(["Glock-18"], 4000)], ["b", state(["USP-S"], 800)]])],
    [64, new Map([["a", state(["Glock-18"], 4000)], ["b", state(["USP-S"], 800)]])],
    [128, new Map([["a", state(["Glock-18", "AK-47"], 1300, 2900, 2700)], ["b", state(["USP-S"], 800)]])],
    [192, new Map([["a", state(["Glock-18", "AK-47"], 1300, 2900, 2700)], ["b", state(["USP-S"], 800)]])],
  ];
  const loadouts = roundLoadouts(states, 128);
  assert.deepEqual(loadouts.map((entry) => [entry.id, entry.time]), [["a", -2], ["b", -2], ["a", 0]]);
  const frames = [{ time: 0, players: [{ id: "a", side: 2 }, { id: "b", side: 3 }] as any[] }];
  const economy = roundEconomy(states, frames, 128, 192);
  assert.deepEqual(economy.t, { buy: "semi-buy", equipment: 2900, money: 1300, players: 1 });
  assert.deepEqual(economy.ct, { buy: "pistol", equipment: 200, money: 800, players: 1 });
});

test("3D replay turns the short way, interpolates view and crouch and keeps jumps", () => {
  assert.equal(lerpAngle(170, -170, 0.5), 180);
  assert.equal(lerpAngle(-170, 170, 0.25), -175);
  const player = { id: "a", x: 0, y: 0, z: 0, yaw: 170, pitch: -10, health: 100, side: 2, weapon: "AK-47" };
  const replay: any = {
    round: { id: "r1", number: 1, startTick: 0, endTick: 0, duration: 10, winner: 2 },
    frames: [
      { time: 0, players: [player, { ...player, id: "b", x: 500 }] },
      { time: 0.125, players: [{ ...player, x: 20, yaw: -170, pitch: 10, duck: 1 }, { ...player, id: "b", x: 0 }] },
    ],
    events: [],
    grenades: [],
  };
  const [a, b] = frameAt(replay, 0.0625);
  assert.equal(a.x, 10);
  assert.equal(a.yaw, 180);
  assert.equal(a.pitch, 0);
  assert.equal(a.duck, 0.5);
  // A respawn or teleport is not a run across the map.
  assert.equal(b.x, 500);
  // Older analyses have no pitch; the player keeps looking straight ahead.
  const old = frameAt({ ...replay, frames: replay.frames.map((frame) => ({ ...frame, players: frame.players.map(({ pitch: _pitch, duck: _duck, ...rest }) => rest) })) }, 0.0625);
  assert.equal(old[0].pitch, undefined);
  assert.equal(old[0].duck, undefined);
});

test("3D replay knows how long smokes and fires last and where grenades fly", () => {
  const replay: any = {
    round: { id: "r1", number: 1, startTick: 0, endTick: 0, duration: 60, winner: 2, afterEnd: 65 },
    frames: [],
    events: [
      { time: 5, tick: 320, kind: "smokegrenade_detonate", playerId: "a", player: "A", x: 1, y: 2, z: 3, entityId: 7 },
      { time: 23, tick: 1472, kind: "smokegrenade_expired", playerId: "a", player: "A", x: 1, y: 2, z: 3, entityId: 7 },
      { time: 58, tick: 3712, kind: "inferno_startburn", playerId: "a", player: "A", x: 4, y: 5, z: 6, entityId: 9 },
    ],
    grenades: [],
  };
  assert.deepEqual(areaEffects(replay).map(({ kind, start, end }) => [kind, start, end]), [["smoke", 5, 23], ["fire", 58, 65]]);
  const path = { id: "g", kind: "CSmokeGrenadeProjectile", playerId: "a", points: [{ time: 1, x: 0, y: 0, z: 0 }, { time: 2, x: 10, y: 20, z: 30 }] };
  assert.deepEqual(grenadeAt(path, 1.5), { x: 5, y: 10, z: 15, index: 0 });
  assert.equal(grenadeAt(path, 2.5), null);
});

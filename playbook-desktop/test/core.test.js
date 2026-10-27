import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { LineReader, readValue, NetConsole } from '../src/netconsole.js';
import { Presentation, NAMES, FRONT_CAMERA, profile, validSnapshot } from '../src/presentation.js';
import { captureFrame } from '../src/geometry.js';
import { trusted, loginNavigation } from '../src/security.js';
import { launchAndWait } from '../src/launch.js';

function printPacket(text) { return Buffer.from(text); }
test('text console handles split UTF-8, CRLF and coalesced lines', () => {
  const reader = new LineReader(); const messages = [];
  for (const byte of Buffer.from('[Console] grün\r\nzweite Zeile\n')) messages.push(...reader.push(Buffer.from([byte])));
  assert.deepEqual(messages, ['grün', 'zweite Zeile']);
  assert.throws(() => reader.push(Buffer.from([0])), /Ungültige/);
});
test('console values are numeric only and names must match exactly', () => {
  assert.equal(readValue('"cl_crosshair_gap" = "-2.5" (def. "0")\n', 'cl_crosshair_gap'), '-2.5');
  assert.equal(readValue('crosshair = true\n', 'crosshair'), 'true');
  assert.throws(() => readValue('other_crosshair = 1', 'crosshair'));
  assert.throws(() => readValue('crosshair = exec evil', 'crosshair'));
  assert.equal(validSnapshot({ version: 2, game: '1', values: Object.fromEntries(NAMES.map(name => [name, '1;quit'])) }), false);
});
test('console roundtrip rejects denied changes and serializes overlapping requests', async t => {
  const state = { crosshair: 'true', r_drawviewmodel: 'true' };
  const server = net.createServer(socket => {
    let pending = '';
    socket.on('data', bytes => {
      pending += bytes.toString();
      while (pending.includes('\n')) {
        const size = pending.indexOf('\n');
        const command = pending.slice(0, size); pending = pending.slice(size + 1);
        const [name, value] = command.split(' ');
        if (name === 'echo') socket.write(printPacket(value + '\n'));
        else if (value === undefined) socket.write(printPacket(`${name} = ${state[name]}\n`));
        else if (name !== 'r_drawviewmodel') state[name] = value;
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const console = new NetConsole({ port: server.address().port });
  t.after(() => { console.close(); server.close(); });
  assert.deepEqual(await Promise.all([console.read(['crosshair']), console.read(['r_drawviewmodel'])]), [{ crosshair: 'true' }, { r_drawviewmodel: 'true' }]);
  await console.write({ crosshair: 'false' });
  assert.equal(state.crosshair, 'false');
  await assert.rejects(console.write({ r_drawviewmodel: 'false' }), { code: 'ECVARMISMATCH' });
});

test('launch waits for a real console reply after the game starts listening', async t => {
  const server = net.createServer(socket => {
    let pending = '';
    socket.on('data', bytes => {
      pending += bytes.toString();
      while (pending.includes('\n')) {
        const size = pending.indexOf('\n');
        const command = pending.slice(0, size);
        pending = pending.slice(size + 1);
        socket.write(printPacket(command.startsWith('echo ') ? command.slice(5) + '\n' : 'crosshair = true\n'));
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const console = new NetConsole({ port });
  let timer;
  t.after(() => { clearTimeout(timer); console.close(); server.close(); });
  await assert.rejects(console.read(['crosshair']), /ECONNREFUSED/);
  await launchAndWait(async () => {
    timer = setTimeout(() => server.listen(port, '127.0.0.1'), 100);
  }, console, { timeoutMs: 2000, retryMs: 20 });
  // A retry after refusal must remain usable, including after the old socket closes.
  assert.deepEqual(await console.read(['crosshair']), { crosshair: 'true' });
});

test('launch refuses an already running game and never reports unconfirmed success', async () => {
  let closed = false;
  const console = { close: () => { closed = true; }, read: async () => { throw new Error('ECONNREFUSED'); } };
  await assert.rejects(launchAndWait(async () => { throw new Error('CS2 läuft bereits.'); }, console), /läuft bereits/);
  assert.equal(closed, false);
  await assert.rejects(launchAndWait(async () => {}, console, { timeoutMs: 10, retryMs: 1 }), /noch nicht bestätigt.*ECONNREFUSED/);
  assert.equal(closed, true);
});

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'playbook-review-'));
  const file = path.join(directory, 'recovery.json');
  const original = Object.fromEntries([...NAMES, ...Object.keys(FRONT_CAMERA)].map((name, index) => [name, String(index / 2)]));
  let state = { ...original }, writes = 0, fail = 0, cameraFailure = false;
  const cameraCommands = [];
  const console = {
    async read(names) { return Object.fromEntries(names.map(name => [name, state[name]])); },
    async execute(commands) { cameraCommands.push(...commands); return cameraFailure && commands.includes('thirdperson') ? 'Cheat command denied' : ''; },
    async write(values) {
      assert.ok(JSON.parse(await readFile(file, 'utf8')).values, 'journal exists before mutation');
      writes++; state = { ...state, ...values };
      if (fail-- > 0) throw new Error('Verbindung unterbrochen');
    },
  };
  const presentation = new Presentation(console, file, async () => ({ identity: 'game:1', client: { top: 132, bottom: 1212 } }));
  t.after(async () => { clearTimeout(presentation.timer); await rm(directory, { recursive: true, force: true }); });
  return { presentation, console, file, original, state: () => state, writes: () => writes, fail: n => { fail = n; }, cameraCommands, denyCamera: () => { cameraFailure = true; } };
}
test('all photo/video profiles restore exact originals, including unusual values', async t => {
  const f = await fixture(t);
  for (const slot of ['aim', 'position', 'front', 'effect', 'video']) {
    const token = await f.presentation.begin(slot);
    assert.deepEqual(f.state(), { ...f.original, ...profile(slot) });
    assert.equal(f.state().crosshair, ['front', 'effect'].includes(slot) ? 'false' : 'true');
    assert.equal(f.state().r_drawviewmodel, slot === 'video' ? 'true' : 'false');
    await f.presentation.end(token);
    assert.deepEqual(f.state(), f.original);
    assert.equal(await f.presentation.saved(), undefined);
  }
});
test('idle recovery cannot restore an active capture and stale tokens cannot end it', async t => {
  const f = await fixture(t);
  const starting = f.presentation.begin('aim');
  const idle = f.presentation.recoverIfIdle();
  const token = await starting; await idle;
  assert.deepEqual(f.state(), { ...f.original, ...profile('aim') });
  await assert.rejects(f.presentation.begin('front'), /läuft bereits/);
  await assert.rejects(f.presentation.end('stale'), /nicht mehr aktiv/);
  await f.presentation.end(token);
});
test('partial prepare failure restores settings; lost connection survives app restart', async t => {
  const f = await fixture(t);
  f.fail(1);
  await assert.rejects(f.presentation.begin('aim'), /unterbrochen/);
  assert.deepEqual(f.state(), f.original);
  assert.equal(await f.presentation.saved(), undefined);
  f.fail(2);
  await assert.rejects(f.presentation.begin('front'), /lokal gesichert/);
  assert.ok(await f.presentation.saved());
  const restarted = new Presentation(f.console, f.file, async () => ({ identity: 'game:2', client: { top: 0, bottom: 1440 } }));
  await restarted.recover();
  assert.deepEqual(f.state(), f.original);
  assert.equal(await restarted.saved(), undefined);
});
test('older 33-setting recovery journals remain restorable after adding scope settings', async t => {
  const f = await fixture(t);
  const legacy = Object.fromEntries(Object.entries(f.original).filter(([name]) => NAMES.includes(name) && !name.startsWith('cl_ironsight_')));
  const saved = { version: 1, game: 'game:old', values: legacy };
  assert.equal(Object.keys(legacy).length, 33);
  assert.equal(validSnapshot(saved), true);
  await writeFile(f.file, JSON.stringify(saved), 'utf8');
  await f.presentation.recover();
  assert.deepEqual(f.state(), f.original);
  assert.equal(await f.presentation.saved(), undefined);
});
test('physical pixel crop removes window borders and keeps the true aim point', () => {
  const game = { client: { left: 104, top: 132, right: 2016, bottom: 1176 }, window: { left: 100, top: 100, right: 2020, bottom: 1180 } };
  assert.deepEqual(captureFrame(game, 1920, 1080), { width: 1920, height: 1080, left: 4, top: 32, right: 4, bottom: 4 });
  assert.deepEqual(captureFrame(game, 1912, 1044), { width: 1912, height: 1044, left: 0, top: 0, right: 0, bottom: 0 });
  assert.throws(() => captureFrame(game, 1280, 720), /nicht eindeutig/);
  assert.throws(() => captureFrame({ ...game, minimized: true }, 1920, 1080), /minimiert/);
  assert.throws(() => captureFrame({ ...game, visible: { left: 101, top: 100, right: 2021, bottom: 1180 } }, 1920, 1080), /nicht eindeutig/);
});
test('failed restoration releases capture lock but retains journal for automatic retry', async t => {
  const f = await fixture(t);
  const token = await f.presentation.begin('aim');
  f.fail(1);
  await assert.rejects(f.presentation.end(token), /unterbrochen/);
  assert.equal(f.presentation.active, undefined);
  assert.ok(await f.presentation.saved());
  await f.presentation.recoverIfIdle();
  assert.equal(await f.presentation.saved(), undefined);
  assert.deepEqual(f.state(), f.original);
});
test('only the exact HTTPS Playbook origin gets native access; Steam can navigate for login', () => {
  assert.ok(trusted('https://playbook.example.com/maps/anubis'));
  for (const url of ['http://playbook.example.com', 'https://playbook.example.com.evil.test', 'https://user@playbook.example.com', 'file:///tmp/a', 'https://steamcommunity.com']) assert.equal(trusted(url), false);
  assert.ok(loginNavigation('https://steamcommunity.com/openid/login'));
  assert.equal(loginNavigation('https://steamcommunity.com.evil.test'), false);
});

test('front camera enters third person and restores first person and camera cvars', async t => {
  const f = await fixture(t);
  const token = await f.presentation.begin('front');
  assert.deepEqual(f.cameraCommands, ['thirdperson']);
  assert.equal(f.state().cam_idealyaw, '180');
  assert.equal(f.state().cam_idealpitch, '0');
  assert.equal(f.state().c_minyaw, '-180');
  assert.equal(f.state().c_maxyaw, '180');
  await f.presentation.end(token);
  assert.deepEqual(f.cameraCommands, ['thirdperson', 'firstperson']);
  assert.deepEqual(f.state(), f.original);
});

test('front photos accept the server compensation for upward and downward aim and restore pitch limits', async t => {
  const f = await fixture(t);
  for (const pitch of [44.8, -29.6, -89, 89]) {
    const token = await f.presentation.begin('front', pitch);
    assert.equal(Number(f.state().cam_idealpitch), pitch);
    assert.equal(f.state().c_minpitch, '-89');
    assert.equal(f.state().c_maxpitch, '89');
    await f.presentation.end(token);
    assert.deepEqual(f.state(), f.original);
  }
  for (const pitch of [NaN, Infinity, 90, '44.8'])
    await assert.rejects(f.presentation.begin('front', pitch), /Kamera-Pitch/);
});

test('denied third person releases capture and restores saved camera settings', async t => {
  const f = await fixture(t); f.denyCamera();
  await assert.rejects(f.presentation.begin('front'), /Third Person abgelehnt/);
  assert.deepEqual(f.cameraCommands, ['thirdperson', 'firstperson']);
  assert.deepEqual(f.state(), f.original);
  assert.equal(f.presentation.active, undefined);
  assert.equal(await f.presentation.saved(), undefined);
});

test('front journal restores camera mode after an app restart', async t => {
  const f = await fixture(t);
  await f.presentation.begin('front'); clearTimeout(f.presentation.timer);
  const restarted = new Presentation(f.console, f.file, () => {});
  await restarted.recover();
  assert.deepEqual(f.cameraCommands, ['thirdperson', 'firstperson']);
  assert.deepEqual(f.state(), f.original);
});

test('version 2 journals restore without changing the camera mode', async t => {
  const f = await fixture(t);
  const values = Object.fromEntries(NAMES.map(name => [name, f.original[name]]));
  await writeFile(f.file, JSON.stringify({ version: 2, game: 'old', values }), 'utf8');
  await f.presentation.recover();
  assert.deepEqual(f.cameraCommands, []);
  assert.deepEqual(f.state(), f.original);
});

test('version 3 front journals restore after adding pitch limits to the new profile', async t => {
  const f = await fixture(t);
  const values = Object.fromEntries(Object.entries(f.original).filter(([name]) => !['c_minpitch', 'c_maxpitch'].includes(name)));
  await writeFile(f.file, JSON.stringify({ version: 3, game: 'old', frontCamera: true, values }), 'utf8');
  await f.presentation.recover();
  assert.deepEqual(f.cameraCommands, ['firstperson']);
  assert.deepEqual(f.state(), f.original);
});

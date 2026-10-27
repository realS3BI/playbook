import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('native errors reach the review without Electron IPC internals', async () => {
  let bridge;
  const window = {}; window.top = window;
  const context = {
    window, location: { origin: 'https://playbook.example.com' },
    process: { argv: ['--playbook-origin=https://playbook.example.com'] },
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } },
      ipcRenderer: { invoke: async () => { throw new Error("Error invoking remote method 'review:connect': Error: CS2 ist nicht erreichbar."); } },
    }),
  };
  vm.runInNewContext(await readFile(new URL('../src/preload.cjs', import.meta.url), 'utf8'), context);
  await assert.rejects(bridge.connect(), { message: 'CS2 ist nicht erreichbar.' });
});

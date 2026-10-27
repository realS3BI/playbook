// Loaded only into the disposable app copy used by live-desktop.js.
const { app, BrowserWindow, session } = require('electron');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const run = promisify(execFile);
app.setPath('userData', path.join(__dirname, 'user-data'));
// Serve a local fixture at the trusted origin. This exercises the production
// bridge/capture checks without depending on Steam login or changing a review.
app.whenReady().then(() => session.defaultSession.protocol.handle('https', () => new Response('<!doctype html><title>Playbook CS2-Live-Test</title><p>Lokaler Aufnahmetest</p>')));
let testing = false;
app.on('browser-window-created', (_event, window) => window.webContents.on('did-finish-load', async () => {
  if (testing || new URL(window.webContents.getURL()).origin !== new URL(process.env.PLAYBOOK_DESKTOP_URL || 'https://playbook.example.com').origin) return;
  testing = true;
  let consoleConnection;
  const invoke = async source => {
    const result = await window.webContents.executeJavaScript(`(async () => { try { return { ok: true, value: await (${source}) }; } catch (error) { return { ok: false, error: error.message }; } })()`, true);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  };
  try {
    ({ consoleConnection } = await import(pathToFileURL(path.join(__dirname, 'src/main.js'))));
    await invoke('window.playbookDesktop.launch()');
    await consoleConnection.execute(['map de_mirage']);
    await new Promise(resolve => setTimeout(resolve, 15_000));
    await consoleConnection.execute(['sv_cheats 1', 'bot_kick']);
    await invoke('window.playbookDesktop.connect()');
    console.log('LIVE_DESKTOP connected');
    const capture = await invoke(`(async () => {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      window.liveTestStream = stream;
      const video = document.createElement('video'); video.muted = true; video.srcObject = stream;
      window.liveTestVideo = video;
      await video.play();
      const width = video.videoWidth, height = video.videoHeight;
      const frame = await window.playbookDesktop.frame(width, height);
      const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
      canvas.getContext('2d').drawImage(video, 0, 0, 64, 64);
      const pixels = canvas.getContext('2d').getImageData(0, 0, 64, 64).data;
      let min = 255, max = 0;
      for (let index = 0; index < pixels.length; index += 4) { min = Math.min(min, pixels[index]); max = Math.max(max, pixels[index]); }
      return { width, height, frame, pixelRange: max - min };
    })()`);
    assert.ok(capture.width > 100 && capture.height > 100 && capture.pixelRange > 8, 'Capture must contain a visible game image');
    console.log('LIVE_DESKTOP capture ' + JSON.stringify(capture));
    for (const slot of ['aim', 'position', 'front', 'effect']) {
      await invoke(`(async () => { const token = await window.playbookDesktop.begin('${slot}'); await window.playbookDesktop.end(token); })()`);
    }
    await invoke(`(async () => {
      window.liveTestToken = await window.playbookDesktop.begin('video');
      window.liveTestStopped = new Promise(resolve => {
        const chunks = [];
        const recorder = new MediaRecorder(window.liveTestStream);
        window.liveTestRecorder = recorder;
        recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        recorder.onstop = () => resolve({ bytes: new Blob(chunks).size, f8: window.liveTestF8 === true });
        window.liveTestUnsubscribe = window.playbookDesktop.onStopVideo(() => { window.liveTestF8 = true; recorder.stop(); });
        recorder.start();
      });
    })()`);
    await new Promise(resolve => setTimeout(resolve, 2000));
    const keyScript = `Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class PlaybookTestKey { [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, System.UIntPtr extra); }'; [PlaybookTestKey]::keybd_event(0x77, 0, 0, [UIntPtr]::Zero); [PlaybookTestKey]::keybd_event(0x77, 0, 2, [UIntPtr]::Zero)`;
    await run(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(keyScript, 'utf16le').toString('base64')], { windowsHide: true, timeout: 5000 });
    const video = await invoke('Promise.race([window.liveTestStopped, new Promise((_, reject) => setTimeout(() => reject(new Error("F8 wurde nicht ausgelöst")), 5000))])');
    assert.ok(video.bytes > 1000 && video.f8, 'Actual game video must stop through F8');
    await invoke('window.playbookDesktop.end(window.liveTestToken)');
    await invoke('(async () => { window.liveTestUnsubscribe(); window.liveTestStream.getTracks().forEach(track => track.stop()); await window.playbookDesktop.disconnect(); })()');
    assert.equal((await invoke('window.playbookDesktop.status()')).recovery, false);
    console.log('LIVE_DESKTOP video ' + JSON.stringify(video));
    console.log('LIVE_DESKTOP_RESULT passed');
  } catch (error) {
    console.error('LIVE_DESKTOP_RESULT failed: ' + error.message);
    process.exitCode = 1;
  } finally {
    let recovered = false;
    try { await invoke('window.playbookDesktop.recover()'); recovered = true; }
    catch (error) { console.error('LIVE_DESKTOP_RECOVERY ' + error.message); }
    if (recovered) await consoleConnection?.execute(['quit']).catch(() => {});
    window.close();
  }
}));

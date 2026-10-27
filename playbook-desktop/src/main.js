import { app, BrowserWindow, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, Menu, powerSaveBlocker, session, shell } from 'electron';
import updater from 'electron-updater';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CommandPipe } from './command-pipe.js';
import { Presentation } from './presentation.js';
import { captureFrame } from './geometry.js';
import { ORIGIN, trusted, loginNavigation, reviewPermission } from './security.js';
import { startupLog } from './startup-log.js';
import { Updates } from './updates.js';
import { launchAndWait } from './launch.js';
import { collectCS2Diagnostics, diagnosticReport } from './cs2-diagnostics.js';
import { LiveRecorder, audioOptions } from './live-recorder.js';
import { DemoFolder } from './demo-folder.js';

const { autoUpdater } = updater;
const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
let window, presentation, target, blocker, quitting = false, launching = false;
const updates = new Updates(autoUpdater, () => app.isPackaged);
const startup = startupLog(app);
const connectionLog = (name, details, level) => startup.event('CS2', name, details, level);
const consoleConnection = new CommandPipe({ log: connectionLog, inspect: async id => {
  const diagnosis = await collectCS2Diagnostics();
  if (!diagnosis.info?.insecure || diagnosis.info.playbookPipeId !== id) throw Object.assign(new Error('Das laufende CS2 gehört nicht zu dieser Playbook-Command-Pipe. Bitte CS2 vollständig beenden und über Playbook erneut starten.'), { code: 'EPIPEIDENTITY' });
  if (!diagnosis.info.listenersReadable) throw Object.assign(new Error('Windows kann den CS2-Antwortkanal momentan nicht zuordnen. Bitte die CS2-Verbindung erneut prüfen.'), { code: 'EPORTCHECK' });
  if (!diagnosis.info.listeners.some(listener => listener.port === 29000 && listener.cs2 && ['127.0.0.1', '0.0.0.0', '::'].includes(listener.address))) throw Object.assign(new Error('CS2 öffnet noch keinen lokalen Antwortkanal auf Port 29000. Bitte auf das Hauptmenü warten und erneut verbinden.'), { code: 'EVCONWAIT' });
} });
let lastDiagnosis = '', diagnosing = false, recoveryError;
let liveRecorder, demoFolder;

function startupFailed(error) {
  const message = error instanceof Error ? error.message : String(error);
  startup.write(`Start fehlgeschlagen: ${message}`);
  dialog.showErrorBox('Playbook konnte nicht gestartet werden', `${message}\n\nStartprotokoll: ${startup.file}`);
  app.exit(1);
}

async function native(action, args = []) {
  if (process.platform !== 'win32') throw new Error('Die CS2-Aufnahme benötigt Windows 10 oder 11.');
  const executable = app.isPackaged ? path.join(process.resourcesPath, 'Playbook.Windows.exe') : path.join(here, '../native/bin/publish/Playbook.Windows.exe');
  try {
    const { stdout } = await exec(executable, action ? [action, ...args] : [], { windowsHide: true, timeout: 5000, maxBuffer: 16_384 });
    return JSON.parse(stdout);
  } catch (error) {
    const failure = Object.assign(new Error(error.stderr?.trim() || (action === 'launch' ? 'Steam konnte CS2 nicht starten.' : 'CS2-Fenster nicht gefunden. Bitte CS2 starten und geöffnet lassen.')), { code: error.killed ? 'ENATIVETIMEOUT' : 'ENATIVE', cause: error });
    startup.event('Windows', 'helper.failed', { action: action || 'window', code: failure.code, error: failure.message }, 'ERROR');
    throw failure;
  }
}
const game = () => native();
async function saveDiagnosis(error, operation, protocolConfirmed = false) {
  const diagnosis = await collectCS2Diagnostics();
  const transport = consoleConnection.state();
  startup.event('Diagnose', operation, { code: error?.code, error: error?.message, protocolConfirmed, transport, summary: diagnosis.summary, ...diagnosis.info }, error ? 'ERROR' : 'INFO');
  lastDiagnosis = diagnosticReport(diagnosis, { appVersion: app.getVersion(), operation, error, protocolConfirmed, transport });
  return diagnosis;
}
async function connectionError(error, operation) {
  if (process.platform !== 'win32') return error;
  const diagnosis = await saveDiagnosis(error, operation);
  return Object.assign(new Error(`${error.message}\n\nStartprüfung: ${diagnosis.summary}\n\nDen vollständigen Bericht findest du unter Playbook → CS2-Diagnose kopieren. Protokoll: ${startup.file}`), { code: error.code, cause: error });
}
async function showDiagnosis() {
  if (diagnosing) return;
  diagnosing = true;
  try {
    let error, confirmed = false;
    if (launching || presentation.active) error = new Error('Die aktive Aufnahme oder der Spielstart läuft. Die zusätzliche Protokollprüfung wurde übersprungen.');
    else {
      try { await consoleConnection.read(['crosshair']); confirmed = true; }
      catch (failure) { error = failure; }
    }
    await saveDiagnosis(error, 'manual', confirmed);
    const choice = await dialog.showMessageBox(window, { type: confirmed ? 'info' : 'warning', title: 'CS2-Verbindungsdiagnose', message: confirmed ? 'CS2 bestätigt die lokale Steuerung.' : 'CS2-Verbindung nicht bestätigt.', detail: lastDiagnosis, buttons: ['Diagnose kopieren', 'Schließen'], defaultId: 0, cancelId: 1 });
    if (choice.response === 0) clipboard.writeText(lastDiagnosis);
  } catch (error) { startup.event('Diagnose', 'manual.failed', { error: error.message }, 'ERROR'); }
  finally { diagnosing = false; }
}
async function launchGame() {
  if (launching) throw new Error('CS2 wird bereits gestartet. Bitte auf die Verbindung warten.');
  launching = true;
  try {
    if (target || presentation.active) throw new Error('Bitte zuerst den Review beenden und das Spielbild trennen.');
    await launchAndWait(async () => native('launch', [await consoleConnection.prepare()]), consoleConnection, { log: connectionLog });
    await presentation.recover();
    await saveDiagnosis(undefined, 'launch', true);
  } catch (error) { throw await connectionError(error, 'launch'); }
  finally { launching = false; }
}
async function capturedGame() {
  const next = await game();
  if (!target || next.identity !== target.identity || next.id !== target.id) throw new Error('Das CS2-Fenster hat sich geändert. Bitte das Spielbild erneut verbinden.');
  return next;
}
function releaseCapture() {
  target = undefined;
  globalShortcut.unregister('F8');
  if (blocker !== undefined && powerSaveBlocker.isStarted(blocker)) powerSaveBlocker.stop(blocker);
  blocker = undefined;
}
async function disconnect() {
  releaseCapture();
  await presentation.recover();
}
function handle(name, work) {
  ipcMain.handle('review:' + name, async (event, ...args) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !trusted(event.senderFrame.url)) throw new Error('Diese Seite darf CS2 nicht steuern.');
    const start = Date.now(), verbose = !['status', 'frame', 'live-status', 'live-devices', 'demo-folder-status'].includes(name);
    if (verbose) startup.event('Review', `${name}.started`);
    try {
      const result = await work(...args);
      if (verbose) startup.event('Review', `${name}.completed`, { elapsedMs: Date.now() - start });
      return result;
    } catch (error) {
      startup.event('Review', `${name}.failed`, { elapsedMs: Date.now() - start, code: error.code, error: error.message }, 'ERROR');
      throw error;
    }
  });
}

if (!app.requestSingleInstanceLock()) {
  startup.write('Playbook läuft bereits. Das vorhandene Fenster wird angefordert.');
  app.quit();
}
else {
  app.on('second-instance', () => {
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.show(); window.focus();
    }
  });
  // Electron waits for the ESM entry to finish before emitting ready. A top-level
  // await on whenReady() deadlocks that loader and leaves a windowless process.
  const startupDeadline = setTimeout(() => startupFailed(new Error('Innerhalb von 15 Sekunden wurde kein Playbook-Fenster geöffnet.')), 15_000);
  void app.whenReady().then(() => {
    startup.write('Electron ist startbereit.');
    presentation = new Presentation(consoleConnection, path.join(app.getPath('userData'), 'review-recovery.json'), game);
    window = new BrowserWindow({
      width: 1440, height: 1000, minWidth: 950, minHeight: 650, backgroundColor: '#0b1218', title: 'Playbook',
      webPreferences: { preload: path.join(here, 'preload.cjs'), additionalArguments: [`--playbook-origin=${ORIGIN}`], nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false, spellcheck: false },
    });
    clearTimeout(startupDeadline);
    startup.write('Playbook-Fenster erstellt.');
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Playbook', submenu: [
        { label: 'Startseite', click: () => void window.loadURL(ORIGIN) },
        { label: 'Neu laden', role: 'reload' },
        { label: 'Nach Updates suchen', click: () => void updates.check() },
        { label: 'Startprotokoll öffnen', click: () => void shell.openPath(startup.file) },
        { label: 'CS2-Verbindung prüfen', click: () => void showDiagnosis() },
        { label: 'CS2-Diagnose kopieren', click: () => lastDiagnosis ? clipboard.writeText(lastDiagnosis) : void showDiagnosis() },
        { label: 'CS2 für Review ohne VAC starten', click: () => void launchGame().catch(error => dialog.showMessageBox(window, { type: 'error', message: 'CS2 konnte nicht für den Review gestartet werden.', detail: error.message })) },
        { type: 'separator' }, { label: 'Beenden', role: 'quit' },
      ] },
      { label: 'Bearbeiten', submenu: [{ role: 'undo', label: 'Rückgängig' }, { role: 'redo', label: 'Wiederholen' }, { type: 'separator' }, { role: 'cut', label: 'Ausschneiden' }, { role: 'copy', label: 'Kopieren' }, { role: 'paste', label: 'Einfügen' }, { role: 'selectAll', label: 'Alles auswählen' }] },
      { label: 'Ansicht', submenu: [{ role: 'resetZoom', label: 'Originalgröße' }, { role: 'zoomIn', label: 'Vergrößern' }, { role: 'zoomOut', label: 'Verkleinern' }, { role: 'togglefullscreen', label: 'Vollbild' }] },
    ]));
    const browser = session.defaultSession;
    demoFolder = new DemoFolder({
      directory: path.join(app.getPath('userData'), 'demo-imports'),
      request: async (url, options = {}) => {
        const response = await browser.fetch(ORIGIN + url, {
          ...options, headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...options.headers },
          signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15 * 60_000)]) : AbortSignal.timeout(15 * 60_000),
        });
        const data = await response.json();
        if (!response.ok) throw Object.assign(new Error(data.error || 'Der Demoimport konnte nicht abgeschlossen werden.'), { status: response.status });
        return data;
      },
      extract: async (file, destination, signal) => {
        const executable = app.isPackaged ? path.join(process.resourcesPath, 'Playbook.Windows.exe') : path.join(here, '../native/bin/publish/Playbook.Windows.exe');
        try {
          const result = await exec(executable, ['demo-extract', file, destination], { windowsHide: true, timeout: 5 * 60_000, maxBuffer: 256 * 1024, signal });
          return JSON.parse(result.stdout);
        } catch (error) { throw new Error(error.stderr?.trim() || 'Das Demo-Archiv konnte nicht entpackt werden.'); }
      },
    });
    const demoFolderReady = demoFolder.initialize();
    void demoFolderReady.catch(error => startup.event('Demoimport', 'initialize.failed', { error: error.message }, 'ERROR'));
    handle('demo-folder-status', async () => { await demoFolderReady; return demoFolder.state(); });
    handle('demo-folder-set', async folder => { await demoFolderReady; return demoFolder.setFolder(folder); });
    handle('demo-folder-choose', async () => {
      await demoFolderReady;
      const choice = await dialog.showOpenDialog(window, { title: 'Demo-Ordner auswählen', properties: ['openDirectory'], defaultPath: demoFolder.folder || app.getPath('downloads') });
      return choice.canceled ? demoFolder.state() : demoFolder.setFolder(choice.filePaths[0]);
    });
    handle('demo-folder-import', async options => { await demoFolderReady; return demoFolder.run(options); });
    handle('demo-folder-cancel', () => demoFolder.cancel());
    liveRecorder = new LiveRecorder({ directory: path.join(app.getPath('userData'), 'live-recordings'),
      executable: app.isPackaged ? path.join(process.resourcesPath, 'Playbook.Windows.exe') : path.join(here, '../native/bin/publish/Playbook.Windows.exe'),
      request: async (url, options = {}) => {
        const response = await browser.fetch(ORIGIN + url, { ...options, headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...options.headers }, signal: AbortSignal.timeout(6 * 60_000) });
        const data = await response.json(); if (!response.ok) throw Object.assign(new Error(data.error || 'Die Tonaufnahme konnte nicht mit dem Server synchronisiert werden.'), { status: response.status }); return data;
      } });
    setInterval(() => { void liveRecorder.retry(); }, 10_000).unref();
    handle('live-status', () => liveRecorder.state());
    handle('live-devices', async () => {
      if (process.platform !== 'win32') throw new Error('Die Geräteaufnahme benötigt Windows.');
      const result = await exec(liveRecorder.executable, ['audio-devices'], { windowsHide: true, timeout: 10000, maxBuffer: 128 * 1024 });
      return JSON.parse(result.stdout);
    });
    handle('live-start', async (id, value) => {
      if (process.platform !== 'win32') throw new Error('Die Geräteaufnahme benötigt Windows.');
      const options = audioOptions(value);
      const choice = await dialog.showMessageBox(window, { type: 'info', title: 'Live-Tonaufnahme', message: 'Spiel und Kommunikation getrennt aufnehmen?', detail: 'Es werden ausschließlich die beiden ausgewählten Aufnahmegeräte erfasst. Bei aktivierter Mikrofonsteuerung wird nur die B2-Zuleitung des gewählten Voicemeeter-Mikrofonkanals geändert. B3 bleibt unverändert. Discord-Mute und Push-to-Talk steuern die Aufnahme nicht.', buttons: ['Aufnahme starten', 'Abbrechen'], defaultId: 1, cancelId: 1 });
      if (choice.response !== 0) return;
      await liveRecorder.begin(id, options);
    });
    handle('live-stop', async () => { await liveRecorder.stop(false); void liveRecorder.retry(); });
    handle('live-mute', value => liveRecorder.mute(value));
    handle('live-retry', () => liveRecorder.retry());
    browser.setPermissionRequestHandler((contents, permission, callback, details) => {
      const allowed = contents === window.webContents && trusted(details.requestingUrl || '') && reviewPermission(permission, details, Boolean(target));
      startup.event('Aufnahme', 'permission.request', { permission, allowed, mainFrame: details.isMainFrame, trusted: trusted(details.requestingUrl || ''), mediaTypes: details.mediaTypes }, allowed ? 'INFO' : 'WARN');
      callback(allowed);
    });
    browser.setPermissionCheckHandler((contents, permission, origin, details) => {
      const allowed = contents === window.webContents && trusted(origin) && reviewPermission(permission, details, Boolean(target));
      if (permission === 'display-capture' || permission === 'media') startup.event('Aufnahme', 'permission.check', { permission, allowed, mainFrame: details.isMainFrame, trusted: trusted(origin), mediaType: details.mediaType }, allowed ? 'INFO' : 'WARN');
      return allowed;
    });
    browser.setDisplayMediaRequestHandler(async (request, callback) => {
      try {
        if (request.frame !== window.webContents.mainFrame || !trusted(request.securityOrigin) || !target || request.audioRequested) throw new Error('Aufnahme nicht freigegeben.');
        const current = await capturedGame();
        if (current.minimized) throw new Error('CS2 ist minimiert.');
        const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } });
        const source = sources.find(source => source.id.split(':')[1] === current.id);
        if (!source) throw new Error('CS2 ist nicht aufnehmbar.');
        callback({ video: source });
      } catch (error) { startup.event('Aufnahme', 'window.failed', { error: error.message }, 'ERROR'); callback({}); }
    }, { useSystemPicker: false });
    window.webContents.on('will-navigate', (event, url) => { if (!loginNavigation(url)) event.preventDefault(); });
    window.webContents.on('will-redirect', (event, url) => { if (!loginNavigation(url)) event.preventDefault(); });
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) void disconnect().catch(() => {});
    });
    window.webContents.on('render-process-gone', (_event, details) => {
      startup.event('Electron', 'renderer.gone', { reason: details.reason, exitCode: details.exitCode }, 'ERROR');
      void disconnect().catch(error => startup.event('Review', 'recovery.failed', { error: error.message }, 'ERROR'));
    });
    handle('status', async () => ({ appVersion: app.getVersion(), update: updates.status, connected: Boolean(target), recovery: Boolean(await presentation.saved()), active: Boolean(presentation.active) }));
    handle('launch', launchGame);
    handle('connect', async () => {
      if (launching) throw new Error('CS2 wird noch gestartet. Bitte kurz warten und anschließend das Spielbild verbinden.');
      if (presentation.active) throw new Error('Bitte die Aufnahme zuerst beenden.');
      let next;
      try {
        next = await game();
        await presentation.recover();
        await consoleConnection.read(['crosshair']);
      } catch (error) { throw await connectionError(error, 'connect'); }
      target = next;
      blocker ??= powerSaveBlocker.start('prevent-display-sleep');
      await saveDiagnosis(undefined, 'connect', true);
    });
    handle('frame', async (width, height) => captureFrame(await capturedGame(), width, height));
    handle('begin', async (slot, cameraPitch) => {
      await capturedGame();
      if (presentation.active) throw new Error('Eine Aufnahme läuft bereits.');
      if (slot === 'video' && !globalShortcut.register('F8', () => window.webContents.send('review:stop-video')))
        throw new Error('F8 ist von einer anderen App belegt. Bitte dort freigeben und erneut versuchen.');
      try { return await presentation.begin(slot, cameraPitch); }
      catch (error) { globalShortcut.unregister('F8'); throw error; }
    });
    handle('end', async token => { if (typeof token !== 'string' || token.length > 100) throw new Error('Ungültige Aufnahme.'); await presentation.end(token); globalShortcut.unregister('F8'); });
    handle('disconnect', disconnect);
    handle('recover', async () => { await presentation.recover(); globalShortcut.unregister('F8'); });
    handle('update-check', () => updates.check());
    handle('update-install', async () => {
      if (liveRecorder.state().recording) throw new Error('Beende die Tonaufnahme vor dem Neustart.');
      if (demoFolder.state().running) throw new Error('Beende den Ordnerimport vor dem Neustart.');
      if (target || presentation.active || await presentation.saved()) throw new Error('Bitte den Review beenden und die Spieleinstellungen wiederherstellen, bevor die App neu startet.');
      if (updates.status.state !== 'ready') throw new Error('Es ist noch kein Update bereit.');
      quitting = true; autoUpdater.quitAndInstall(false, true);
    });
    void updates.check();
    if (app.isPackaged) setInterval(() => { void updates.check(); }, 4 * 60 * 60 * 1000).unref();
    // Recovery after a crash/reload is retried even when the review page is closed.
    setInterval(() => {
      void presentation.recoverIfIdle().then(() => {
        if (recoveryError) { startup.event('Review', 'recovery.completed'); recoveryError = undefined; }
      }).catch(error => {
        if (!recoveryError || recoveryError.message !== error.message || Date.now() - recoveryError.time > 60_000) {
          startup.event('Review', 'recovery.pending', { code: error.code, error: error.message }, 'WARN');
          recoveryError = { message: error.message, time: Date.now() };
        }
      });
    }, 5000).unref();
    window.on('close', event => {
      if (quitting) return;
      event.preventDefault();
      demoFolder.cancel();
      void liveRecorder.stop(false).then(() => disconnect()).then(() => { quitting = true; app.quit(); }).catch(async () => {
        const choice = await dialog.showMessageBox(window, { type: 'warning', buttons: ['Geöffnet lassen', 'Trotzdem beenden'], defaultId: 0, cancelId: 0, message: 'CS2 konnte noch nicht wiederhergestellt werden.', detail: 'Die ursprünglichen Einstellungen bleiben lokal gesichert. Verbinde CS2 erneut, damit Playbook sie wiederherstellen kann.' });
        if (choice.response === 1) { quitting = true; app.quit(); }
      });
    });
    app.on('will-quit', () => { globalShortcut.unregisterAll(); consoleConnection.shutdown(); });
    void window.loadURL(ORIGIN).then(() => startup.write('Playbook-Seite geladen.')).catch(error => {
      startup.write(`Playbook-Seite konnte nicht geladen werden: ${error.code || 'Ladefehler'}`);
      void dialog.showMessageBox(window, { type: 'error', message: 'Playbook ist momentan nicht erreichbar.', detail: 'Prüfe die Internetverbindung. Über Playbook → Neu laden kannst du es erneut versuchen.' });
    });
  }).catch(error => { clearTimeout(startupDeadline); startupFailed(error); });
}

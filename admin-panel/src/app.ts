import { Changes, LiveResources, liveError } from "./live-resources.js";
import crypto from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installAuth, authenticatedUser } from "./auth.js";
import { authorize, isPlatformAdmin, isServerAdmin, accessOf, ROLE_CATALOG, ACTIONS } from "../shared/authorization.js";
import { routeAllowed } from "./authorization.js";
import { installWorkspace } from "./workspace-routes.js";
import { installDemoAnalysis } from "./demo-routes.js";
import { installRecordings } from "./recording-routes.js";
import { installMatches } from "./match-routes.js";
import {
  nadesToMatchZySavedNadesConfig,
  sanitizeAdmins,
  sanitizeSettings
} from "./validators.js";
import { buildDiagnostics } from "./diagnostics.js";
import { MATCH_ADMIN_SETTINGS, settingsForRole, buildControlModel, normalizeSettings, SETTINGS_GROUPS, validateRunnableSettings, validateSettings } from "./policy.js";
import { writeAdminRuntimeFiles, writeServerRuntimeFiles, writeServerRuntimeSettings } from "./runtime-files.js";
import { currentMapFromStatus, executeRcon, mapChangeCommand } from "./rcon.js";
import { applyWebNadeAction } from "./nade-review.js";
import { installReviewUploads } from "./uploadthing.js";
import { installReviewCapture } from "./review-capture.js";
import { installVideoPreviews } from "./video-preview.js";
import { installMapScenes } from "./map-scenes.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "..", "dist");
function actionMessage(result) {
  const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  return output || (result.ok ? "Command completed" : "Command failed");
}

function nadesLibraryStatus(document) {
  return {
    count: Array.isArray(document?.entries) ? document.entries.length : 0,
    updatedAt: document?.updatedAt || null
  };
}

async function resetRepairFlagAfterBootstrap({ config, store, compose, since }) {
  const observed = await compose.waitForServiceLog(
    ["[pre.sh] Hook finished successfully", "[pre.sh] Hook failed"],
    since
  );

  const resetSettings = sanitizeSettings({ ...(await store.getSettings()), repairMods: false });
  await writeServerRuntimeSettings(config, resetSettings);
  await store.saveSettings(resetSettings);
  await store.logAction(
    "repair_reset",
    observed ? "success" : "failed",
    observed
      ? "Reset the one-shot repair switch after the mod bootstrap"
      : "Reset the one-shot repair switch after timing out while waiting for the mod bootstrap"
  );
}

export function createApp({ config, store, compose, nadesSync, restartScheduler = null, rcon = executeRcon, steamVerifier = undefined }) {
  async function readMapInventory() {
    try {
      const parsed = JSON.parse(await readFile(join(dirname(config.liveNadesFile), "savednades.maps.json"), "utf8"));
      return Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
  }

  const app = express();
  const live = new LiveResources(store.changes ||= new Changes());
  app.locals.live = live;
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  // One write queue for edits and upload callbacks, including installations without sync.
  let lineupWrites: Promise<unknown> = Promise.resolve();
  async function changeEntries(change) {
    if (nadesSync) return nadesSync.changeFromPanel(change);
    const pending = lineupWrites.then(async () => store.saveNades(change(await store.getNades())));
    lineupWrites = pending.catch(() => {});
    return pending;
  }
  installReviewUploads(app, { config, store, changeEntries });

  const loginLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Zu viele Anmeldeversuche. Bitte in fünf Minuten erneut versuchen." }
  });

  app.get("/healthz", (req, res) => res.json({ ok: true, service: "playbook" }));
  installAuth(app, { config, store, loginLimiter, steamVerifier, live });
  installWorkspace(app, { store, config, live });
  installDemoAnalysis(app, { store, live });
  installRecordings(app, { store, live, config });
  installMatches(app, { store, live });

  // Deny by default. Content writes, users, credentials and diagnostics stay admin-only.
  app.use("/api", (req, res, next) => {
    if (routeAllowed(res.locals.user, req.method, req.path)) return next();
    res.status(403).json({ error: "Für diese Aktion fehlt dir die Berechtigung." });
  });

  app.get("/api/nades/review/config", (_req, res) => res.json({ uploadEnabled: !!config.uploadthingToken }));
  app.get("/api/nades/events", (req, res) => {
    if (!store.nadeEvents) { res.status(503).end(); return; }
    void store.nadeEvents.stream(req, res, () => store.getNades(), async () => !!await authenticatedUser(req, config, store));
  });
  installReviewCapture(app, { config, store });
  installVideoPreviews(app, { store });
  installMapScenes(app, { directory: join(config.uploadDir || "/uploads", "map-scenes") });

  async function controlSettings(req, res) {
    const input: any = sanitizeSettings(req.body?.settings);
    if (req.body?.admins !== undefined) throw new Error("Benutzer bitte über die Benutzerverwaltung ändern.");
    if (isServerAdmin(res.locals.user)) return normalizeSettings(validateSettings(input));
    if (Object.keys(input).some(key => !MATCH_ADMIN_SETTINGS.includes(key))) throw new Error("Diese Einstellung darf nur ein Admin ändern.");
    const previous = await store.getSettings();
    // Match admins may add Workshop maps; changing/removing existing metadata is forbidden.
    const before = JSON.parse(previous.workshopMapCatalog || "[]");
    const after = JSON.parse(input.workshopMapCatalog ?? previous.workshopMapCatalog ?? "[]");
    if (!Array.isArray(after) || !before.every(map => after.some(candidate => JSON.stringify(candidate) === JSON.stringify(map))))
      throw new Error("Bestehende Workshop-Maps dürfen nicht bearbeitet oder entfernt werden.");
    const ids = String(previous.workshopMaps || "").split(/[\s,]+/).filter(Boolean);
    const nextIds = String(input.workshopMaps ?? previous.workshopMaps ?? "").split(/[\s,]+/);
    if (!ids.every(id => nextIds.includes(id))) throw new Error("Bestehende Workshop-Maps dürfen nicht entfernt werden.");
    return normalizeSettings(validateSettings({ ...previous, ...input }));
  }

  live.get(app, "/api/users", async () => {
      const teams = store.workspace ? await store.workspace.listTeams() : [];
      const entries = (await store.getAdmins()).map(user => ({ ...user, access: accessOf(user),
        teams: teams.filter(team => team.members.some(member => member.userId === user.identitySteam64))
          .map(team => ({ id: team.id, name: team.name, role: team.members.find(member => member.userId === user.identitySteam64).role })) }));
      return { entries, roles: ROLE_CATALOG };

  });
  live.get(app, "/api/access", async () => {
      let published = null, applied = null;
      try { published = JSON.parse(await readFile(join(dirname(config.runtimeAdminsFile), "permissions.json"), "utf8")); } catch {}
      try { applied = JSON.parse(await readFile(join(dirname(config.liveNadesFile), "permissions-applied.json"), "utf8")); } catch {}
      const history = store.actions ? await store.actions.find({ type: { $in: ["user_role", "team_change", "team_join", "team_invite"] } }).sort({ createdAt: -1 }).limit(50).toArray() : [];
      return { roles: ROLE_CATALOG, actions: ACTIONS, history,
        runtime: { publishedRevision: published?.revision || null, appliedRevision: applied?.revision || null,
          appliedAt: applied?.appliedAt || null, synchronized: !!published && published.revision === applied?.revision } };

  }, 3000);
  app.put("/api/users/:steamId", async (req, res, next) => {
    try {
      const user = sanitizeAdmins([{ ...req.body, identitySteam64: req.params.steamId }])[0];
      const previousAccess = accessOf(await store.getUser(user.identitySteam64));
      if (user.identitySteam64 === res.locals.user.identitySteam64 && !isPlatformAdmin(user))
        return res.status(400).json({ error: "Die eigene Admin-Rolle kann nicht entfernt werden. Ein anderer Admin kann sie ändern." });
      const saved = await store.saveUser({ ...user, accessRevision: req.body?.accessRevision }, res.locals.user.identitySteam64);
      await writeAdminRuntimeFiles(config, () => store.getAdmins());
      await store.logAction("user_role", "success", "Benutzer gespeichert", { actor: res.locals.user.identitySteam64, subject: user.identitySteam64, previousAccess, access: accessOf(saved || user) });
      res.json({ user: saved || user });
    } catch (error) { next(error); }
  });

  app.post(
    "/api/uploads/lineup-image",
    express.raw({ type: ["image/jpeg", "image/png", "image/webp", "image/gif"], limit: "4mb" }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: "Select a JPEG, PNG, WebP or GIF image" });
      }
      const extensions = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };
      const extension = extensions[String(req.headers["content-type"] || "").split(";")[0]];
      if (!extension) return res.status(415).json({ error: "Unsupported image type" });

      const originalName = decodeURIComponent(String(req.headers["x-file-name"] || "lineup-image")).slice(0, 180);
      const key = `${crypto.randomUUID()}${extension}`;
      await mkdir(config.uploadDir, { recursive: true });
      await writeFile(join(config.uploadDir, key), req.body);
      return res.json({
        key,
        url: `/api/uploads/${key}`,
        name: originalName || `lineup-image${extname(key)}`,
        size: req.body.length,
        uploadedAt: new Date().toISOString()
      });
    }
  );

  app.get("/api/uploads/:key", async (req, res) => {
    const key = String(req.params.key || "");
    if (!/^[0-9a-f-]+\.(?:jpg|png|webp|gif)$/i.test(key)) return res.status(404).end();
    try {
      if (!isPlatformAdmin(res.locals.user) && !(await store.getNades())
          .some(nade => nade.lineupImages?.some(image => image.url === `/api/uploads/${key}`))) return res.status(404).end();
      const content = await readFile(join(config.uploadDir, key));
      const contentTypes = { ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" };
      res.type(contentTypes[extname(key).toLowerCase()] || "application/octet-stream").send(content);
    } catch (error) {
      if (error.code === "ENOENT") return res.status(404).end();
      throw error;
    }
  });

  live.get(app, "/api/settings", async () => {
    return {
      settings: await store.getSettings(),
      curatedFields: SETTINGS_GROUPS.flatMap((group) => group.fields),
      settingsGroups: SETTINGS_GROUPS
    };
  });

  app.put("/api/settings", async (req, res) => {
    const settings = normalizeSettings(validateSettings(sanitizeSettings(req.body?.settings)));
    res.json({ settings: await store.saveSettings(settings) });
  });

  live.get(app, "/api/nades", async ({ user }) => {
    const document = await store.getNadesDocument();
    return {
      entries: document?.entries || [],
      library: nadesLibraryStatus(document),
      sync: isPlatformAdmin(user) ? nadesSync?.status() || { enabled: false, state: "disabled" } : { enabled: false, state: "disabled" }
    };
  });

  live.get(app, "/api/nades/status", async ({ user }) => {
    const document = await store.getNadesDocument();
    return {
      library: nadesLibraryStatus(document),
      sync: isPlatformAdmin(user) ? nadesSync?.status() || { enabled: false, state: "disabled" } : { enabled: false, state: "disabled" }
    };
  }, 3000);

  live.get(app, "/api/control", async ({ user }) => {
      const settings = await store.getSettings();
      const document = await store.getNadesDocument();
      const nades = document?.entries || [];
      const status = { mapInventory: await readMapInventory() } as any;
      if (!authorize(user, "server.match")) return { user, nades, status,
        settings: { workshopMaps: settings.workshopMaps, workshopMapCatalog: settings.workshopMapCatalog } };
      if (isServerAdmin(user)) Object.assign(status, {
        service: await Promise.resolve().then(() => compose.serviceStatus()).catch(() => ({ state: "unavailable" })), lastAction: await store.getLastAction(),
        maintenance: await restartScheduler?.status() || { enabled: false },
        nadesSync: nadesSync?.status() || { enabled: false, state: "disabled" }, nadesLibrary: nadesLibraryStatus(document)
      });
      const policy = buildControlModel(settings);
      if (!isServerAdmin(user)) policy.settingsGroups = [];
      if (!isPlatformAdmin(user)) policy.adminRoles = [];
      return { user, settings: settingsForRole(settings, user), admins: isPlatformAdmin(user) ? await store.getAdmins() : [], nades, status, policy };

  });

  live.get(app, "/api/nades/favorites", async ({ user }) => {
    return { entries: await store.getNadeFavorites(user.identitySteam64) };
  });

  app.put("/api/nades/favorites", async (req, res, next) => {
    try {
      const { owner, map, name, favorite } = req.body || {};
      if (![owner, map, name].every(value => typeof value === "string" && value.length > 0 && value.length <= 500) || typeof favorite !== "boolean")
        return res.status(400).json({ error: "Ungültiger Favorit." });
      const reference = { owner, map, name };
      if (favorite && !(await store.getNades()).some(nade => nade.owner === owner && nade.map === map && nade.name === name))
        return res.status(404).json({ error: "Dieses Lineup ist nicht mehr verfügbar." });
      res.json({ entries: await store.setNadeFavorite(res.locals.user.identitySteam64, reference, favorite) });
    } catch (error) { next(error); }
  });

  app.put("/api/control", async (req, res, next) => {
    try {
      const settings = await controlSettings(req, res);
      await store.saveSettings(settings);
      res.json({ settings: settingsForRole(settings, res.locals.user) });
    } catch (error) { next(error); }
  });

  // Retired bulk writes bypassed per-lineup ownership and revision checks.
  const retiredNadeWrite = (_req, res) => res.status(410).json({ error: "Bitte bearbeite und prüfe Aufnahmen direkt auf der jeweiligen Lineup-Seite." });
  app.put("/api/nades", retiredNadeWrite);
  app.post("/api/nades/import", retiredNadeWrite);

  // Use the sync queue so web edits cannot race an ingame capture or approval.
  // The local queue also serializes requests in installations without file sync.
  app.post("/api/nades/entry", async (req, res) => {
    try {
      const change = entries => applyWebNadeAction(entries, req.body, res.locals.user);
      const entries = await changeEntries(change);
      res.json({ entries, ...(req.body?.action === "create" ? { entry: entries.at(-1) } : {}) });
    } catch (error) { res.status(error.status || 400).json({ error: error.message }); }
  });

  app.get("/api/nades/export", async (req, res) => {
    res.json(nadesToMatchZySavedNadesConfig(await store.getNades()));
  });

  app.post("/api/server/apply", async (req, res) => {
    const settings = normalizeSettings(validateRunnableSettings(await store.getSettings()));
    const nades = await store.getNades();
    const nextSettings = normalizeSettings(settings);

    await writeServerRuntimeFiles(config, nadesSync, nextSettings, () => store.getAdmins(), nades);
    await store.saveSettings(nextSettings);

    const result = await compose.recreateService();
    await store.logAction("apply", result.ok ? "success" : "failed", actionMessage(result), { code: result.code });
    res.status(result.ok ? 200 : 500).json({ ok: result.ok, message: actionMessage(result) });
  });

  app.post("/api/server/restart", async (req, res) => {
    const settings = normalizeSettings(validateRunnableSettings(await store.getSettings()));
    const nades = await store.getNades();
    await writeServerRuntimeFiles(config, nadesSync, settings, () => store.getAdmins(), nades);

    const result = await compose.restartService();
    await store.logAction("restart", result.ok ? "success" : "failed", actionMessage(result), {
      code: result.code,
      mode: settings.serverMode
    });
    res.status(result.ok ? 200 : 500).json({ ok: result.ok, message: actionMessage(result) });
  });

  async function runtimeSettings() {
    try {
      return JSON.parse(await readFile(config.runtimeSettingsFile, "utf8"));
    } catch {
      throw new Error("Apply the server settings first so live controls can connect to CS2.");
    }
  }

  function liveCommand(settings, command) {
    if (!settings.rconPassword) throw new Error("Apply an RCON password before using live controls.");
    return rcon({ host: config.serviceName || "cs2", password: settings.rconPassword, command });
  }

  live.get(app, "/api/server/game", async () => {
      const settings = await runtimeSettings();
      const output = await liveCommand(settings, "status");
      return { map: currentMapFromStatus(output), mode: settings.serverMode, startMap: settings.startMap };

  }, 3000, true);

  app.post("/api/server/map", async (req, res, next) => {
    let command;
    let settings;
    try {
      command = mapChangeCommand(req.body);
      settings = await runtimeSettings();
      const inventory = await readMapInventory();
      if (inventory && !inventory.some(m => m.Available === true && (req.body.workshopId ? m.WorkshopId === req.body.workshopId : m.MapName === req.body.map && !m.WorkshopId)))
        throw new Error("Diese Map ist nicht als ladbare Server-Map verfügbar. Bestand aktualisieren oder Workshop-Version aktivieren.");
      if (req.body.workshopId && !String(settings.workshopMaps || "").split(/[\s,]+/).includes(req.body.workshopId)) {
        throw new Error("Add and apply this Workshop map before switching to it.");
      }
    } catch (error) {
      return next(error);
    }
    try {
      const output = await liveCommand(settings, command);
      if (/unknown command|not found|no such map|couldn.t|failed|invalid|unable to|can.t change/i.test(output)) throw new Error(output);
      const target = req.body.workshopId ? `Workshop ${req.body.workshopId}` : req.body.map;
      const message = `Map change requested: ${target}. Refresh the live map after CS2 finishes loading.`;
      await store.logAction("map_change", "success", message);
      res.json({ ok: true, message });
    } catch (error) {
      try {
        await store.logAction("map_change", "failed", error.message);
        res.status(502).json({ error: error.message });
      } catch (logError) {
        next(logError);
      }
    }
  });

  app.post("/api/control/apply", async (req, res, next) => {
    try {
      const settings = validateRunnableSettings(await controlSettings(req, res));
      await store.saveSettings(settings);
      await writeServerRuntimeFiles(config, nadesSync, settings, () => store.getAdmins(), await store.getNades());
      const result = await compose.recreateService();
      await store.logAction("apply", result.ok ? "success" : "failed", actionMessage(result), { actor: res.locals.user.identitySteam64 });
      res.status(result.ok ? 200 : 500).json({ ok: result.ok, message: actionMessage(result) });
    } catch (error) { next(error); }
  });

  const rconLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });
  app.post("/api/server/rcon", rconLimiter, async (req, res, next) => {
    const command = req.body?.command;
    if (typeof command !== "string" || !command.trim() || command.length > 1024 || /[\x00-\x1f\x7f]/.test(command))
      return res.status(400).json({ error: "Bitte einen Befehl mit maximal 1024 Zeichen ohne Zeilenumbrüche eingeben." });
    try {
      const settings = await runtimeSettings();
      const output = await liveCommand(settings, command.trim());
      // Audit the actor and outcome, never raw commands: they can contain passwords.
      await store.logAction("rcon", "success", "RCON-Befehl ausgeführt", { actor: res.locals.user.identitySteam64 });
      res.json({ output: output || "Befehl gesendet. Der Server hat keinen Text zurückgegeben.", at: new Date().toISOString() });
    } catch (error) {
      try {
        await store.logAction("rcon", "failed", "RCON-Verbindung fehlgeschlagen", { actor: res.locals.user.identitySteam64 });
        res.status(502).json({ error: "RCON-Befehl fehlgeschlagen. Serververbindung prüfen." });
      } catch (logError) { next(logError); }
    }
  });

  app.post("/api/server/repair", async (req, res) => {
    const nades = await store.getNades();
    const repairSettings = normalizeSettings({
      ...(await store.getSettings()),
      repairMods: true
    });

    const repairStartedAt = new Date().toISOString();
    await writeServerRuntimeFiles(config, nadesSync, repairSettings, () => store.getAdmins(), nades);
    await store.saveSettings(repairSettings);
    const result = await compose.restartService();

    if (result.ok) {
      void resetRepairFlagAfterBootstrap({ config, store, compose, since: repairStartedAt }).catch(async (error) => {
        await store.logAction("repair_reset", "failed", error.message || "Could not reset the repair switch");
      });
    } else {
      const resetSettings = sanitizeSettings({ ...repairSettings, repairMods: false });
      await writeServerRuntimeSettings(config, resetSettings);
      await store.saveSettings(resetSettings);
    }

    await store.logAction("repair", result.ok ? "success" : "failed", actionMessage(result), { code: result.code });
    res.status(result.ok ? 200 : 500).json({
      ok: result.ok,
      message: result.ok ? "One-shot mod repair started. Diagnostics will update as the server boots." : actionMessage(result)
    });
  });

  live.get(app, "/api/server/status", async () => {
    return {
      service: await compose.serviceStatus(),
      nadesSync: nadesSync?.status() || { enabled: false },
      maintenance: restartScheduler ? await restartScheduler.status() : { enabled: false },
      lastAction: await store.getLastAction(["apply", "restart", "scheduled_restart", "map_change", "repair", "save", "nades_sync", "login_fail"])
    };
  }, 2000, true);

  live.get(app, "/api/server/diagnostics", async () => {
    const [raw, desired] = await Promise.all([
      compose.serviceDiagnostics(),
      store.getSettings()
    ]);
    return buildDiagnostics({
      ...raw,
      desired,
      controlMode: config.controlMode
    });
  }, 10000, true);

  live.get(app, "/api/server/logs", async ({ query }) => {
    const result = await compose.serviceLogs({ tail: query.tail });
    const output = `${result.stdout || ""}${result.stderr ? `\n${result.stderr}` : ""}`.trimEnd();
    if (!result.ok) throw liveError(503, actionMessage(result));
    return {
      ok: result.ok,
      logs: output,
      message: actionMessage(result)
    };
  }, 1000, true);

  app.use("/api", (req, res) => res.status(404).json({ error: "API-Endpunkt nicht gefunden." }));

  app.use(express.static(publicDir, { redirect: false }));
  app.get("*", (req, res) => res.sendFile(join(publicDir, "index.html")));

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(error.status || 400).json({ error: error.message || "Ungültige Anfrage." });
  });

  return app;
}

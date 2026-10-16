import { assignNadeIds } from "./nade-ids.js";
import { Collection, Db, MongoClient } from "mongodb";
import { sanitizeAdmins, sanitizeNades, sanitizeSettings } from "./validators.js";
import { withRecordedThrowSetup } from "./measured-lineup.js";
import { normalizeSettings, migrateAdmins } from "./policy.js";
import { NadeEvents } from "./nade-events.js";
import { accessOf, legacyAccess, legacyRole, cssFlags, type Access } from "../shared/authorization.js";
import { Changes } from "./live-resources.js";
import { WorkspaceStore } from "./workspace-store.js";
import { DemoStore } from "./demo-store.js";
import { RecordingStore } from "./recording-store.js";
import { AnalysisStorage } from "./analysis-storage.js";
import { MatchStore } from "./match-store.js";
import { MatchImports } from "./match-imports.js";
import { join } from "node:path";
import { problem } from "./strats.js";

type UserDocument = {
  _id: string;
  identitySteam64?: string;
  name?: string;
  role?: string;
  flags?: string[];
  createdAt?: Date;
  updatedAt?: Date;
  lastLoginAt?: Date;
  nadeFavorites?: { owner: string; map: string; name: string }[];
};

export class Store {
  readonly changes = new Changes();
  readonly nadeEvents = new NadeEvents();
  config: any;
  client: MongoClient;
  db!: Db;
  settings!: Collection<any>;
  admins!: Collection<any>;
  nades!: Collection<any>;
  actions!: Collection<any>;
  maintenance!: Collection<any>;
  users!: Collection<UserDocument>;
  sessions!: Collection<any>;
  workspace!: WorkspaceStore;
  analysis!: DemoStore;
  recordings!: RecordingStore;
  storage!: AnalysisStorage;
  matches!: MatchStore;
  imports!: MatchImports;

  constructor(config) {
    this.config = config;
    this.client = new MongoClient(config.mongodbUri);
  }

  async connect() {
    await this.client.connect();
    this.db = this.client.db(this.config.mongoDbName);
    this.settings = this.db.collection("settings");
    this.admins = this.db.collection("admins");
    this.nades = this.db.collection("nades");
    this.actions = this.db.collection("actions");
    this.maintenance = this.db.collection("maintenance");
    this.users = this.db.collection<UserDocument>("users");
    this.sessions = this.db.collection("sessions");
    await this.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    const legacy = await this.admins.findOne({ _id: "current" });
    for (const entry of sanitizeAdmins(migrateAdmins(legacy?.entries || []))) {
      await this.users.updateOne({ _id: entry.identitySteam64 }, { $setOnInsert: { ...entry, createdAt: new Date() } }, { upsert: true });
    }
    let insertedBootstrap = false;
    if (this.config.bootstrapAdminSteamId) {
      if (!/^[0-9]{17}$/.test(this.config.bootstrapAdminSteamId)) throw new Error("Ungültige ADMIN_PANEL_ADMIN_STEAM_ID.");
      const result = await this.users.updateOne({ _id: this.config.bootstrapAdminSteamId }, {
        $setOnInsert: { identitySteam64: this.config.bootstrapAdminSteamId, name: "", role: "admin", createdAt: new Date() }
      }, { upsert: true });
      insertedBootstrap = result.upsertedCount === 1;
      if (this.config.promoteBootstrapAdmin) {
        await this.users.updateOne({ _id: this.config.bootstrapAdminSteamId }, { $set: { role: "admin" } });
      }
    }
    await this.actions.createIndex({ createdAt: -1 });
    await this.maintenance.updateOne(
      { _id: "scheduled-restart" },
      { $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
    const current = await this.settings.findOne({ _id: "current" });
    if (!current?.settings || current.settings.schemaVersion !== 1) {
      await this.settings.replaceOne(
        { _id: "current" },
        { _id: "current", settings: normalizeSettings({}), createdAt: new Date() },
        { upsert: true }
      );
    } else if (current.settings.serverMode === "executes" || Object.prototype.hasOwnProperty.call(current.settings, "executesVersion")) {
      await this.settings.updateOne(
        { _id: "current" },
        { $set: { settings: normalizeSettings(current.settings), updatedAt: new Date() } }
      );
    }
    this.workspace = new WorkspaceStore(this.db, () => this.changes.publish());
    const existingUsers = await this.users.find({}).toArray();
    await this.workspace.initialize(Object.fromEntries(existingUsers.map(user => [user._id, accessOf({ identitySteam64: user._id, role: user.role })])));
    this.analysis = new DemoStore(this.db, this.config.demoDir || join(this.config.uploadDir || "/data/uploads", "demos-private"), this.workspace, this.changes);
    await this.analysis.initialize();
    this.recordings = new RecordingStore(this.db, join(this.analysis.directory, "recordings"), this.analysis, this.workspace, this.config);
    await this.recordings.initialize();
    this.storage = new AnalysisStorage(this.db, this.analysis.directory, this.config);
    await this.storage.initialize();
    this.matches = new MatchStore(this.db, this.analysis, this.workspace, this.config);
    await this.matches.initialize();
    this.imports = new MatchImports(this, this.config);
    if ((insertedBootstrap || this.config.promoteBootstrapAdmin) && this.config.bootstrapAdminSteamId) {
      for (;;) {
        const document = await this.workspace.getAccessDocument();
        if (document.users[this.config.bootstrapAdminSteamId]?.platform === "platform_admin" && document.users[this.config.bootstrapAdminSteamId]?.server === "server_admin") break;
        if (await this.workspace.replaceAccess(document.revision, { ...document.users, [this.config.bootstrapAdminSteamId]: legacyAccess("admin") })) break;
      }
    }
    await this.migrateNadeIds();
    await this.migrateThrowSetup();
  }

  async migrateThrowSetup() {
    for (;;) {
      const document = await this.nades.findOne({ _id: "current" });
      if (!document?.entries || document.throwSetupVersion >= 1) return;
      const entries = withRecordedThrowSetup(document.entries);
      const changed = entries.some((entry, index) => entry !== document.entries[index]);
      if (changed) await this.nades.updateOne(
        { _id: "before-throw-setup-v1" },
        { $setOnInsert: { entries: document.entries, updatedAt: document.updatedAt, backedUpAt: new Date() } },
        { upsert: true }
      );
      const result = await this.nades.updateOne(
        { _id: "current", entries: document.entries },
        { $set: { entries: changed ? sanitizeNades(entries) : document.entries, throwSetupVersion: 1, ...(changed && { updatedAt: new Date() }) } }
      );
      if (result.matchedCount) return;
    }
  }

  async migrateNadeIds() {
    for (;;) {
      const document = await this.nades.findOne({ _id: "current" });
      if (!document?.entries) return;
      const entries = assignNadeIds(document.entries);
      if (entries.every((entry, index) => entry.id === document.entries[index].id)) return;
      await this.nades.updateOne(
        { _id: "before-short-ids-v1" },
        { $setOnInsert: { entries: document.entries, updatedAt: document.updatedAt, backedUpAt: new Date() } },
        { upsert: true }
      );
      const result = await this.nades.updateOne(
        { _id: "current", entries: document.entries },
        { $set: { entries, idSchemaVersion: 1 } }
      );
      if (result.matchedCount) return;
    }
  }

  async close() {
    await this.client.close();
  }

  async getSettings() {
    const doc = await this.settings.findOne({ _id: "current" });
    if (doc?.settings) return normalizeSettings(doc.settings);
    return normalizeSettings({});
  }

  async saveSettings(settings) {
    const cleanSettings = normalizeSettings(sanitizeSettings(settings));
    await this.settings.updateOne(
      { _id: "current" },
      { $set: { settings: cleanSettings, updatedAt: new Date() } },
      { upsert: true }
    );
    this.changes.publish();
    await this.logAction("save", "success", "Settings saved");
    return cleanSettings;
  }

  async getAdmins() {
    const document = await this.workspace.getAccessDocument();
    return (await this.users.find({}).sort({ createdAt: 1 }).toArray()).map(user => this.userView(user, document));
  }

  async getUser(steamId) {
    const user = await this.users.findOne({ _id: steamId });
    return user ? this.userView(user, await this.workspace.getAccessDocument()) : null;
  }

  private userView(user: UserDocument, document: { users: Record<string, Access>; revision: number }) {
    const access = accessOf({ identitySteam64: user._id, access: document.users[user._id] || { platform: "user", server: "none" } });
    return { identitySteam64: user._id, name: user.name || "", access, accessRevision: document.revision,
      role: legacyRole(access), flags: cssFlags({ access }), lastLoginAt: user.lastLoginAt || null };
  }

  async recordLogin(steamId) {
    await this.users.updateOne({ _id: steamId }, {
      $setOnInsert: { identitySteam64: steamId, name: "", role: "player", createdAt: new Date() },
      $set: { lastLoginAt: new Date() }
    }, { upsert: true });
    this.changes.publish();
  }

  async recordTestLogin(steamId: string, name: string) {
    await this.users.updateOne({ _id: steamId }, {
      $setOnInsert: { identitySteam64: steamId, createdAt: new Date() },
      $set: { name, role: "player", flags: [], lastLoginAt: new Date() }
    }, { upsert: true });
    this.changes.publish();
  }

  async getNadeFavorites(steamId) {
    const user = await this.users.findOne({ _id: steamId }, { projection: { nadeFavorites: 1 } });
    return user?.nadeFavorites || [];
  }

  async setNadeFavorite(steamId, reference, favorite) {
    await this.users.updateOne({ _id: steamId }, favorite
      ? { $addToSet: { nadeFavorites: reference } }
      : { $pull: { nadeFavorites: reference } });
    this.changes.publish();
    return this.getNadeFavorites(steamId);
  }

  async saveUser(entry, actorId?: string) {
    const clean = sanitizeAdmins([entry])[0];
    const nextAccess = accessOf(clean);
    for (;;) {
      const document = await this.workspace.getAccessDocument();
      if (actorId && document.users[actorId]?.platform !== "platform_admin") problem(403, "Deine Berechtigung zur Benutzerverwaltung wurde geändert.");
      if (actorId === clean.identitySteam64 && nextAccess.platform !== "platform_admin") problem(400, "Die eigene Plattform-Admin-Rolle kann nur ein anderer Admin ändern.");
      if (entry.accessRevision !== undefined && entry.accessRevision !== document.revision) problem(409, "Die Rollen wurden inzwischen geändert. Bitte neu laden.");
      const users = { ...document.users, [clean.identitySteam64]: nextAccess };
      if (!Object.values(users).some(access => access.platform === "platform_admin")) problem(400, "Mindestens ein Plattform-Admin muss erhalten bleiben.");
      if (await this.workspace.replaceAccess(document.revision, users)) break;
    }
    await this.users.updateOne({ _id: clean.identitySteam64 }, {
      $set: { identitySteam64: clean.identitySteam64, name: clean.name, updatedAt: new Date() },
      $unset: { role: "", flags: "" }, $setOnInsert: { createdAt: new Date() }
    }, { upsert: true });
    this.changes.publish();
    return this.getUser(clean.identitySteam64);
  }

  async createSession(id, value) { await this.sessions.insertOne({ _id: id, ...value }); }
  async getSession(id) { return this.sessions.findOne({ _id: id, expiresAt: { $gt: new Date() } }); }
  async consumeSession(id, purpose) { return this.sessions.findOneAndDelete({ _id: id, purpose, expiresAt: { $gt: new Date() } }); }
  async deleteSession(id) { await this.sessions.deleteOne({ _id: id }); this.changes.publish(); }

  async ensureScheduledRestart(nextRunAt) {
    await this.maintenance.updateOne(
      { _id: "scheduled-restart", nextRunAt: { $exists: false } },
      { $set: { nextRunAt } }
    );
    return this.getMaintenanceState();
  }

  async claimScheduledRestart(slot, now = new Date()) {
    const result = await this.maintenance.findOneAndUpdate(
      { _id: "scheduled-restart", nextRunAt: slot, lastClaimedSlot: { $ne: slot } },
      { $set: { lastClaimedSlot: slot, claimedAt: now, state: "running", nextRunAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString() } },
      { returnDocument: "after" }
    );
    if (result) this.changes.publish();
    return Boolean(result);
  }

  async completeScheduledRestart(slot, result) {
    await this.maintenance.updateOne(
      { _id: "scheduled-restart", lastClaimedSlot: slot },
      { $set: { state: result.state || (result.ok ? "success" : "failed"), nextRunAt: result.nextRunAt, lastRunAt: new Date(), lastMessage: String(result.message || "") } }
    );
    this.changes.publish();
  }

  async getMaintenanceState() {
    return await this.maintenance.findOne({ _id: "scheduled-restart" });
  }

  async getNades() {
    const doc = await this.nades.findOne({ _id: "current" });
    return doc?.entries || [];
  }

  async getNadesDocument() {
    return await this.nades.findOne({ _id: "current" });
  }

  async saveNades(entries) {
    const cleanEntries = sanitizeNades(entries);
    await this.nades.updateOne(
      { _id: "current" },
      { $set: { entries: cleanEntries, updatedAt: new Date() } },
      { upsert: true }
    );
    await this.logAction("save", "success", "Nades saved");
    this.changes.publish();
    this.nadeEvents.publish(cleanEntries);
    return cleanEntries;
  }

  async replaceNadesFromSync(entries, details = {}) {
    const cleanEntries = sanitizeNades(entries);
    await this.nades.updateOne(
      { _id: "current" },
      { $set: { entries: cleanEntries, updatedAt: new Date() } },
      { upsert: true }
    );
    await this.logAction("nades_sync", "success", "Lineups vom Spielserver übernommen", details);
    this.changes.publish();
    this.nadeEvents.publish(cleanEntries);
    return cleanEntries;
  }

  async logAction(type, status, message, details = {}) {
    await this.actions.insertOne({
      type,
      status,
      message: String(message || ""),
      details,
      createdAt: new Date()
    });
    this.changes.publish();
  }

  async getLastAction(types = []) {
    const query = types.length > 0 ? { type: { $in: types } } : {};
    return this.actions.find(query).sort({ createdAt: -1 }).limit(1).next();
  }

}

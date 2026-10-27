// Lokales Live-Beispiel aus einem authentifiziert gelesenen Bibliotheksauszug.
// PLAYBOOK_IMPORT_SOURCE muss die erwartete Herkunft des Auszugs enthalten.
// Aufruf im Dev-API-Container: node scripts/seed-live-demo.mjs /tmp/lineups.json STEAM_ID
import { readFile } from "node:fs/promises";
import { MongoClient } from "mongodb";
import { sanitizeNades } from "../build/src/validators.js";
import { assignNadeIds } from "../build/src/nade-ids.js";
import { validateContent } from "../build/src/strats.js";

if (process.env.NODE_ENV !== "development") throw new Error("Dieses Beispiel darf ausschließlich in der lokalen Entwicklung angelegt werden.");
const [inputPath, userId] = process.argv.slice(2);
if (!inputPath || !/^\d{17}$/.test(userId || "")) throw new Error("Bibliotheksauszug und Steam-ID angeben.");
const input = JSON.parse(await readFile(inputPath, "utf8"));
if (!process.env.PLAYBOOK_IMPORT_SOURCE || input.source !== process.env.PLAYBOOK_IMPORT_SOURCE) throw new Error("PLAYBOOK_IMPORT_SOURCE auf die erwartete Herkunft des Bibliotheksauszugs setzen.");
const incoming = sanitizeNades(input.entries);
if (!incoming.length || incoming.length > 12 || incoming.some(nade => !Object.values(nade.reviewMedia || {}).some(file => file?.url) && !nade.lineupImages?.length)) throw new Error("Bitte 1 bis 12 Lineups mit Medien übergeben.");
const client = new MongoClient("mongodb://mongodb:27017/cs2_admin_panel");
await client.connect();
try {
  const db = client.db("cs2_admin_panel");
  if (!await db.collection("users").findOne({ $or: [{ _id: userId }, { identitySteam64: userId }] })) throw new Error("Der Beispielspieler muss sich lokal bereits angemeldet haben.");
  const library = db.collection("nades");
  const current = await library.findOne({ _id: "current" });
  const existing = current?.entries || [];
  const key = nade => JSON.stringify([nade.owner, nade.map, nade.name]);
  const known = new Set(existing.map(key));
  const merged = assignNadeIds([...existing, ...incoming.filter(nade => !known.has(key(nade)))]);
  // Ergänzen statt ersetzen: bestehende Aufnahmen und lokale Korrekturen bleiben erhalten.
  if (merged.length !== existing.length) {
    const result = await library.updateOne({ _id: "current", entries: existing }, { $set: { entries: merged, updatedAt: new Date() } });
    if (result.matchedCount !== 1) throw new Error("Die lokale Bibliothek wurde parallel geändert. Bitte erneut ausführen.");
  }
  const selected = incoming.map(nade => merged.find(local => key(local) === key(nade)));
  const grouped = Map.groupBy(selected, nade => nade.map);
  const [map, lineups] = [...grouped.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  const now = new Date().toISOString();
  const teamId = "79e6882f-26cf-492d-a588-a724a7c01250";
  const team = { id: teamId, name: "Live-Labor · Tablet", revision: 1, members: [{ userId, role: "owner", joinedAt: now }], invitations: [], live: true, active: null, createdAt: now };
  const roleNames = ["Utility", "Entry", "Trade", "Lurker", "AWP"];
  const variants = [
    { title: "Setpiece · Utility auf Call", ownEconomy: ["fullbuy", "semi-buy"], opponentEconomy: ["fullbuy"], description: "Lokales Beispiel: Lineups vorbereiten, auf gemeinsamen Call werfen und zusammen weitergehen." },
    { title: "Eco · Kontaktspiel", ownEconomy: ["eco"], opponentEconomy: ["fullbuy", "semi-buy"], description: "Lokales Beispiel: zusammenbleiben, vorhandene Utility nutzen und den ersten Kontakt traden." },
    { title: "Pistol · Schneller Call", ownEconomy: ["pistol"], opponentEconomy: ["pistol"], description: "Lokales Beispiel: kurze Wege, ein gemeinsamer Call und klar verteilte Aufgaben." },
    { title: "Default · Lineup-Warmup", ownEconomy: [], opponentEconomy: [], description: "Lokales Beispiel für alle Kaufsituationen. Position und Ausrichtung der Medien-Lineups gemeinsam ansehen." },
  ];
  const demos = variants.map((variant, index) => {
    const group = index === 3 && grouped.size > 1 ? [...grouped.entries()].find(([name]) => name !== map)[1] : lineups;
    const nade = group[index % group.length];
    const content = validateContent({ ...variant, map: nade.map, side: "t", slots: roleNames.map((label, slot) => ({ id: `demo-slot-${slot}`, label, userId: slot === 0 ? userId : "", steps: slot === 0 ? [
      { id: "prepare", text: `Bereite „${nade.displayName || nade.name}“ vor. Prüfe Position und Ausrichtung; wirf auf den gemeinsamen Call.`, position: nade.throwFromTitle || "Startpunkt des Lineups", timing: "Auf den Call", nadeIds: [nade.id] },
      { id: "follow", text: "Nach dem Wurf zum Team aufschließen. Gemeinsam weitergehen und den ersten Kontakt traden.", position: "Beim Team", timing: "Nach der Utility", nadeIds: [] },
    ] : [{ id: `role-${slot}`, text: "Auf den gemeinsamen Call warten und den Einstieg mit dem Team abstimmen.", position: "Beim Team", timing: "Auf den Call", nadeIds: [] }] })) }, team);
    const id = `f62949a0-99a7-4d4b-8c84-1bbf5e51300${index}`;
    return { id, teamId, revision: 1, draft: content, published: { version: 1, publishedAt: now, content }, archived: false, createdBy: userId, updatedAt: now };
  });
  team.active = { stratId: demos[0].id, version: 1, activationId: "local-live-demo-start", activatedAt: now, activatedBy: userId, content: demos[0].published.content };
  // Erneutes Ausführen respektiert spätere Handarbeit am Beispielteam und seinen Strats.
  await db.collection("teams").updateOne({ _id: teamId }, { $setOnInsert: team }, { upsert: true });
  for (const strat of demos) await db.collection("strats").updateOne({ _id: strat.id }, { $setOnInsert: strat }, { upsert: true });
  console.log(JSON.stringify({ teamId, map, imported: merged.length - existing.length, strats: demos.length, controlPath: `/strats/control/${teamId}`, livePath: `/strats/live/${teamId}` }));
} finally { await client.close(); }

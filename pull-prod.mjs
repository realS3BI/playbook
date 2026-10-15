#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { closeSync, createWriteStream, existsSync, mkdtempSync, openSync, readSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL(".", import.meta.url)));

const database = "cs2_admin_panel";
const matchZyDir = "/volume/game/csgo/cfg/MatchZy";
const nadesFiles = ["savednades.json", "savednades.captures.json", "savednades.capture-receipts.json", "savednades.maps.json", "savednades.metadata.json"];

async function main() {
  if (process.argv.slice(2).some(arg => arg === "--help" || arg === "-h")) {
    console.log(`Ersetzt die lokalen Playbook-Daten durch eine Kopie der Produktion.

  pnpm pull:prod
  node pull-prod.mjs

Kopiert die MongoDB (ohne Sitzungen), die hochgeladenen Lineup-Bilder und die
MatchZy-Lineup-Dateien, die der Nades-Sync beim Start in die Datenbank übernimmt.
Demo-Dateien bleiben auf dem Server. Produktion wird nur gelesen.
Der SSH-Zugang steht in PLAYBOOK_PROD_SSH (Standard: playbook-prod), z. B. als
Host-Alias in ~/.ssh/config. Der Server-Schlüssel darf nur die Befehle
"mongo", "uploads" und "nades" ausführen (docs/operations.md).`);
    return;
  }

  const envFile = ".env.development";
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const target = process.env.PLAYBOOK_PROD_SSH || "playbook-prod";
  const projectName = process.env.COMPOSE_PROJECT_NAME || "playbook-dev";
  const compose = ["compose", "--project-name", projectName, "-f", "docker-compose.dev.yml", ...(existsSync(envFile) ? ["--env-file", envFile] : [])];
  const env = { ...process.env, COMPOSE_PROJECT_NAME: projectName };

  if (spawnSync("docker", ["info"], { stdio: "ignore", timeout: 15_000 }).status !== 0)
    throw new Error("Docker ist nicht erreichbar. Docker Desktop starten.");

  // Download everything first, so a broken connection never leaves the local data half replaced.
  const temp = mkdtempSync(join(tmpdir(), "playbook-prod-"));
  let services = [];
  try {
    const archive = join(temp, "mongo.archive.gz");
    const uploads = join(temp, "uploads.tar");
    const nades = join(temp, "nades.tar");
    console.log(`Hole Datenbank von ${target} (nur lesend) ...`);
    await download(target, "mongo", archive);
    if (!startsWith(archive, [0x1f, 0x8b])) throw new Error("Der Server hat keinen gültigen Datenbank-Dump geliefert.");
    console.log(`Hole Lineup-Bilder ...`);
    await download(target, "uploads", uploads);
    if (statSync(uploads).size % 512 !== 0) throw new Error("Der Server hat kein gültiges Upload-Archiv geliefert.");
    console.log(`Hole Lineup-Dateien des Spielservers ...`);
    await download(target, "nades", nades);
    if (statSync(nades).size % 512 !== 0) throw new Error("Der Server hat kein gültiges Lineup-Archiv geliefert.");

    // The nades sync would import the old local savednades.json over the fresh database, so it must not run meanwhile.
    const running = docker([...compose, "ps", "--status", "running", "--services"], { env, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
    services = ["api", "demo-worker"].filter(service => running.includes(service));
    if (services.length) run([...compose, "stop", ...services], env, "API und Worker konnten nicht gestoppt werden.");
    run([...compose, "up", "--detach", "--wait", "mongodb"], env, "MongoDB ist nicht gestartet.");

    console.log(`Spiele Datenbank ein (${size(archive)}) ...`);
    // Local sessions stay: users are keyed by Steam ID, so the current login keeps working.
    run([...compose, "exec", "-T", "mongodb", "mongosh", "--quiet", database, "--eval",
      "db.getCollectionNames().filter(name => name !== 'sessions').forEach(name => db[name].drop())"], env, "Die lokale Datenbank konnte nicht geleert werden.");
    run([...compose, "exec", "-T", "mongodb", "mongorestore", "--quiet", "--drop", "--archive", "--gzip", `--nsInclude=${database}.*`], env,
      "Der Dump konnte nicht eingespielt werden.", archive);

    console.log(`Ersetze Lineup-Bilder (${size(uploads)}) ...`);
    extract(projectName, "uploads", "find /volume -mindepth 1 -delete && tar -xf - -C /volume --no-same-owner", uploads, env);
    console.log(`Ersetze Lineup-Dateien des Spielservers (${size(nades)}) ...`);
    extract(projectName, "cs2_data", `mkdir -p ${matchZyDir} && cd ${matchZyDir} && rm -f ${nadesFiles.join(" ")} && tar -xf - --no-same-owner`, nades, env);

    console.log(`Fertig: Produktionsdaten vom ${new Date().toLocaleString("de-AT")} sind lokal eingespielt.`);
    if (!running.includes("api")) console.log("Die Entwicklungsumgebung läuft nicht. Mit `pnpm dev` starten.");
  } finally {
    rmSync(temp, { recursive: true, force: true });
    // Starting again reruns the startup migrations against the fresh data, and also follows a failed run.
    if (services.length) {
      console.log(`Starte ${services.join(" und ")} wieder ...`);
      run([...compose, "start", ...services], env, "API und Worker konnten nicht gestartet werden.");
    }
  }
}

function download(target, command, file) {
  return new Promise((resolve, reject) => {
    const out = createWriteStream(file, { mode: 0o600 });
    const ssh = spawn("ssh", ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", target, command], { stdio: ["ignore", "pipe", "inherit"] });
    ssh.stdout.pipe(out);
    ssh.once("error", error => reject(error.code === "ENOENT" ? new Error("ssh fehlt.") : error));
    ssh.once("close", code => out.close(() => {
      if (code === 0 && statSync(file).size > 0) resolve();
      else reject(new Error(`Download "${command}" von ${target} fehlgeschlagen (Exit ${code}). Ist der Schlüssel am Server eingerichtet?`));
    }));
  });
}

// Replaces files inside a compose volume; a missing volume is created the way compose would.
function extract(projectName, name, script, input, env) {
  const volume = `${projectName}_${name}`;
  if (spawnSync("docker", ["volume", "inspect", volume], { stdio: "ignore" }).status !== 0)
    run(["volume", "create", "--label", `com.docker.compose.project=${projectName}`, "--label", `com.docker.compose.volume=${name}`, volume], env, `Das Volume ${volume} fehlt.`);
  run(["run", "--rm", "-i", "--network", "none", "-v", `${volume}:/volume`, "mongo:7", "sh", "-c", script], env, `Die Dateien in ${volume} konnten nicht ersetzt werden.`, input);
}

function docker(args, options) {
  const result = spawnSync("docker", args, options);
  if (result.status !== 0) throw new Error(`docker ${args.join(" ")} ist fehlgeschlagen.`);
  return result;
}

function run(args, env, message, input) {
  const fd = input ? openSync(input, "r") : "ignore";
  try {
    if (spawnSync("docker", args, { stdio: [fd, "inherit", "inherit"], env }).status !== 0) throw new Error(message);
  } finally {
    if (input) closeSync(fd);
  }
}

function startsWith(file, bytes) {
  const fd = openSync(file, "r");
  const buffer = Buffer.alloc(bytes.length);
  readSync(fd, buffer, 0, bytes.length, 0);
  closeSync(fd);
  return bytes.every((byte, i) => buffer[i] === byte);
}

function size(file) {
  const bytes = statSync(file).size;
  return bytes < 1024 ** 2 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

main().catch(error => {
  console.error(`Abgleich fehlgeschlagen: ${error.message}`);
  process.exitCode = 1;
});

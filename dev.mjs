#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL(".", import.meta.url)));

async function main() {
  const options = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      console.log(`Playbook lokal entwickeln mit MongoDB, API und Vite.

  ./dev.sh [--url HTTP(S)-ADRESSE] [--port VITE_PORT] [--admin STEAM64_ID] [--plain]
  node dev.mjs [--url HTTP(S)-ADRESSE] [--port VITE_PORT] [--admin STEAM64_ID] [--plain]
  pnpm dev
  cd admin-panel && pnpm dev

Voraussetzungen: Node.js ab 22, pnpm (z. B. corepack enable pnpm), Docker mit Compose ab 2.22.
Standard: http://localhost:5173. HTTPS benötigt einen vorgeschalteten Proxy;
dabei läuft Vite standardmäßig auf 127.0.0.1:5173 (änderbar mit --port).
Die Einstellungen stehen in .env.development. MongoDB, API und Demo-Worker
laufen in Docker, Vite direkt auf diesem Rechner. Turborepo zeigt web, api
und worker in eigenen Bereichen; --plain schreibt alles untereinander.
Strg+C stoppt die Container; die Entwicklungsdaten bleiben erhalten.
COMPOSE_PROJECT_NAME überschreibt den Standard playbook-dev.`);
      return;
    }
    if (arg === "--plain") {
      options.plain = true;
      continue;
    }
    if (!["--url", "--port", "--admin"].includes(arg) || !args[i + 1] || args[i + 1].startsWith("--")) {
      throw new Error(`Unbekanntes oder unvollständiges Argument: ${arg}. Hilfe: --help`);
    }
    options[arg.slice(2)] = args[++i];
  }

  const envFile = ".env.development";
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const publicUrl = new URL(options.url || process.env.ADMIN_PANEL_PUBLIC_URL || "http://localhost:5173");
  if (!["http:", "https:"].includes(publicUrl.protocol) || publicUrl.username || publicUrl.password || publicUrl.pathname !== "/" || publicUrl.search || publicUrl.hash) {
    throw new Error("Für die lokale Entwicklung eine HTTP(S)-Adresse ohne Pfad angeben, z. B. http://localhost:5173.");
  }
  const admin = options.admin ?? process.env.ADMIN_PANEL_ADMIN_STEAM_ID ?? "";
  if (admin && !/^\d{17}$/.test(admin)) throw new Error("Die Steam64-ID muss aus 17 Ziffern bestehen.");
  const https = publicUrl.protocol === "https:";
  const port = Number(options.port || (https ? process.env.DEV_PORT || 5173 : publicUrl.port || 80));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Der Vite-Port muss zwischen 1 und 65535 liegen.");
  if (!https && port !== Number(publicUrl.port || 80)) throw new Error("Bei HTTP muss der Vite-Port mit dem Port in --url übereinstimmen.");
  const bindAddress = process.env.DEV_BIND_ADDRESS || (https ? "127.0.0.1" : "0.0.0.0");
  const apiPort = Number(process.env.DEV_API_PORT || 8080);
  if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) throw new Error("DEV_API_PORT muss zwischen 1 und 65535 liegen.");
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", error => reject(new Error(`Vite kann ${bindAddress}:${port} nicht verwenden (${error.code}). Den bisherigen Dev-Server beenden oder ${https ? "mit --port" : "in --url"} einen anderen Port wählen.`)));
    server.listen(port, bindAddress, () => server.close(resolve));
  });

  const info = spawnSync("docker", ["info"], { stdio: "ignore", timeout: 15_000 });
  if (info.status !== 0) throw new Error("Docker ist nicht erreichbar. Docker Desktop bzw. den Docker-Dienst starten.");
  const compose = spawnSync("docker", ["compose", "version", "--short"], { encoding: "utf8", timeout: 15_000 });
  const version = compose.stdout?.trim().replace(/^v/, "").split(".").map(Number);
  if (compose.status !== 0 || !version || !(version[0] > 2 || (version[0] === 2 && version[1] >= 22))) {
    throw new Error("Docker Compose ab Version 2.22 wird benötigt.");
  }

  const secret = process.env.ADMIN_PANEL_SESSION_SECRET || randomBytes(32).toString("hex");
  if (!existsSync(envFile)) {
    writeFileSync(envFile, [
      "# Lokale Entwicklung. Diese Datei nicht einchecken.",
      `ADMIN_PANEL_PUBLIC_URL=${publicUrl.origin}`,
      `ADMIN_PANEL_ADMIN_STEAM_ID=${admin}`,
      `ADMIN_PANEL_SESSION_SECRET=${secret}`,
      ...(https ? [`DEV_PORT=${port}`, `DEV_BIND_ADDRESS=${bindAddress}`] : []),
      ""
    ].join("\n"), { mode: 0o600, flag: "wx" });
  }
  console.log(`Starte die Entwicklungsumgebung für ${publicUrl.origin}`);
  console.log(`Browser und Steam-Callback: ${publicUrl.origin}, API lokal unter http://127.0.0.1:${apiPort}.`);
  if (https) console.log(`Der HTTPS-Proxy muss auf http://127.0.0.1:${port} weiterleiten.`);
  console.log("Vite lädt Frontend-Änderungen direkt. API und Demo-Worker starten nach Codeänderungen in etwa einer Sekunde neu.");
  console.log("Nach neuen Paketen in admin-panel/package.json die Umgebung neu starten.");
  if (admin) console.log("Die konfigurierte Steam-ID erhält beim Start lokale Admin-Rechte, auch bei einem bestehenden Konto.");
  if (!admin) console.log("Ohne ADMIN_PANEL_ADMIN_STEAM_ID erhält eine neue Steam-Anmeldung die Rolle Player.");
  console.log("Strg+C stoppt die Container. Die lokalen Daten bleiben erhalten.");

  const projectName = process.env.COMPOSE_PROJECT_NAME || "playbook-dev";
  const composeArgs = ["compose", "--project-name", projectName, "--env-file", envFile, "-f", "docker-compose.dev.yml"];
  const env = {
    ...process.env,
    COMPOSE_PROJECT_NAME: projectName,
    ADMIN_PANEL_PUBLIC_URL: publicUrl.origin,
    ADMIN_PANEL_ADMIN_STEAM_ID: admin,
    ADMIN_PANEL_SESSION_SECRET: secret,
    DEV_PORT: String(port),
    DEV_BIND_ADDRESS: bindAddress,
    DEV_HOST: bindAddress,
    DEV_API_PORT: String(apiPort),
    DEV_API_URL: `http://127.0.0.1:${apiPort}`,
    DEV_PUBLIC_URL: publicUrl.origin
  };

  // Turborepo lives in the root package, Vite in admin-panel; both are installed on this machine.
  for (const directory of [".", "admin-panel"]) {
    const install = spawnSync("pnpm", ["install", "--frozen-lockfile"], { cwd: directory, stdio: "inherit", shell: windows });
    if (install.error?.code === "ENOENT") throw new Error("pnpm fehlt. Mit `corepack enable pnpm` aktivieren und erneut starten.");
    if (install.status !== 0) throw new Error(`pnpm install in ${directory} ist fehlgeschlagen. Die Meldung steht oben.`);
  }

  // Containers run detached and restart themselves on code changes; Turborepo shows web, api and worker.
  const up = spawnSync("docker", [...composeArgs, "up", "--build", "--detach", "--wait", "--remove-orphans"], { stdio: "inherit", env });
  if (up.status !== 0) throw new Error("Die Container sind nicht gestartet. Die Meldung steht oben.");
  const ui = options.plain || !process.stdout.isTTY ? ["--ui=stream"] : [];
  const turbo = spawn(turboBin, ["run", "web", "api", "worker", ...ui], { stdio: "inherit", env, shell: windows });
  // The terminal delivers Ctrl+C to Turborepo directly; stopping happens once it exits.
  process.on("SIGINT", () => {});
  process.on("SIGTERM", () => turbo.kill("SIGTERM"));
  turbo.once("error", error => { console.error(error.message); process.exitCode = 1; });
  turbo.once("exit", code => {
    console.log("Stoppe die Container. Die lokalen Daten bleiben erhalten.");
    spawnSync("docker", [...composeArgs, "stop"], { stdio: "inherit", env });
    process.exitCode = code ?? 0;
  });
}

const windows = process.platform === "win32";

const turboBin = join("node_modules", ".bin", windows ? "turbo.cmd" : "turbo");

main().catch(error => {
  console.error(`Start fehlgeschlagen: ${error.message}`);
  process.exitCode = 1;
});

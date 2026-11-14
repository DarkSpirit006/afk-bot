#!/usr/bin/env node
// Setup wizard.
//   (no flags)  install deps, create or top up .env, start the bot
//   --update    pull the installed branch first
//   --migrate   only add missing keys to .env
//   --no-start  do not launch the bot
//   --install   reinstall deps even if node_modules exists
//   --fresh     ignore the existing .env
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const MESSAGES = require("./src/config/defaults");
const { buildEnvExample } = require("./src/config/env-example");
const { migrateEnvFile } = require("./src/services/env-migration");
const { readEnvValues, saveEnvValue } = require("./src/services/env-store");
const { parseServerAddress } = require("./src/utils/server-address");
const { USERNAME, describeError } = require("./src/utils/helpers");
const { createLogger } = require("./src/utils/logger");

const args = new Set(process.argv.slice(2));
const updateMode = args.has("--update");
const migrateOnly = args.has("--migrate");
const noStart = args.has("--no-start");
const forceInstall = args.has("--install");
const forceFresh = args.has("--fresh");

const root = __dirname;
const envPath = path.join(root, ".env");
const examplePath = path.join(root, ".env.example");
const legacyDir = path.join(root, "minecraft-afk-bot");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const device = process.env.TERMUX_VERSION ? "Termux/Android" : process.platform;
const logger = createLogger("info");

const MIN_NODE_MAJOR = 22;

function checkNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= MIN_NODE_MAJOR) return true;
  console.warn(
    `Node.js ${process.versions.node} is too old: mineflayer requires Node ${MIN_NODE_MAJOR} or newer. Install a current LTS from https://nodejs.org and run this again.`,
  );
  return false;
}

// One readline interface for the whole wizard. Opening a new one per question
// drops any lines the user pasted ahead of the prompt.
let prompts;
const waiting = [];
const typed = [];

function openPrompts() {
  prompts = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: Boolean(process.stdin.isTTY),
  });
  prompts.on("line", (line) => {
    const resolve = waiting.shift();
    if (resolve) resolve(line);
    else typed.push(line);
  });
  // Ctrl+D or a closed pipe: fall back to the defaults instead of hanging.
  prompts.on("close", () => {
    while (waiting.length) waiting.shift()("");
    prompts = undefined;
  });
}

function closePrompts() {
  if (prompts) prompts.close();
}

function ask(question, fallback = "") {
  if (!prompts) openPrompts();
  process.stdout.write(
    `${question}${fallback ? ` [${fallback}]` : ""}: `,
  );
  return new Promise((resolve) => {
    const answer = (line) => resolve(line.trim() || fallback);
    if (typed.length) answer(typed.shift());
    else waiting.push(answer);
  });
}

const confirm = async (question, fallback = "n") =>
  (await ask(`${question} (y/n)`, fallback)).toLowerCase().startsWith("y");

function runNpm(npmArgs) {
  if (process.platform === "win32") {
    return spawnSync(
      process.env.ComSpec || "cmd.exe",
      ["/d", "/s", "/c", `${npm} ${npmArgs.join(" ")}`],
      { stdio: "inherit", cwd: root },
    );
  }
  return spawnSync(npm, npmArgs, { stdio: "inherit", cwd: root });
}

// npm stamps node_modules/.package-lock.json whenever it installs. If the
// project's lock file is newer, the checkout was updated and the installed
// packages are the old ones.
function dependenciesStale() {
  const installedLock = path.join(root, "node_modules", ".package-lock.json");
  if (!fs.existsSync(installedLock)) return true;
  try {
    const installedAt = fs.statSync(installedLock).mtimeMs;
    return ["package.json", "package-lock.json"].some(
      (file) => fs.statSync(path.join(root, file)).mtimeMs > installedAt,
    );
  } catch {
    return true;
  }
}

function ensureDependencies() {
  const installed = fs.existsSync(path.join(root, "node_modules"));
  const stale = installed && dependenciesStale();
  if (installed && !stale && !forceInstall) {
    console.log("Dependencies are already installed.");
    return true;
  }
  console.log(
    stale && !forceInstall
      ? "package.json changed since the last install; updating dependencies..."
      : "Installing dependencies...",
  );
  const result = runNpm(["install", "--omit=dev", "--no-audit", "--no-fund"]);
  if (result.error || result.status !== 0) {
    console.error(
      result.error?.message ||
        "Dependency installation failed. Check your network connection and try `npm install` manually.",
    );
    return false;
  }
  return true;
}

function git(gitArgs, options = {}) {
  return spawnSync("git", ["-C", root, ...gitArgs], {
    encoding: "utf8",
    ...options,
  });
}

function updateCheckout() {
  if (!fs.existsSync(path.join(root, ".git"))) {
    console.log("Not a git checkout; skipping the update check.");
    return;
  }
  const branch = String(git(["branch", "--show-current"]).stdout || "").trim();
  if (!branch) {
    console.warn(
      "Skipping the update: the checkout is detached. Check out the installed branch first.",
    );
    return;
  }

  console.log(`Checking origin/${branch} for updates...`);
  const dirty = String(git(["status", "--porcelain"]).stdout || "").trim();
  let stashed = false;
  if (dirty) {
    const stash = git([
      "stash",
      "push",
      "--include-untracked",
      "-m",
      `setup-update-${Date.now()}`,
    ]);
    stashed = stash.status === 0;
    if (stashed) console.log("Stashed local changes before updating.");
  }

  const pull = git(["pull", "--ff-only", "origin", branch], {
    stdio: "inherit",
  });
  if (stashed) {
    const pop = git(["stash", "pop"], { stdio: "inherit" });
    if (pop.status !== 0)
      console.warn(
        "Update finished, but the stashed changes could not be reapplied. Run `git stash list` and `git stash pop` to resolve them.",
      );
  }
  if (pull.status !== 0)
    console.warn(
      "The update was not applied; continuing with the local files.",
    );
}

function migrateUserData() {
  // Older releases installed into ./minecraft-afk-bot; keep the user's .env.
  const legacyEnv = path.join(legacyDir, ".env");
  if (!fs.existsSync(envPath) && fs.existsSync(legacyEnv)) {
    fs.copyFileSync(legacyEnv, envPath);
    console.log("Migrated .env from the previous install location.");
  }
}

function writeExampleFile() {
  const contents = buildEnvExample(MESSAGES);
  const current = fs.existsSync(examplePath)
    ? fs.readFileSync(examplePath, "utf8")
    : "";
  if (current === contents) return;
  fs.writeFileSync(examplePath, contents, "utf8");
  console.log(".env.example regenerated from src/config/defaults.js.");
}

async function ensureMasterConfiguration() {
  const env = readEnvValues(envPath);
  if (!String(env.MASTER_USERNAME || "").trim()) {
    let primaryMaster = "";
    while (!USERNAME.test(primaryMaster)) {
      primaryMaster = await ask("Primary master username");
      if (!USERNAME.test(primaryMaster))
        console.error(
          "Enter a valid Minecraft username (3-16 letters, numbers or underscores).",
        );
    }
    saveEnvValue(envPath, "MASTER_USERNAME", primaryMaster);
  }
  if (env.ALLOW_OTHER_PLAYERS === undefined)
    saveEnvValue(
      envPath,
      "ALLOW_OTHER_PLAYERS",
      await confirm("Allow non-masters to use the bot?", "n"),
    );
  if (env.TPA_ENABLED === undefined || env.TPAHERE_ENABLED === undefined) {
    const teleportEnabled = await confirm(
      "Accept /tpa and /tpahere requests?",
      "y",
    );
    saveEnvValue(envPath, "TPA_ENABLED", teleportEnabled);
    saveEnvValue(envPath, "TPAHERE_ENABLED", teleportEnabled);
  }
}

async function writeFreshEnv() {
  const username = await ask("Bot name", "AFK_Bot");
  const server = parseServerAddress(
    await ask("Minecraft server address", "localhost:25565"),
  );
  console.log(
    "The AuthMe password is stored in plain text in .env, which is git-ignored. Leave it blank if the server has no auth plugin.",
  );
  const password = await ask("Auth password (input is visible)", "");
  const movement = await confirm("Should the bot move periodically?", "y");
  let primaryMaster = "";
  while (!USERNAME.test(primaryMaster)) {
    primaryMaster = await ask("Primary master username");
    if (!USERNAME.test(primaryMaster))
      console.error(
        "Enter a valid Minecraft username (3-16 letters, numbers or underscores).",
      );
  }
  const allowOtherPlayers = await confirm(
    "Allow non-masters to use the bot?",
    "n",
  );
  const teleportEnabled = await confirm(
    "Accept /tpa and /tpahere requests?",
    "y",
  );

  const values = {
    MC_HOST: server.host,
    MC_PORT: server.port,
    MC_USERNAME: username,
    AUTH_PASSWORD: password,
    MOVE_ENABLED: movement,
    MASTER_USERNAME: primaryMaster,
    ALLOW_OTHER_PLAYERS: allowOtherPlayers,
    TPA_ENABLED: teleportEnabled,
    TPAHERE_ENABLED: teleportEnabled,
  };
  for (const [key, value] of Object.entries(values))
    saveEnvValue(envPath, key, value);
  migrateEnvFile({ envPath, examplePath, messages: MESSAGES, logger });
  console.log("Configuration saved to .env.");
}

function startBot() {
  const child = spawn(process.execPath, [path.join(root, "bot.js")], {
    stdio: "inherit",
    cwd: root,
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

async function main() {
  console.log(`Minecraft AFK bot setup (${device})`);
  if (!checkNodeVersion()) process.exitCode = 1;
  migrateUserData();
  writeExampleFile();

  if (updateMode) updateCheckout();

  if (migrateOnly) {
    if (!fs.existsSync(envPath)) {
      console.error("No .env found; run `npm run setup` first.");
      process.exitCode = 1;
      return;
    }
    const added = migrateEnvFile({
      envPath,
      examplePath,
      messages: MESSAGES,
      logger,
    });
    console.log(
      added.length
        ? `Added ${added.length} new setting(s) to .env.`
        : ".env is already up to date.",
    );
    return;
  }

  if (!ensureDependencies()) {
    process.exitCode = 1;
    return;
  }

  const fresh =
    forceFresh || !fs.existsSync(envPath)
      ? true
      : await confirm("Existing installation found. Do a fresh setup?", "n");

  if (fresh) await writeFreshEnv();
  else {
    migrateEnvFile({ envPath, examplePath, messages: MESSAGES, logger });
    await ensureMasterConfiguration();
    console.log("Using the existing configuration.");
  }

  closePrompts();
  if (noStart) return;
  console.log("Starting the bot...");
  startBot();
}

main().catch((error) => {
  console.error(describeError(error));
  process.exit(1);
});

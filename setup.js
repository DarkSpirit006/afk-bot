const { spawn, spawnSync, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const device = process.env.TERMUX_VERSION ? "Termux/Android" : process.platform;
const legacyDir = path.join(__dirname, "minecraft-afk-bot");
const defaultMasterProtectedMessage =
  "The primary master, {master}, cannot be removed.";
const defaultMasterJoinMessage = "Welcome, my master.";
const defaultMasterLeaveMessage = "Goodbye, my master.";
const defaultTpaRejectMessage =
  "My master does not allow me to accept your request, {player}.";
const replyDefaults = {
  BLACKLIST_MESSAGE: "You are not allowed to use this bot, {player}.",
  TELEPORT_APPROVAL_MESSAGE:
    "Teleport request from {player} ({type}) needs master approval. A master should reply !y or !n.",
  MASTER_ONLY_MESSAGE: "{player}, only a master can use that command.",
  PUBLIC_ACCESS_MESSAGE: "Bot access is now public.",
  PRIVATE_ACCESS_MESSAGE:
    "Bot access is now private. Only masters may use bot commands, and teleport requests require master approval.",
  TPA_USAGE_MESSAGE: "Usage: !tpa <on|off>",
  TPA_STATUS_MESSAGE: "Teleport requests are now {status}.",
  MASTER_USAGE_MESSAGE: "Usage: !master <username>",
  BLACKLIST_USAGE_MESSAGE: "Usage: !bl <username>",
  RM_BLACKLIST_USAGE_MESSAGE: "Usage: !rmbl <username>",
  RM_MASTER_USAGE_MESSAGE: "Usage: !rm master <username>",
  ALREADY_MASTER_MESSAGE: "{player} is already a master.",
  MASTER_ADDED_MESSAGE: "{player} is now a master.",
  PRIMARY_MASTER_BLACKLIST_MESSAGE: "The primary master cannot be blacklisted.",
  ALREADY_BLACKLISTED_MESSAGE: "{player} is already blacklisted.",
  BLACKLISTED_MESSAGE: "{player} has been blacklisted.",
  NOT_SECONDARY_MASTER_MESSAGE: "{player} is not a secondary master.",
  MASTER_REMOVED_MESSAGE: "{player} is no longer a master.",
  NOT_BLACKLISTED_MESSAGE: "{player} is not blacklisted.",
  UNBLACKLISTED_MESSAGE: "{player} has been removed from the blacklist.",
  UNKNOWN_MASTER_COMMAND_MESSAGE: "Unknown master command.",
  STATUS_MESSAGE: "Online for {seconds} seconds.",
  PRIMARY_STOP_ONLY_MESSAGE:
    "{player}, only the primary master can stop the bot.",
  STOP_MESSAGE: "Stopping AFK bot.",
  COMMAND_HELP_GENERAL:
    "Commands: !status (uptime), !follow (follow you), !come [x y z] (come to you or coordinates).|Commands: !stopfollow (stop moving), !stop (stop bot; primary master only), !cmd (show commands).",
  COMMAND_HELP_MASTER:
    "Master: !master <name>, !rm master <name>, !bl <name>, !rmbl <name>.|Master: !public, !private, !tpa <on|off>, !y (accept request), !n (reject request).",
  GOAL_REACHED_MESSAGE: "I reached the coordinates.",
  FOLLOWING_MESSAGE: "Following {player}.",
  FOLLOW_TARGET_NOT_FOUND_MESSAGE:
    "I cannot see you, {player}. Try !come x y z for a one-time destination.",
  COMING_COORDINATES_MESSAGE: "Coming to {coordinates}.",
  COMING_PLAYER_MESSAGE: "Coming to {player}.",
  COME_TARGET_NOT_FOUND_MESSAGE:
    "I cannot see you, {player}. Send !come x y z with your coordinates.",
  NOT_FOLLOWING_MESSAGE: "{player}, I am not following anyone.",
  NAVIGATION_STOPPED_MESSAGE: "Stopped following and navigation.",
  NAVIGATION_TARGET_LEFT_MESSAGE:
    "{player} left the server, so navigation was stopped.",
};
const updateMode = process.argv.includes("--update");

if (
  updateMode &&
  !process.env.SETUP_UPDATE_DONE &&
  fs.existsSync(path.join(__dirname, ".git"))
) {
  const branch = spawnSync(
    "git",
    ["-C", __dirname, "branch", "--show-current"],
    { encoding: "utf8" },
  );
  const installedBranch = String(branch.stdout || "").trim();
  if (!installedBranch) {
    console.warn(
      "Update check skipped: the checkout is detached. Check out the branch used for installation first.",
    );
  } else {
    console.log(`Checking only origin/${installedBranch} for updates...`);
    const hidden = spawnSync("git", ["-C", __dirname, "ls-files", "-v"], {
      encoding: "utf8",
    });
    if (hidden.status === 0) {
      const hiddenFiles = hidden.stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .filter((line) => {
          const flag = line[0].toLowerCase();
          return flag === "h" || flag === "s";
        })
        .map((line) => line.slice(2));
      if (hiddenFiles.length > 0) {
        console.log(
          "Clearing hidden git index flags for files before updating...",
        );
        const clearHidden = spawnSync(
          "git",
          [
            "-C",
            __dirname,
            "update-index",
            "--no-skip-worktree",
            "--no-assume-unchanged",
            "--",
            ...hiddenFiles,
          ],
          { stdio: "inherit" },
        );
        if (clearHidden.status !== 0) {
          console.warn(
            "Failed to clear hidden git index flags; update may still fail.",
          );
        }
      }
    }
    let stashCreated = false;
    const stash = spawnSync(
      "git",
      [
        "-C",
        __dirname,
        "stash",
        "push",
        "--include-untracked",
        "-m",
        `setup-update-${Date.now()}`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const stashOutput = `${stash.stdout || ""}${stash.stderr || ""}`;
    if (
      stash.status === 0 &&
      !stashOutput.includes("No local changes to save")
    ) {
      stashCreated = true;
      console.log("Stashing local changes before updating...");
    } else if (stash.status !== 0) {
      console.warn(
        "Could not stash local changes before updating; continuing with the current local files.",
      );
    }
    const update = spawnSync(
      "git",
      ["-C", __dirname, "pull", "--ff-only", "origin", installedBranch],
      { stdio: "inherit" },
    );
    if (update.status === 0) {
      if (stashCreated) {
        console.log("Restoring stashed local changes after update...");
        const pop = spawnSync("git", ["-C", __dirname, "stash", "pop"], {
          stdio: "inherit",
        });
        if (pop.status !== 0) {
          console.warn(
            "Update completed, but stashed changes could not be reapplied automatically.",
          );
        }
      }
      execFileSync(process.execPath, [__filename, "--update"], {
        stdio: "inherit",
        env: { ...process.env, SETUP_UPDATE_DONE: "1" },
      });
      process.exit(0);
    }
    if (stashCreated) {
      console.log("Restoring stashed local changes after failed update...");
      const pop = spawnSync("git", ["-C", __dirname, "stash", "pop"], {
        stdio: "inherit",
      });
      if (pop.status !== 0) {
        console.warn(
          "Update failed and stashed changes could not be reapplied automatically. Resolve the stash manually with git stash list and git stash pop.",
        );
      }
    }
    if (update.error)
      console.warn(`Update check skipped: ${update.error.message}`);
    else
      console.warn(
        "Update not applied; continuing with the current local files.",
      );
  }
}

function migrateUserData() {
  // Releases before the installer fix placed the checkout in ./minecraft-afk-bot.
  // Keep the user's configuration when the checkout is moved to the launch folder.
  const dataFiles = [".env"];
  for (const file of dataFiles) {
    const currentFile = path.join(__dirname, file);
    const legacyFile = path.join(legacyDir, file);
    if (!fs.existsSync(currentFile) && fs.existsSync(legacyFile)) {
      fs.copyFileSync(legacyFile, currentFile);
      console.log(
        `Migrated the existing ${file} configuration from the previous install location.`,
      );
    }
  }
}
function ask(question, fallback = "") {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(
      `${question}${fallback ? ` [${fallback}]` : ""}: `,
      (answer) => {
        rl.close();
        resolve(answer.trim() || fallback);
      },
    ),
  );
}
function parseServerAddress(address) {
  const bracketed = address.match(/^\[([^\]]+)\](?::(\d+))?$/);
  const colon = address.lastIndexOf(":");
  const hasSingleColon = colon > 0 && address.indexOf(":") === colon;
  const host = bracketed
    ? bracketed[1]
    : hasSingleColon
      ? address.slice(0, colon)
      : address;
  const portText = bracketed
    ? bracketed[2]
    : hasSingleColon
      ? address.slice(colon + 1)
      : "";
  const port = portText ? Number(portText) : 25565;
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(
      "Server address must be a host with an optional port, for example localhost:25565.",
    );
  return { host, port };
}
function readEnvValues(envPath) {
  const values = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    try {
      values[key] = JSON.parse(rawValue);
    } catch {
      values[key] = rawValue;
    }
  }
  return values;
}
function setEnvValue(envPath, key, value) {
  const env = fs.readFileSync(envPath, "utf8");
  const line = new RegExp(`^${key}=.*$`, "m");
  const serialized = `${key}=${JSON.stringify(value)}`;
  fs.writeFileSync(
    envPath,
    line.test(env)
      ? env.replace(line, serialized)
      : `${env.replace(/\s*$/, "\n")}${serialized}\n`,
    "utf8",
  );
}
async function ensureMasterConfiguration(envPath) {
  const env = readEnvValues(envPath);
  if (!String(env.MASTER_USERNAME || "").trim()) {
    const primaryMaster = await ask("Primary master username");
    if (!/^[A-Za-z0-9_]{3,16}$/.test(primaryMaster))
      throw new Error(
        "Primary master username must be a valid Minecraft username.",
      );
    setEnvValue(envPath, "MASTER_USERNAME", primaryMaster);
  }
  if (env.MASTERS === undefined) setEnvValue(envPath, "MASTERS", "");
  if (env.MASTER_PROTECTED_MESSAGE === undefined)
    setEnvValue(
      envPath,
      "MASTER_PROTECTED_MESSAGE",
      defaultMasterProtectedMessage,
    );
  if (env.MASTER_JOIN_MESSAGE === undefined)
    setEnvValue(envPath, "MASTER_JOIN_MESSAGE", defaultMasterJoinMessage);
  if (env.MASTER_LEAVE_MESSAGE === undefined)
    setEnvValue(envPath, "MASTER_LEAVE_MESSAGE", defaultMasterLeaveMessage);
  if (env.TPA_REJECT_MESSAGE === undefined)
    setEnvValue(envPath, "TPA_REJECT_MESSAGE", defaultTpaRejectMessage);
  for (const [key, value] of Object.entries(replyDefaults)) {
    if (env[key] === undefined) setEnvValue(envPath, key, value);
  }
  if (env.ALLOW_OTHER_PLAYERS === undefined)
    setEnvValue(
      envPath,
      "ALLOW_OTHER_PLAYERS",
      (await ask("Allow non-masters to use the bot? (y/n)", "n"))
        .toLowerCase()
        .startsWith("y"),
    );
  if (env.TPA_ENABLED === undefined || env.TPAHERE_ENABLED === undefined) {
    const teleportEnabled = (
      await ask("Accept /tpa and /tpahere requests? (y/n)", "y")
    )
      .toLowerCase()
      .startsWith("y");
    setEnvValue(envPath, "TPA_ENABLED", teleportEnabled);
    setEnvValue(envPath, "TPAHERE_ENABLED", teleportEnabled);
  }
}
function startBot() {
  const bot = spawn(process.execPath, ["bot.js"], { stdio: "inherit" });
  bot.on("exit", (code) => process.exit(code ?? 0));
}
async function main() {
  console.log(
    `Minecraft AFK bot setup (${device})\nInstalling dependencies...`,
  );
  migrateUserData();
  const npmArgs = ["install", "--omit=dev", "--no-audit", "--no-fund"];
  const install =
    process.platform === "win32"
      ? spawnSync(
          process.env.ComSpec || "cmd.exe",
          ["/d", "/s", "/c", npm + " " + npmArgs.join(" ")],
          { stdio: "inherit" },
        )
      : spawnSync(npm, npmArgs, { stdio: "inherit" });
  if (install.error || install.status !== 0) {
    console.error(install.error?.message || "Dependency installation failed.");
    process.exit(1);
  }
  const envPath = path.join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    const fresh = updateMode
      ? false
      : (await ask("Existing installation found. Do a fresh setup? (y/n)", "n"))
          .toLowerCase()
          .startsWith("y");
    if (!fresh) {
      await ensureMasterConfiguration(envPath);
      console.log("Using the existing configuration. Starting the bot...");
      return startBot();
    }
  }
  const username = await ask("Bot name", "AFK_Bot");
  const server = parseServerAddress(
    await ask("Minecraft server address", "localhost:25565"),
  );
  const password = await ask(
    "Auth password (leave blank if no auth plugin)",
    "",
  );
  const movement = (await ask("Should the bot move periodically? (y/n)", "y"))
    .toLowerCase()
    .startsWith("y");
  const primaryMaster = await ask("Primary master username");
  if (!/^[A-Za-z0-9_]{3,16}$/.test(primaryMaster))
    throw new Error(
      "Primary master username must be a valid Minecraft username.",
    );
  const allowOtherPlayers = (
    await ask("Allow non-masters to use the bot? (y/n)", "n")
  )
    .toLowerCase()
    .startsWith("y");
  const teleportEnabled = (
    await ask("Accept /tpa and /tpahere requests? (y/n)", "y")
  )
    .toLowerCase()
    .startsWith("y");
  const quote = (value) => JSON.stringify(value);
  const env = [
    `MC_HOST=${quote(server.host)}`,
    `MC_PORT=${quote(server.port)}`,
    `MC_USERNAME=${quote(username)}`,
    'MC_AUTH="offline"',
    'MC_VERSION=""',
    `AUTH_PASSWORD=${quote(password)}`,
    `MOVE_ENABLED=${movement}`,
    'RECONNECT_MS="10000"',
    'MOVE_EVERY_MS="30000"',
    'LOG_LEVEL="info"',
    "FEATURE_AFK=true",
    "FEATURE_AUTHME=true",
    "FEATURE_NAVIGATION=true",
    "FEATURE_TPA=true",
    'COMMAND_PREFIX="!"',
    'BLACKLIST=""',
    `MASTER_USERNAME=${quote(primaryMaster)}`,
    'MASTERS=""',
    `MASTER_PROTECTED_MESSAGE=${quote(defaultMasterProtectedMessage)}`,
    `MASTER_JOIN_MESSAGE=${quote(defaultMasterJoinMessage)}`,
    `MASTER_LEAVE_MESSAGE=${quote(defaultMasterLeaveMessage)}`,
    `TPA_REJECT_MESSAGE=${quote(defaultTpaRejectMessage)}`,
    ...Object.entries(replyDefaults).map(
      ([key, value]) => `${key}=${quote(value)}`,
    ),
    `ALLOW_OTHER_PLAYERS=${allowOtherPlayers}`,
    `TPA_ENABLED=${teleportEnabled}`,
    `TPAHERE_ENABLED=${teleportEnabled}`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(__dirname, ".env"), env, "utf8");
  console.log("Configuration saved to .env. Starting the bot...");
  startBot();
}
main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

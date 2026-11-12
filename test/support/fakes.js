const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function createPosition(x = 0, y = 64, z = 0) {
  return {
    x,
    y,
    z,
    clone: () => createPosition(x, y, z),
    offset: (dx, dy, dz) => createPosition(x + dx, y + dy, z + dz),
    distanceTo: (other) => Math.hypot(x - other.x, y - other.y, z - other.z),
  };
}

const DEFAULT_PLAYERS = {
  Owner: { uuid: "uuid-owner" },
  Bob: { uuid: "uuid-bob" },
  VIP: { uuid: "uuid-vip" },
};

function createFakeBot({
  username = "AFK_Bot",
  version = "1.21.4",
  players = DEFAULT_PLAYERS,
  position = createPosition(),
} = {}) {
  const bot = new EventEmitter();
  bot.username = username;
  bot.version = version;
  bot.players = players;
  bot.health = 20;
  bot.food = 20;
  bot.time = { time: 0 };
  bot.entity = {
    position,
    yaw: 0,
    height: 1.8,
    isInWater: false,
    isInLava: false,
  };
  bot.sent = [];
  bot.controls = [];
  bot.chat = (text) => bot.sent.push(text);
  bot.quit = (reason) => {
    bot.quitReason = reason;
    process.nextTick(() => bot.emit("end", reason));
  };
  bot.loadPlugin = () => {};
  bot.clearControlStates = () => bot.controls.push("clear");
  bot.setControlState = (control, state) =>
    bot.controls.push(`${control}:${state}`);
  bot.swingArm = () => bot.controls.push("swing");
  bot.look = () => {
    bot.controls.push("look");
    return Promise.resolve();
  };
  bot.lookAt = () => Promise.resolve();
  bot.pathfinder = {
    goals: [],
    setGoal(goal, dynamic) {
      bot.pathfinder.goals.push({ goal, dynamic });
    },
    setMovements() {
      bot.pathfinder.movements = true;
    },
    thinkTimeout: 0,
  };
  bot.blockAt = () => ({ name: "stone", boundingBox: "block" });
  bot._client = new EventEmitter();
  return bot;
}

/** Emits a player-chat message the way mineflayer 4.x does. */
function emitChat(bot, text, { uuid, position = "chat" } = {}) {
  bot.emit("message", { toString: () => text }, position, uuid);
}

/** Emits a server line (system chat / game info). */
function emitServer(bot, text, position = "system") {
  bot.emit("messagestr", text, position);
}

function fakePathfinderModule() {
  class Movements {
    constructor(bot) {
      this.bot = bot;
    }
  }
  class GoalFollow {
    constructor(entity, range) {
      this.entity = entity;
      this.range = range;
    }
  }
  class GoalNear {
    constructor(x, y, z, range) {
      this.x = x;
      this.y = y;
      this.z = z;
      this.range = range;
    }
  }
  return { Movements, pathfinder: {}, goals: { GoalFollow, GoalNear } };
}

function memoryLogger() {
  const lines = [];
  const push = (level) => (category, message) =>
    lines.push({ level, category, message });
  return {
    lines,
    debug: push("debug"),
    info: push("info"),
    warn: push("warn"),
    error: push("error"),
    text: () =>
      lines.map((line) => `${line.level}: ${line.message}`).join("\n"),
  };
}

/** Creates a controller wired to a fake bot, with chat throttling disabled. */
function createController(overrides = {}) {
  const { start } = require("../../src/bot");
  const { loadConfig } = require("../../src/config/config");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "afk-bot-test-"));
  const envPath = path.join(tmpDir, ".env");
  fs.writeFileSync(envPath, 'MC_USERNAME="AFK_Bot"\n', "utf8");

  const env = {
    MC_HOST: "localhost",
    MC_PORT: "25565",
    MC_USERNAME: "AFK_Bot",
    MASTER_USERNAME: "Owner",
    CHAT_MIN_INTERVAL_MS: "0",
    RATE_LIMIT_COUNT: "100",
    FEATURE_AFK: "false",
    ...(overrides.env || {}),
  };
  const config = overrides.config || loadConfig(env);
  const logger = overrides.logger || memoryLogger();
  const bot = overrides.bot || createFakeBot();

  const controller = start({
    config,
    logger,
    envPath,
    createBot: () => bot,
    pathfinder: fakePathfinderModule,
    signals: false,
    guardProcess: false,
    skipValidation: true,
    onExit: () => {
      controller.exited = true;
    },
    ...(overrides.startOptions || {}),
  });

  // Emit spawn so the controller finishes wiring itself up.
  bot.emit("spawn");

  return { controller, bot, logger, config, envPath, tmpDir };
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

module.exports = {
  cleanup,
  createController,
  createFakeBot,
  createPosition,
  emitChat,
  emitServer,
  fakePathfinderModule,
  memoryLogger,
  DEFAULT_PLAYERS,
};

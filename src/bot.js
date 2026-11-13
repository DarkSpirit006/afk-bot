const os = require("node:os");
const path = require("node:path");
const nbt = require("prismarine-nbt");
const { loadConfig } = require("./config/config");
const { validateConfig } = require("./config/validation");
const { createLogger } = require("./utils/logger");
const {
  describeError,
  format,
  normalizeMessage,
  normalizeName,
} = require("./utils/helpers");
const { createRateLimit } = require("./utils/rate-limit");
const { createPermissions } = require("./permissions/permissions");
const {
  resolveSender,
  senderFromText,
  senderNameValue,
  teleportType,
} = require("./chat/format");
const { parseCommand } = require("./commands/parser");
const { COMMANDS_BY_NAME } = require("./commands/registry");
const { saveEnvValue } = require("./services/env-store");
const { createReconnect } = require("./services/reconnect");
const { createAfk } = require("./services/afk");
const { createChatQueue } = require("./services/chat-queue");
const { createTeleport } = require("./services/teleport");
const { createWatchdog } = require("./services/watchdog");
const { createHealthServer } = require("./services/health");
const { createAuthMe } = require("./auth/authme");
const { createDialogAuth } = require("./auth/dialogs");
const { installClientTick } = require("./services/client-tick");
const { createNavigation } = require("./navigation/navigation");

const SENDER_CACHE_LIMIT = 500;

function defaultCreateBot(options) {
  const mineflayer = require("mineflayer");
  return mineflayer.createBot(options);
}

function defaultPathfinder() {
  return require("mineflayer-pathfinder");
}

// Wires the bot together and returns a small controller. mineflayer, the
// pathfinder, env, the logger and the exit handler can be injected, which is how
// the tests drive the command path without a server.
function start(options = {}) {
  const env = options.env || process.env;
  const config = options.config || loadConfig(env);
  const now = options.now || Date.now;
  const onExit = options.onExit || ((code) => process.exit(code));
  const createBot = options.createBot || defaultCreateBot;
  const loadPathfinder = options.pathfinder || defaultPathfinder;
  const logger =
    options.logger ||
    createLogger({
      level: config.logLevel,
      filePath: config.logFile || undefined,
      secrets: [config.password],
    });

  const validation = options.skipValidation
    ? { errors: [], warnings: [] }
    : validateConfig(config);
  for (const warning of validation.warnings) logger.warn("CONFIG", warning);
  if (validation.errors.length) {
    for (const error of validation.errors) logger.error("CONFIG", error);
    return {
      failed: true,
      errors: validation.errors,
      stop() {},
      config,
      logger,
    };
  }

  const featureSummary =
    Object.entries(config.features)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name)
      .join(", ") || "none";
  const authModes =
    [
      config.features.authme ? "chat prompts" : undefined,
      config.features.authDialog ? "dialogs" : undefined,
    ]
      .filter(Boolean)
      .join(" + ") || "none";
  logger.info(
    "CONFIG",
    `Configuration loaded: ${config.host}:${config.port}, username ${config.username}, auth ${config.auth}.`,
  );
  logger.info(
    "CONFIG",
    `Features: ${featureSummary}. Authentication: ${authModes}.`,
  );

  const envPath = options.envPath || path.join(__dirname, "..", ".env");
  const startedAt = now();
  const permissions = createPermissions(config);
  const senderNames = new Map();
  const knownPlayers = new Set();
  const rateLimit = createRateLimit({
    limit: config.chat.rateLimit.limit,
    windowMs: config.chat.rateLimit.windowMs,
  });

  let bot;
  let stopping = false;
  let greetingsTimer;
  let kickReason;
  let origin;
  let greetingsReady = false;

  const getBot = () => bot;
  const message = (key, values) => format(config.messages[key], values);

  const chat = createChatQueue({
    minIntervalMs: config.chat.minIntervalMs,
    maxQueue: config.chat.maxQueue,
    logger,
    send: (text) => {
      if (!bot || typeof bot.chat !== "function") return;
      bot.chat(text);
    },
  });
  const reply = (text) => chat.push(text);

  const status = () => {
    const position = bot?.entity?.position;
    return {
      x: position ? Math.round(position.x) : 0,
      y: position ? Math.round(position.y) : 0,
      z: position ? Math.round(position.z) : 0,
      health: Math.round(bot?.health ?? 0),
      food: Math.round(bot?.food ?? 0),
      uptimeSeconds: Math.floor((now() - startedAt) / 1000),
      connected: Boolean(bot?.entity),
    };
  };

  const saveSetting = (key, value) => {
    try {
      saveEnvValue(envPath, key, value);
      logger.info("CONFIG", `${key} saved to .env.`);
    } catch (error) {
      logger.error("CONFIG", `Could not save ${key}: ${describeError(error)}`);
    }
  };

  const afk = createAfk({
    getBot,
    enabled: config.features.afk && config.afk.enabled,
    intervalMs: config.afk.intervalMs,
    style: config.afk.style,
    minHealth: config.afk.minHealth,
    wanderRadius: config.afk.wanderRadius,
    logger,
    getOrigin: () => origin,
  });

  const navigation = createNavigation({
    getBot,
    logger,
    pathfinder: loadPathfinder(),
    followRange: config.navigation.followRange,
    maxRecalculations: config.navigation.maxRecalculations,
    maxCoordinate: config.navigation.maxCoordinate,
    onActiveChange: (active) => {
      if (active) afk.stop();
      else afk.start();
    },
    onGiveUp: () => reply(message("NAVIGATION_GAVE_UP_MESSAGE")),
  });

  const auth = createAuthMe({
    getBot,
    password: config.password,
    maxAttempts: config.authMe.maxAttempts,
    retryMs: config.authMe.retryMs,
    logger,
  });

  const dialogs = createDialogAuth({
    getBot,
    getClient: () => bot?._client,
    password: config.password,
    email: config.authMe.email,
    totpSecret: config.authMe.totpSecret,
    maxAttempts: config.authMe.maxAttempts,
    retryMs: config.authMe.retryMs,
    enabled: config.features.authme && config.features.authDialog,
    logger,
    nbt,
    onSkipped: ({ description, reason }) =>
      logger.warn(
        "AUTH",
        `Skipped the ${description.kind} dialog (${reason}).`,
      ),
  });

  const teleport = createTeleport({
    getBot,
    logger,
    approvalMs: config.teleport.approvalMs,
    cooldownMs: config.teleport.cooldownMs,
    onEvent: (event) => {
      if (event.type === "expired")
        reply(
          message("TELEPORT_EXPIRED_MESSAGE", {
            player: event.request.sender,
            type: event.request.type,
          }),
        );
      else if (event.type === "rejected")
        reply(
          message("TELEPORT_REJECTED_MESSAGE", {
            player: event.request.sender,
            type: event.request.type,
          }),
        );
      else if (event.type === "missing")
        reply(message("TELEPORT_NONE_MESSAGE"));
    },
  });

  const reconnect = createReconnect({
    baseDelayMs: config.reconnect.baseMs,
    maxDelayMs: config.reconnect.maxMs,
    maxAttempts: config.reconnect.maxAttempts,
    jitter: config.reconnect.jitter,
    logger,
    connect: () => connect(),
    onGiveUp: (reason) =>
      logger.error(
        "RECONNECT",
        `${reason} Restart the bot after fixing the cause.`,
      ),
  });

  const watchdog = createWatchdog({
    getBot,
    timeoutMs: config.watchdogMs,
    logger,
    onStall: () => {
      try {
        bot?.quit?.("Connection watchdog");
      } catch (error) {
        logger.warn(
          "WATCHDOG",
          `Could not quit the stalled connection: ${describeError(error)}`,
        );
      }
    },
  });

  const health = createHealthServer({
    host: config.health.host,
    port: config.health.port,
    logger,
    getState: () => ({
      ...status(),
      username: config.username,
      server: `${config.host}:${config.port}`,
      reconnectAttempts: reconnect.attempts(),
      navigation: navigation.isActive(),
      pendingTeleports: teleport.size(),
      queuedMessages: chat.size(),
      pid: process.pid,
      host: os.hostname(),
    }),
  });

  const deny = (sender) => {
    reply(message("BLACKLIST_MESSAGE", { player: sender }));
    logger.warn("COMMAND", `Ignored blacklisted player ${sender}.`);
  };

  function shutdown(reason = "AFK bot shutting down") {
    if (stopping) return;
    stopping = true;
    logger.info("CONNECTION", "Shutting down.");
    reconnect.cancel();
    afk.stop();
    navigation.stop();
    teleport.stop();
    watchdog.stop();
    if (greetingsTimer) clearTimeout(greetingsTimer);

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      chat.stop();
      health.stop();
      onExit(0);
    };

    if (bot && typeof bot.quit === "function") {
      bot.once?.("end", finish);
      try {
        bot.quit(reason);
      } catch (error) {
        logger.warn("CONNECTION", `Quit failed: ${describeError(error)}`);
      }
      setTimeout(finish, 2000).unref?.();
    } else {
      finish();
    }
  }

  const commandContext = {
    config,
    logger,
    permissions,
    navigation,
    teleport,
    reply,
    status,
    saveSetting,
    shutdown,
    masters: () => config.masters,
    blacklist: () => config.blacklist,
    setAllowOtherPlayers: (value) => {
      config.allowOtherPlayers = value;
    },
    setTpaEnabled: (value) => {
      config.tpaEnabled = value;
    },
    setTpahereEnabled: (value) => {
      config.tpahereEnabled = value;
    },
  };

  /** Dispatches one chat line from a known player. Exported for tests. */
  function handleChatLine(sender, text) {
    if (!sender) return;
    const self = bot?.username;
    if (self && normalizeName(sender) === normalizeName(self)) return;

    const command = parseCommand(text, config.commandPrefix, sender);
    if (!command) return;
    const definition = COMMANDS_BY_NAME.get(command.name);
    if (!definition) return;

    if (permissions.isBlacklisted(sender)) return deny(sender);

    if (!rateLimit.allow(normalizeName(sender))) {
      logger.warn("COMMAND", `Rate limited ${sender}.`);
      return reply(message("RATE_LIMITED_MESSAGE", { player: sender }));
    }

    const isMaster = permissions.isMaster(sender);
    const isPrimary = permissions.isPrimaryMaster(sender);
    if (definition.access === "primary" && !isPrimary)
      return reply(message("MASTER_ONLY_MESSAGE", { player: sender }));
    if (
      definition.access === "master" &&
      !isMaster &&
      !(definition.publicAllowed && config.allowOtherPlayers)
    )
      return reply(message("MASTER_ONLY_MESSAGE", { player: sender }));

    if (definition.navigation && !config.features.navigation) {
      logger.warn(
        "NAVIGATION",
        "Ignored a navigation command because FEATURE_NAVIGATION is disabled.",
      );
      return reply(message("NAVIGATION_DISABLED_MESSAGE"));
    }

    logger.info(
      "COMMAND",
      `${config.commandPrefix}${command.name} from ${sender}.`,
    );
    try {
      definition.run(commandContext, command.args, sender);
    } catch (error) {
      logger.error(
        "COMMAND",
        `${config.commandPrefix}${command.name} failed: ${describeError(error)}`,
      );
    }
  }

  function handleTeleportRequest(sender, type) {
    if (permissions.isBlacklisted(sender)) return deny(sender);
    const enabled = type === "tpa" ? config.tpaEnabled : config.tpahereEnabled;
    const autoAccept =
      permissions.isMaster(sender) || (config.allowOtherPlayers && enabled);

    if (autoAccept) {
      const result = teleport.acceptNow(sender, type);
      if (result.status === "cooldown")
        return reply(message("TELEPORT_COOLDOWN_MESSAGE", { player: sender }));
      return reply(
        message("TELEPORT_AUTO_ACCEPT_MESSAGE", { player: sender, type }),
      );
    }

    const result = teleport.request(sender, type);
    if (result.status === "cooldown")
      return reply(message("TELEPORT_COOLDOWN_MESSAGE", { player: sender }));
    if (result.status === "full")
      return reply(message("TELEPORT_QUEUE_FULL_MESSAGE", { player: sender }));
    if (result.status === "pending")
      return reply(
        message("TELEPORT_APPROVAL_MESSAGE", {
          player: sender,
          type,
          id: result.request.id,
        }),
      );
    return undefined;
  }

  function rememberSender(uuid, name) {
    if (senderNames.size >= SENDER_CACHE_LIMIT) {
      const oldest = senderNames.keys().next();
      if (!oldest.done) senderNames.delete(oldest.value);
    }
    senderNames.set(uuid, name);
  }

  function onSpawn() {
    reconnect.reset();
    auth.reset();
    dialogs.reset();
    navigation.setup();
    knownPlayers.clear();
    for (const name of Object.keys(bot.players || {}))
      knownPlayers.add(normalizeName(name));
    origin = bot.entity?.position?.clone?.() ?? undefined;
    afk.resetOrigin(origin);
    watchdog.start();
    if (config.features.afk && config.afk.enabled) afk.start(origin);

    if (greetingsTimer) clearTimeout(greetingsTimer);
    greetingsTimer = setTimeout(() => {
      greetingsTimer = undefined;
      greetingsReady = true;
    }, 5000);

    logger.info(
      "CONNECTION",
      `Connected${bot.version ? ` (${bot.version})` : ""} as ${config.username}.`,
    );
  }

  function bindBotEvents(instance) {
    instance.once?.("spawn", onSpawn);

    instance.on("playerJoined", (player) => {
      const name = typeof player === "string" ? player : player?.username;
      if (!name) return;
      knownPlayers.add(normalizeName(name));
      if (greetingsReady && permissions.isPrimaryMaster(name)) {
        reply(message("MASTER_JOIN_MESSAGE", { player: name }));
        logger.info("CONNECTION", `Primary master joined: ${name}.`);
      }
    });

    instance.on("playerLeft", (player) => {
      const name = typeof player === "string" ? player : player?.username;
      if (!name) return;
      knownPlayers.delete(normalizeName(name));
      if (navigation.handlePlayerLeft(name))
        reply(message("NAVIGATION_TARGET_LEFT_MESSAGE", { player: name }));
      if (permissions.isPrimaryMaster(name))
        logger.info("CONNECTION", `Primary master left: ${name}.`);
    });

    instance.on("respawn", () => {
      navigation.stop();
      navigation.setup();
      logger.info(
        "CONNECTION",
        "Respawned or changed dimension; navigation reset for the new world.",
      );
    });

    instance.on("path_update", (result) => {
      if (["noPath", "timeout"].includes(result?.status))
        navigation.recalculate();
    });

    instance.on("goal_reached", () => {
      if (navigation.goalReached()) {
        logger.info("NAVIGATION", "Goal reached.");
        reply(message("GOAL_REACHED_MESSAGE"));
      }
    });

    instance.on("death", () =>
      logger.warn("CONNECTION", "The bot died; respawning."),
    );

    instance._client?.on?.("playerChat", (data) => {
      const uuid = String(data.sender || "").toLowerCase();
      const name = senderNameValue(data.senderName);
      if (uuid && name) rememberSender(uuid, name);
    });

    // Player chat: the only path that can run commands. The sender comes from
    // the packet UUID, never from guesswork over the message text.
    instance.on("message", (jsonMessage, position, senderUuid) => {
      watchdog.touch();
      if (position !== "chat") return;
      const text = normalizeMessage(jsonMessage?.toString?.() ?? jsonMessage);
      const sender = resolveSender({
        players: instance.players,
        uuid: senderUuid,
        text,
        cache: senderNames,
        self: instance.username,
      });
      if (!sender) {
        logger.debug(
          "CHAT",
          "Ignored a chat line because the sender could not be identified.",
        );
        return;
      }
      handleChatLine(sender, text);
    });

    // Server output: AuthMe prompts and teleport requests. Player chat is
    // explicitly excluded so a chat message can never drive authentication.
    instance.on("messagestr", (raw, position) => {
      watchdog.touch();
      if (position === "chat") return;
      const text = normalizeMessage(raw);
      if (config.features.authme && !dialogs.isBusy()) auth.inspect(text);

      const type = config.features.tpa && teleportType(text);
      if (!type) return;
      const sender = senderFromText(text, instance.players);
      if (
        !sender ||
        normalizeName(sender) === normalizeName(instance.username)
      ) {
        logger.debug(
          "TPA",
          "Ignored a teleport request from an unknown player.",
        );
        return;
      }
      handleTeleportRequest(sender, type);
    });

    instance.on("kicked", (reason) => {
      kickReason =
        typeof reason === "string" ? reason : JSON.stringify(reason ?? "");
      logger.warn("CONNECTION", `Kicked: ${kickReason}`);
    });

    instance.on("error", (error) =>
      logger.error("CONNECTION", describeError(error)),
    );

    instance.once("end", () => {
      navigation.stop();
      afk.stop();
      watchdog.stop();
      teleport.stop();
      if (stopping) {
        logger.info("CONNECTION", "Disconnected.");
        return;
      }
      logger.warn("CONNECTION", "Disconnected.");
      reconnect.schedule(kickReason);
      kickReason = undefined;
    });
  }

  function connect() {
    if (stopping) return undefined;
    logger.info(
      "CONNECTION",
      `Connecting to ${config.host}:${config.port} as ${config.username}.`,
    );
    let instance;
    try {
      instance = createBot({
        host: config.host,
        port: config.port,
        username: config.username,
        auth: config.auth,
        ...(config.version ? { version: config.version } : {}),
        ...(options.botOptions || {}),
      });
    } catch (error) {
      logger.error(
        "CONNECTION",
        `Could not create the bot: ${describeError(error)}`,
      );
      reconnect.schedule();
      return undefined;
    }
    bot = instance;
    if (typeof instance.loadPlugin === "function") {
      try {
        instance.loadPlugin(loadPathfinder().pathfinder);
      } catch (error) {
        logger.error(
          "NAVIGATION",
          `Could not load the pathfinder plugin: ${describeError(error)}`,
        );
      }
    }
    dialogs.attach(instance._client);
    installClientTick({ client: instance._client, version: config.version || instance.version, logger });
    bindBotEvents(instance);
    return instance;
  }

  if (options.signals !== false) {
    const handleSignal = () => {
      if (stopping) {
        logger.warn("CONNECTION", "Forced exit.");
        onExit(1);
        return;
      }
      shutdown("Signal received");
    };
    process.on("SIGINT", handleSignal);
    process.on("SIGTERM", handleSignal);
  }

  if (options.guardProcess !== false) {
    process.on("unhandledRejection", (reason) =>
      logger.error("PROCESS", `Unhandled rejection: ${describeError(reason)}`),
    );
    process.on("uncaughtException", (error) =>
      logger.error("PROCESS", `Uncaught exception: ${describeError(error)}`),
    );
  }

  health.start();
  connect();

  return {
    failed: false,
    config,
    logger,
    connect,
    shutdown,
    handleChatLine,
    reply,
    status,
    getBot: () => bot,
    getState: () => status(),
    services: {
      afk,
      navigation,
      auth,
      teleport,
      reconnect,
      watchdog,
      health,
      chat,
    },
  };
}

module.exports = { start };

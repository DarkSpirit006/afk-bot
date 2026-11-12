const { USERNAME, format, normalizeName } = require("../utils/helpers");

// The command table. Parsing, access checks and the !cmd help are all built from
// these entries.
//   access        "everyone" | "master" | "primary"
//   publicAllowed non-masters may use it while ALLOW_OTHER_PLAYERS is on
//   navigation    needs FEATURE_NAVIGATION
//   hidden        left out of !cmd (the !y / !n replies)

function usage(ctx, key, values = {}) {
  return ctx.reply(format(ctx.config.messages[key], values));
}

function handleMaster(ctx, name, args) {
  const target = name === "rm" ? args[1] : args[0];

  if (name === "public" || name === "private") {
    const isPublic = name === "public";
    ctx.setAllowOtherPlayers(isPublic);
    if (!isPublic) {
      ctx.setTpaEnabled(false);
      ctx.setTpahereEnabled(false);
      ctx.saveSetting("TPA_ENABLED", false);
      ctx.saveSetting("TPAHERE_ENABLED", false);
    }
    ctx.saveSetting("ALLOW_OTHER_PLAYERS", isPublic);
    return usage(
      ctx,
      isPublic ? "PUBLIC_ACCESS_MESSAGE" : "PRIVATE_ACCESS_MESSAGE",
    );
  }

  if (name === "tpa") {
    const value = String(target ?? "").toLowerCase();
    const enabled = ["on", "true", "enable", "enabled"].includes(value);
    const disabled = ["off", "false", "disable", "disabled"].includes(value);
    if (!enabled && !disabled) return usage(ctx, "TPA_USAGE_MESSAGE");
    ctx.setTpaEnabled(enabled);
    ctx.setTpahereEnabled(enabled);
    ctx.saveSetting("TPA_ENABLED", enabled);
    ctx.saveSetting("TPAHERE_ENABLED", enabled);
    return usage(ctx, "TPA_STATUS_MESSAGE", {
      status: enabled ? "enabled" : "disabled",
    });
  }

  if (!USERNAME.test(String(target ?? ""))) {
    const usageKey = {
      master: "MASTER_USAGE_MESSAGE",
      bl: "BLACKLIST_USAGE_MESSAGE",
      rmbl: "RM_BLACKLIST_USAGE_MESSAGE",
      rm: "RM_MASTER_USAGE_MESSAGE",
    }[name];
    return usage(ctx, usageKey);
  }

  const key = normalizeName(target);

  if (name === "master") {
    if (ctx.permissions.isMaster(target))
      return usage(ctx, "ALREADY_MASTER_MESSAGE", { player: target });
    ctx.masters().add(key);
    ctx.saveSetting("MASTERS", [...ctx.masters()].join(","));
    return usage(ctx, "MASTER_ADDED_MESSAGE", { player: target });
  }

  if (name === "bl") {
    if (ctx.permissions.isPrimaryMaster(target))
      return usage(ctx, "PRIMARY_MASTER_BLACKLIST_MESSAGE");
    if (ctx.blacklist().has(key))
      return usage(ctx, "ALREADY_BLACKLISTED_MESSAGE", { player: target });
    ctx.blacklist().add(key);
    ctx.saveSetting("BLACKLIST", [...ctx.blacklist()].join(","));
    return usage(ctx, "BLACKLISTED_MESSAGE", { player: target });
  }

  if (name === "rm" && String(args[0] ?? "").toLowerCase() !== "master")
    return usage(ctx, "RM_MASTER_USAGE_MESSAGE");

  if (name === "rm") {
    if (ctx.permissions.isPrimaryMaster(target))
      return usage(ctx, "MASTER_PROTECTED_MESSAGE", {
        player: target,
        master: ctx.config.primaryMaster,
      });
    if (!ctx.masters().delete(key))
      return usage(ctx, "NOT_SECONDARY_MASTER_MESSAGE", { player: target });
    ctx.saveSetting("MASTERS", [...ctx.masters()].join(","));
    return usage(ctx, "MASTER_REMOVED_MESSAGE", { player: target });
  }

  if (!ctx.blacklist().delete(key))
    return usage(ctx, "NOT_BLACKLISTED_MESSAGE", { player: target });
  ctx.saveSetting("BLACKLIST", [...ctx.blacklist()].join(","));
  return usage(ctx, "UNBLACKLISTED_MESSAGE", { player: target });
}

const COMMANDS = [
  {
    name: "status",
    access: "everyone",
    help: "!status - uptime, position, health",
    run: (ctx) => {
      const status = ctx.status();
      return usage(ctx, "STATUS_MESSAGE", {
        ...status,
        seconds: status.uptimeSeconds,
      });
    },
  },
  {
    name: "pos",
    access: "everyone",
    help: "!pos - current coordinates",
    run: (ctx) => usage(ctx, "POS_MESSAGE", ctx.status()),
  },
  {
    name: "health",
    access: "everyone",
    help: "!health - health and food",
    run: (ctx) => usage(ctx, "HEALTH_MESSAGE", ctx.status()),
  },
  {
    name: "cmd",
    access: "everyone",
    help: "!cmd - show this help",
    run: (ctx, _args, sender) => {
      const lines = COMMANDS.filter((command) => !command.hidden)
        .filter(
          (command) =>
            command.access === "everyone" ||
            (command.access === "master" && ctx.permissions.isMaster(sender)) ||
            (command.access === "primary" &&
              ctx.permissions.isPrimaryMaster(sender)),
        )
        .map((command) => command.help);
      for (let index = 0; index < lines.length; index += 3)
        ctx.reply(lines.slice(index, index + 3).join(" | "));
    },
  },
  {
    name: "follow",
    access: "master",
    publicAllowed: true,
    navigation: true,
    help: "!follow - follow the player who asked",
    run: (ctx, _args, sender) =>
      ctx.navigation.follow(sender)
        ? usage(ctx, "FOLLOWING_MESSAGE", { player: sender })
        : usage(ctx, "FOLLOW_TARGET_NOT_FOUND_MESSAGE", { player: sender }),
  },
  {
    name: "come",
    access: "master",
    publicAllowed: true,
    navigation: true,
    help: "!come [x y z] - come to you or to coordinates",
    run: (ctx, args, sender) => {
      const result = ctx.navigation.come(sender, args);
      if (result.status === "invalid")
        return usage(ctx, "COME_COORDINATES_INVALID_MESSAGE", {
          player: sender,
        });
      if (result.status === "notFound")
        return usage(ctx, "COME_TARGET_NOT_FOUND_MESSAGE", { player: sender });
      if (result.status === "coordinates")
        return usage(ctx, "COMING_COORDINATES_MESSAGE", {
          coordinates: result.coordinates.join(" "),
        });
      return usage(ctx, "COMING_PLAYER_MESSAGE", { player: sender });
    },
  },
  {
    name: "stopfollow",
    access: "master",
    publicAllowed: true,
    navigation: true,
    help: "!stopfollow - stop moving",
    run: (ctx, _args, sender) => {
      if (!ctx.navigation.isActive())
        return usage(ctx, "NOT_FOLLOWING_MESSAGE", { player: sender });
      ctx.navigation.stop();
      return usage(ctx, "NAVIGATION_STOPPED_MESSAGE");
    },
  },
  {
    name: "say",
    access: "primary",
    help: "!say <text> - make the bot speak",
    run: (ctx, args) => {
      const text = args.join(" ").trim();
      if (!text) return usage(ctx, "SAY_USAGE_MESSAGE");
      ctx.logger.info("COMMAND", "Sending a message requested by the master.");
      return ctx.reply(text);
    },
  },
  {
    name: "stop",
    access: "primary",
    help: "!stop - stop the bot (primary master only)",
    run: (ctx, _args, sender) => {
      if (!ctx.permissions.isPrimaryMaster(sender))
        return usage(ctx, "PRIMARY_STOP_ONLY_MESSAGE", { player: sender });
      ctx.reply(ctx.config.messages.STOP_MESSAGE);
      ctx.shutdown();
    },
  },
  {
    name: "master",
    access: "master",
    help: "!master <name> - add a secondary master",
    run: (ctx, args) => handleMaster(ctx, "master", args),
  },
  {
    name: "rm",
    access: "master",
    help: "!rm master <name> - remove a secondary master",
    run: (ctx, args) => handleMaster(ctx, "rm", args),
  },
  {
    name: "bl",
    access: "master",
    help: "!bl <name> - blacklist a player",
    run: (ctx, args) => handleMaster(ctx, "bl", args),
  },
  {
    name: "rmbl",
    access: "master",
    help: "!rmbl <name> - unblacklist a player",
    run: (ctx, args) => handleMaster(ctx, "rmbl", args),
  },
  {
    name: "public",
    access: "master",
    help: "!public - allow non-masters to navigate",
    run: (ctx) => handleMaster(ctx, "public", []),
  },
  {
    name: "private",
    access: "master",
    help: "!private - master-only access",
    run: (ctx) => handleMaster(ctx, "private", []),
  },
  {
    name: "tpa",
    access: "master",
    help: "!tpa <on|off> - auto-accept teleports",
    run: (ctx, args) => handleMaster(ctx, "tpa", args),
  },
  {
    name: "y",
    access: "master",
    hidden: true,
    help: "!y [id] - accept a teleport request",
    run: (ctx, args) => ctx.teleport.reply(true, args[0]),
  },
  {
    name: "n",
    access: "master",
    hidden: true,
    help: "!n [id] - reject a teleport request",
    run: (ctx, args) => ctx.teleport.reply(false, args[0]),
  },
];

const COMMAND_NAMES = COMMANDS.map((command) => command.name);
const COMMANDS_BY_NAME = new Map(
  COMMANDS.map((command) => [command.name, command]),
);

module.exports = { COMMANDS, COMMANDS_BY_NAME, COMMAND_NAMES, handleMaster };

const { describeError, normalizeName } = require("../utils/helpers");

const HAZARD_BLOCKS = new Set([
  "lava",
  "fire",
  "cactus",
  "magma_block",
  "campfire",
  "soul_campfire",
  "sweet_berry_bush",
  "powder_snow",
]);

// Idle movement. "look" turns the head and swings an arm, which most anti-AFK
// plugins accept and cannot walk the bot into lava. "walk" taps forward, but only
// when the bot is healthy, on solid ground, out of liquids and near spawn.
function createAfk({
  getBot,
  intervalMs = 30000,
  style = "look",
  minHealth = 8,
  wanderRadius = 16,
  enabled = true,
  logger,
  random = Math.random,
  getOrigin,
}) {
  let timer;
  let releaseTimer;
  let origin;

  const clearTimers = () => {
    if (timer !== undefined) clearInterval(timer);
    if (releaseTimer !== undefined) clearTimeout(releaseTimer);
    timer = undefined;
    releaseTimer = undefined;
  };

  const hazardAt = (bot) => {
    const entity = bot?.entity;
    if (!entity?.position) return "no position";
    if (Number.isFinite(bot.health) && bot.health < minHealth)
      return `health ${bot.health}`;
    if (entity.isInLava) return "in lava";
    if (entity.isInWater) return "in water";
    if (typeof bot.blockAt !== "function") return "";
    const below = bot.blockAt(entity.position.offset(0, -1, 0));
    if (!below) return "";
    if (HAZARD_BLOCKS.has(normalizeName(below.name))) return below.name;
    if (below.boundingBox === "empty") return "no ground";
    return "";
  };

  const tick = () => {
    const bot = getBot();
    if (!bot?.entity) return;

    const hazard = hazardAt(bot);
    if (hazard) {
      logger?.debug("AFK", `Skipping movement (${hazard}).`);
      bot.clearControlStates?.();
      return;
    }

    if (style === "walk") {
      const point = origin ?? getOrigin?.();
      if (point && bot.entity.position.distanceTo(point) > wanderRadius) {
        logger?.debug("AFK", "Skipping movement (outside the wander radius).");
        bot.clearControlStates?.();
        return;
      }
      if (releaseTimer !== undefined) clearTimeout(releaseTimer);
      Promise.resolve(
        bot.look(bot.entity.yaw + (random() - 0.5) * 1.2, 0, true),
      ).catch((error) =>
        logger?.debug("AFK", `Look failed: ${describeError(error)}`),
      );
      bot.setControlState("forward", true);
      bot.setControlState("sprint", random() > 0.6);
      if (random() > 0.7) bot.setControlState("jump", true);
      releaseTimer = setTimeout(
        () => {
          releaseTimer = undefined;
          bot?.clearControlStates?.();
        },
        1600 + Math.floor(random() * 1000),
      );
      return;
    }

    Promise.resolve(
      bot.look(bot.entity.yaw + (random() - 0.5) * 0.8, 0, true),
    ).catch((error) =>
      logger?.debug("AFK", `Look failed: ${describeError(error)}`),
    );
    if (random() > 0.5) {
      try {
        bot.swingArm?.("right");
      } catch (error) {
        logger?.debug("AFK", `Swing failed: ${describeError(error)}`);
      }
    }
  };

  return {
    start(nextOrigin) {
      if (!enabled || timer !== undefined) return false;
      origin = nextOrigin ?? origin ?? getOrigin?.();
      timer = setInterval(tick, intervalMs);
      logger?.info(
        "AFK",
        `Idle movement enabled (${style}, every ${Math.round(intervalMs / 1000)}s).`,
      );
      return true;
    },
    stop() {
      clearTimers();
      getBot()?.clearControlStates?.();
    },
    resetOrigin(nextOrigin) {
      origin = nextOrigin;
    },
    /** Runs one tick immediately; used by tests. */
    runOnce: () => tick(),
    style: () => style,
  };
}

module.exports = { createAfk, HAZARD_BLOCKS };

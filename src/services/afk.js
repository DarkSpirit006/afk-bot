function createAfk({ getBot, intervalMs, logger }) {
  let timer;
  let releaseTimer;
  const stop = () => {
    clearInterval(timer);
    clearTimeout(releaseTimer);
    timer = undefined;
    getBot()?.clearControlStates();
  };
  const start = () => {
    if (timer) return;
    timer = setInterval(() => {
      const bot = getBot();
      if (!bot?.entity) return;
      bot
        .look(bot.entity.yaw + (Math.random() - 0.5) * 1.2, 0, true)
        .catch((error) => logger.debug("AFK", `Look failed: ${error.message}`));
      bot.setControlState("forward", true);
      bot.setControlState("sprint", Math.random() > 0.4);
      if (Math.random() > 0.7) bot.setControlState("jump", true);
      releaseTimer = setTimeout(
        () => bot?.clearControlStates(),
        1600 + Math.floor(Math.random() * 1000),
      );
    }, intervalMs);
    logger.info("AFK", "Movement enabled.");
  };
  return { start, stop };
}
module.exports = { createAfk };

// Thin wrapper around mineflayer-pathfinder. The module is passed in so this can
// be tested without loading mineflayer.
function createNavigation({
  getBot,
  pathfinder,
  logger,
  followRange = 2,
  maxRecalculations = 5,
  maxCoordinate = 30000000,
  onActiveChange,
  onGiveUp,
  now = Date.now,
}) {
  const { Movements, goals } = pathfinder;
  const { GoalFollow, GoalNear } = goals;

  let active = false;
  let destination = false;
  let currentGoal;
  let targetPlayer;
  let lookTimer;
  let watchdogTimer;
  let lastPosition;
  let lastProgressAt = 0;
  let lastRecalculate = Number.NEGATIVE_INFINITY;
  let recalculations = 0;

  const setActive = (value) => {
    if (active === value) return;
    active = value;
    onActiveChange?.(value);
  };

  function clearTimers() {
    clearInterval(lookTimer);
    clearInterval(watchdogTimer);
    lookTimer = undefined;
    watchdogTimer = undefined;
    lastPosition = undefined;
  }

  /** Parses `!come` arguments into a coordinate result. */
  function parseCoordinates(args = []) {
    if (!args.length) return { status: "none" };
    const numeric = args.slice(0, 3).map(Number);
    const looksNumeric = numeric.some((value) => Number.isFinite(value));
    // "!come Bob" is a player name; "!come 10 64" is an incomplete coordinate.
    if (!looksNumeric) return { status: "none" };
    if (args.length < 3) return { status: "invalid" };
    const values = args.slice(0, 3).map(Number);
    const [x, y, z] = values;
    const inRange =
      values.every(
        (value) => Number.isFinite(value) && Number.isInteger(value),
      ) &&
      Math.abs(x) <= maxCoordinate &&
      Math.abs(z) <= maxCoordinate &&
      Math.abs(y) <= 2048;
    if (!inRange) return { status: "invalid" };
    return { status: "coordinates", coordinates: [x, y, z] };
  }

  function startWatchdog() {
    clearInterval(watchdogTimer);
    lastPosition = undefined;
    lastProgressAt = now();
    watchdogTimer = setInterval(() => {
      const bot = getBot();
      if (!active || !currentGoal || !bot?.entity) return;
      const position = bot.entity.position;
      const unchanged =
        lastPosition && position.distanceTo(lastPosition) < 0.15;
      if (!unchanged) {
        lastPosition = position.clone();
        lastProgressAt = now();
        return;
      }
      const goalPosition =
        currentGoal instanceof GoalNear
          ? { x: currentGoal.x, y: currentGoal.y, z: currentGoal.z }
          : currentGoal.entity?.position;
      const stillFarAway =
        goalPosition &&
        position.distanceTo(goalPosition) >
          (currentGoal instanceof GoalNear ? currentGoal.range + 1.5 : 3);
      if (stillFarAway && now() - lastProgressAt > 8000) {
        logger?.warn(
          "NAVIGATION",
          "Pathfinding appears stuck; recalculating the current goal.",
        );
        bot.pathfinder.setGoal(null);
        bot.pathfinder.setGoal(currentGoal, currentGoal instanceof GoalFollow);
        lastProgressAt = now();
      }
    }, 2000);
    if (typeof watchdogTimer.unref === "function") watchdogTimer.unref();
  }

  function startFollowLook(entity) {
    clearInterval(lookTimer);
    lookTimer = setInterval(() => {
      const bot = getBot();
      if (!active || !entity?.position || !bot?.entity) return;
      const head = entity.position.offset(
        0,
        Math.max(1, (entity.height || 1.8) * 0.85),
        0,
      );
      Promise.resolve(bot.lookAt(head, true)).catch((error) =>
        logger?.debug("NAVIGATION", `Look-at failed: ${error.message}`),
      );
    }, 350);
    if (typeof lookTimer.unref === "function") lookTimer.unref();
  }

  function setup() {
    const bot = getBot();
    if (!bot?.pathfinder) return false;
    const movements = new Movements(bot);
    movements.allowSprinting = true;
    movements.allowParkour = true;
    movements.canDig = false;
    movements.canOpenDoors = true;
    movements.canOpenTrapdoors = true;
    movements.maxDropDown = 2;
    bot.pathfinder.setMovements(movements);
    bot.pathfinder.thinkTimeout = 10000;
    return true;
  }

  function cancelCurrentGoal() {
    const bot = getBot();
    if (active)
      logger?.info("NAVIGATION", "Cancelling the previous navigation goal.");
    bot?.pathfinder?.setGoal(null);
    currentGoal = undefined;
    targetPlayer = undefined;
    recalculations = 0;
    clearTimers();
  }

  function follow(player) {
    const bot = getBot();
    const entity = bot?.players?.[player]?.entity;
    if (!entity || !bot?.pathfinder) return false;
    cancelCurrentGoal();
    destination = false;
    targetPlayer = String(player).toLowerCase();
    setActive(true);
    currentGoal = new GoalFollow(entity, followRange);
    bot.pathfinder.setGoal(currentGoal, true);
    startFollowLook(entity);
    startWatchdog();
    logger?.info("NAVIGATION", `Following ${player}.`);
    return true;
  }

  /** Returns { status: "coordinates" | "player" | "invalid" | "notFound" }. */
  function come(player, args = []) {
    const bot = getBot();
    if (!bot?.pathfinder) return { status: "notFound" };
    const parsed = parseCoordinates(args);
    if (parsed.status === "invalid") return { status: "invalid" };

    const position =
      parsed.status === "coordinates"
        ? {
            x: parsed.coordinates[0],
            y: parsed.coordinates[1],
            z: parsed.coordinates[2],
          }
        : bot.players?.[player]?.entity?.position;
    if (!position) return { status: "notFound" };

    cancelCurrentGoal();
    destination = true;
    targetPlayer =
      parsed.status === "coordinates"
        ? undefined
        : String(player).toLowerCase();
    setActive(true);
    currentGoal = new GoalNear(position.x, position.y, position.z, 2);
    bot.pathfinder.setGoal(currentGoal);
    startWatchdog();
    return parsed.status === "coordinates"
      ? { status: "coordinates", coordinates: parsed.coordinates }
      : { status: "player" };
  }

  function stop() {
    destination = false;
    setActive(false);
    getBot()?.pathfinder?.setGoal(null);
    currentGoal = undefined;
    targetPlayer = undefined;
    recalculations = 0;
    clearTimers();
  }

  function goalReached() {
    if (!destination) return false;
    destination = false;
    setActive(false);
    currentGoal = undefined;
    targetPlayer = undefined;
    clearTimers();
    return true;
  }

  function handlePlayerLeft(player) {
    if (!active || String(player).toLowerCase() !== targetPlayer) return false;
    logger?.info(
      "NAVIGATION",
      `${player} left; cancelling their navigation goal.`,
    );
    stop();
    return true;
  }

  function recalculate() {
    const bot = getBot();
    if (
      !active ||
      !currentGoal ||
      !bot?.pathfinder ||
      now() - lastRecalculate < 4000
    )
      return;
    recalculations += 1;
    if (recalculations > maxRecalculations) {
      logger?.warn(
        "NAVIGATION",
        `Giving up after ${maxRecalculations} failed path recalculations.`,
      );
      stop();
      onGiveUp?.();
      return;
    }
    lastRecalculate = now();
    const goal = currentGoal;
    logger?.warn(
      "NAVIGATION",
      `Recalculating a path after a navigation failure (${recalculations}/${maxRecalculations}).`,
    );
    bot.pathfinder.setGoal(null);
    bot.pathfinder.setGoal(goal, goal instanceof GoalFollow);
    lastProgressAt = now();
  }

  return {
    setup,
    follow,
    come,
    stop,
    goalReached,
    handlePlayerLeft,
    recalculate,
    parseCoordinates,
    isActive: () => active,
    target: () => targetPlayer,
  };
}

module.exports = { createNavigation };

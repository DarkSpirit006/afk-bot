const { Movements, goals } = require("mineflayer-pathfinder");
const { GoalFollow, GoalNear } = goals;
function createNavigation({ getBot, onActiveChange, logger }) {
  let active = false; let destination = false; let currentGoal; let targetPlayer; let lookTimer; let watchdogTimer; let lastPosition; let lastProgressAt = 0; let lastRecalculate = 0;
  const setActive = (value) => { active = value; onActiveChange(value); };
  function clearTimers() { clearInterval(lookTimer); clearInterval(watchdogTimer); lookTimer = undefined; watchdogTimer = undefined; lastPosition = undefined; }
  function startWatchdog() {
    clearInterval(watchdogTimer); lastPosition = undefined; lastProgressAt = Date.now();
    watchdogTimer = setInterval(() => {
      const bot = getBot(); if (!active || !currentGoal || !bot?.entity) return;
      const position = bot.entity.position; const unchanged = lastPosition && position.distanceTo(lastPosition) < 0.15;
      if (!unchanged) { lastPosition = position.clone(); lastProgressAt = Date.now(); return; }
      const goalPosition = currentGoal instanceof GoalNear ? { x: currentGoal.x, y: currentGoal.y, z: currentGoal.z } : currentGoal.entity?.position;
      const stillFarAway = goalPosition && position.distanceTo(goalPosition) > (currentGoal instanceof GoalNear ? currentGoal.range + 1.5 : 3);
      if (stillFarAway && Date.now() - lastProgressAt > 8000) {
        logger.warn("NAVIGATION", "Pathfinding appears stuck; recalculating the current goal.");
        bot.pathfinder.setGoal(null); bot.pathfinder.setGoal(currentGoal, currentGoal instanceof GoalFollow);
        lastProgressAt = Date.now();
      }
    }, 2000);
  }
  function startFollowLook(entity) {
    clearInterval(lookTimer);
    lookTimer = setInterval(() => {
      const bot = getBot(); if (!active || !entity?.position || !bot?.entity) return;
      const head = entity.position.offset(0, Math.max(1, (entity.height || 1.8) * 0.85), 0);
      Promise.resolve(bot.lookAt(head, true)).catch(error => logger.debug("NAVIGATION", `Look-at failed: ${error.message}`));
    }, 350);
  }
  function setup() { const bot = getBot(); const movements = new Movements(bot); movements.allowSprinting = true; movements.allowParkour = true; movements.canDig = false; movements.canOpenDoors = true; movements.canOpenTrapdoors = true; movements.maxDropDown = 2; bot.pathfinder.setMovements(movements); bot.pathfinder.thinkTimeout = 10000; }
  function cancelCurrentGoal() { const bot = getBot(); if (active) logger.info("NAVIGATION", "Cancelling the previous navigation goal."); bot?.pathfinder.setGoal(null); currentGoal = undefined; targetPlayer = undefined; clearTimers(); }
  function follow(player) { const entity = getBot().players[player]?.entity; if (!entity) return false; cancelCurrentGoal(); destination = false; targetPlayer = String(player).toLowerCase(); setActive(true); currentGoal = new GoalFollow(entity, 2); getBot().pathfinder.setGoal(currentGoal, true); startFollowLook(entity); startWatchdog(); logger.info("NAVIGATION", `Following ${player}.`); return true; }
  function come(player, coordinates) { const bot = getBot(); const values = coordinates.slice(0, 3).map(Number); const coordinateGoal = values.length === 3 && values.every(Number.isFinite); const position = coordinateGoal ? { x: values[0], y: values[1], z: values[2] } : bot.players[player]?.entity?.position; if (!position) return false; cancelCurrentGoal(); destination = true; targetPlayer = coordinateGoal ? undefined : String(player).toLowerCase(); setActive(true); currentGoal = new GoalNear(position.x, position.y, position.z, 1); bot.pathfinder.setGoal(currentGoal); startWatchdog(); return true; }
  function stop() { destination = false; setActive(false); getBot()?.pathfinder.setGoal(null); currentGoal = undefined; targetPlayer = undefined; clearTimers(); }
  function goalReached() { if (!destination) return false; destination = false; setActive(false); currentGoal = undefined; targetPlayer = undefined; clearTimers(); return true; }
  function handlePlayerLeft(player) { if (!active || String(player).toLowerCase() !== targetPlayer) return false; logger.info("NAVIGATION", `${player} left; cancelling their navigation goal.`); stop(); return true; }
  function recalculate() { const bot = getBot(); if (!active || !currentGoal || !bot?.pathfinder || Date.now() - lastRecalculate < 4000) return; lastRecalculate = Date.now(); const goal = currentGoal; logger.warn("NAVIGATION", "Recalculating a path after a navigation failure."); bot.pathfinder.setGoal(null); bot.pathfinder.setGoal(goal, goal instanceof GoalFollow); lastProgressAt = Date.now(); }
  return { setup, follow, come, stop, goalReached, handlePlayerLeft, recalculate, isActive: () => active };
}
module.exports = { createNavigation };

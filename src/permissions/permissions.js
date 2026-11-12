const { normalizeName } = require("../utils/helpers");

function createPermissions(config) {
  const isPrimaryMaster = (player) =>
    normalizeName(player) === normalizeName(config.primaryMaster);

  const isMaster = (player) =>
    isPrimaryMaster(player) || config.masters.has(normalizeName(player));

  return {
    isPrimaryMaster,
    isMaster,
    isBlacklisted: (player) => config.blacklist.has(normalizeName(player)),
    isPublic: () => config.allowOtherPlayers,
    canUseBot: (player) => config.allowOtherPlayers || isMaster(player),
    masters: () => [...config.masters],
    blacklisted: () => [...config.blacklist],
  };
}

module.exports = { createPermissions };

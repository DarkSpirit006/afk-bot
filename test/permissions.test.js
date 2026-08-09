const test = require("node:test");
const assert = require("node:assert/strict");
const { createPermissions } = require("../src/permissions/permissions");
test("permissions are case insensitive and blacklist stays separate", () => {
  const permissions = createPermissions({ primaryMaster: "Owner", masters: new Set(["helper"]), blacklist: new Set(["blocked"]), allowOtherPlayers: false });
  assert.equal(permissions.isMaster("OWNER"), true); assert.equal(permissions.isMaster("Helper"), true); assert.equal(permissions.canUseBot("Guest"), false); assert.equal(permissions.isBlacklisted("BLOCKED"), true);
});

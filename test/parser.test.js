const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCommand } = require("../src/commands/parser");
test("command parser accepts a configured prefix and uses the latest command", () => {
  assert.deepEqual(parseCommand("<Owner> !come 10 64 -20", "!"), {
    name: "come",
    index: 8,
    args: ["10", "64", "-20"],
  });
  assert.equal(parseCommand("!unknown", "!"), undefined);
  assert.equal(parseCommand("!statusx", "!"), undefined);
  assert.equal(
    parseCommand("Server help: use !follow or !come", "!"),
    undefined,
  );
  assert.deepEqual(parseCommand("Owner !status", "!", "Owner"), {
    name: "status",
    index: 6,
    args: [],
  });
});

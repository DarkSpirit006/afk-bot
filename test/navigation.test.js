const test = require("node:test");
const assert = require("node:assert/strict");
const { createNavigation } = require("../src/navigation/navigation");
const {
  createFakeBot,
  createPosition,
  fakePathfinderModule,
} = require("./support/fakes");

function setup(options = {}) {
  const bot = options.bot || createFakeBot();
  const events = [];
  let clock = 0;
  const navigation = createNavigation({
    getBot: () => bot,
    pathfinder: fakePathfinderModule(),
    logger: { info() {}, warn() {}, debug() {} },
    followRange: 2,
    maxRecalculations: 2,
    maxCoordinate: 30000000,
    onActiveChange: (active) => events.push({ active }),
    onGiveUp: () => events.push({ gaveUp: true }),
    now: () => clock,
    ...options,
  });
  return {
    navigation,
    bot,
    events,
    advance: (ms) => {
      clock += ms;
    },
  };
}

test("coordinates are parsed strictly", () => {
  const { navigation } = setup();
  assert.deepEqual(navigation.parseCoordinates([]), { status: "none" });
  assert.deepEqual(navigation.parseCoordinates(["10"]), { status: "invalid" });
  assert.deepEqual(navigation.parseCoordinates(["1.5", "2", "3"]), {
    status: "invalid",
  });
  assert.deepEqual(navigation.parseCoordinates(["1e9", "64", "1"]), {
    status: "invalid",
  });
  assert.deepEqual(navigation.parseCoordinates(["1", "5000", "3"]), {
    status: "invalid",
  });
  assert.deepEqual(navigation.parseCoordinates(["10", "64", "-20"]), {
    status: "coordinates",
    coordinates: [10, 64, -20],
  });
});

test("come accepts coordinates without needing the player", () => {
  const { navigation, bot } = setup();
  bot.players = {};
  const result = navigation.come("Bob", ["10", "64", "-20"]);
  assert.equal(result.status, "coordinates");
  assert.equal(navigation.isActive(), true);
  const goals = bot.pathfinder.goals.filter((entry) => entry.goal !== null);
  assert.equal(goals.length, 1);
  navigation.stop();
});

test("come follows a visible player and reports a missing one", () => {
  const bot = createFakeBot();
  bot.players = {
    Bob: { uuid: "uuid-bob", entity: { position: createPosition(5, 64, 5) } },
  };
  const { navigation } = setup({ bot });
  assert.equal(navigation.come("Bob", []).status, "player");
  navigation.stop();
  assert.equal(navigation.come("Ghost", []).status, "notFound");
});

test("follow needs an entity and ends on completion", () => {
  const bot = createFakeBot();
  bot.players = {
    Bob: {
      uuid: "uuid-bob",
      entity: { position: createPosition(1, 64, 1), height: 1.8 },
    },
  };
  const { navigation, events } = setup({ bot });
  assert.equal(navigation.follow("Bob"), true);
  assert.equal(events.at(-1).active, true);
  assert.equal(
    navigation.goalReached(),
    false,
    "following a player has no single destination",
  );
  navigation.stop();
  assert.equal(navigation.isActive(), false);
  assert.equal(navigation.follow("Ghost"), false);
});

test("navigation gives up after too many failed recalculations", () => {
  const bot = createFakeBot();
  const { navigation, events, advance } = setup({ bot });
  navigation.come("Bob", ["0", "64", "0"]);
  navigation.recalculate();
  advance(5000);
  navigation.recalculate();
  advance(5000);
  navigation.recalculate();
  assert.equal(events.at(-1).gaveUp, true);
  assert.equal(navigation.isActive(), false);
});

test("a player leaving cancels their goal", () => {
  const bot = createFakeBot();
  bot.players = {
    Bob: {
      uuid: "uuid-bob",
      entity: { position: createPosition(1, 64, 1), height: 1.8 },
    },
  };
  const { navigation } = setup({ bot });
  navigation.follow("Bob");
  assert.equal(navigation.handlePlayerLeft("Bob"), true);
  assert.equal(navigation.isActive(), false);
  assert.equal(navigation.handlePlayerLeft("Alice"), false);
});

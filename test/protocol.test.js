// dialog packets on the wire, plus two end-to-end runs against a real server

const assert = require("node:assert/strict");
const fixtures = require("./support/dialogs");
const fs = require("node:fs");
const mc = require("minecraft-protocol");
const mcData = require("minecraft-data");
const nbt = require("prismarine-nbt");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  createSerializer,
  createDeserializer,
} = require("minecraft-protocol/src/transforms/serializer");
const { describeDialog } = require("../src/auth/dialogs");
const { encodeClickAction, packetId } = require("../src/auth/click-action");
const { loadConfig } = require("../src/config/config");
const { memoryLogger } = require("./support/fakes");
const { start } = require("../src/bot");

/**
 * Contract tests for the packets the AuthMe dialog flow relies on. They encode
 * and decode real wire bytes with minecraft-protocol instead of trusting our
 * own reading of the protocol documentation.
 */
const VERSION = "1.21.6";
const toClient = (state) =>
  createSerializer({ state, isServer: true, version: VERSION });
const fromServer = (state) =>
  createDeserializer({ state, isServer: false, version: VERSION });

function hasPacket(version, state, direction, name) {
  const data = mcData(version);
  return Object.values(
    data.protocol[state][direction].types.packet[1][0].type[1].mappings,
  ).includes(name);
}

test("the dialog packets exist from 1.21.6 onwards only", () => {
  assert.equal(
    hasPacket("1.21.6", "configuration", "toClient", "show_dialog"),
    true,
  );
  assert.equal(
    hasPacket("1.21.6", "configuration", "toServer", "custom_click_action"),
    true,
  );
  assert.equal(hasPacket("1.21.6", "play", "toClient", "show_dialog"), true);
  assert.equal(
    hasPacket("1.21.6", "play", "toServer", "custom_click_action"),
    true,
  );
  // Older clients cannot be shown a dialog at all, which is why AuthMe falls
  // back to chat prompts for them.
  assert.equal(hasPacket("1.21.4", "play", "toClient", "show_dialog"), false);
});

test("pre-join dialog decodes into the expected shape", () => {
  const bytes = toClient("configuration").createPacketBuffer({
    name: "show_dialog",
    params: { dialog: fixtures.PRE_JOIN_LOGIN() },
  });
  const decoded = fromServer("configuration").parsePacketBuffer(bytes);
  assert.equal(decoded.data.name, "show_dialog");

  const description = describeDialog(decoded.data.params.dialog, nbt);
  assert.equal(description.kind, "login");
  assert.equal(description.submitId, "authme:prejoin-login/submit");
  assert.equal(description.cancelId, "authme:prejoin-login/cancel");
  assert.deepEqual(description.inputKeys, ["password"]);
});

test("a post-join dialog decodes through its registry holder", () => {
  const bytes = fixtures.showDialogPayload("play", fixtures.POST_JOIN_LOGIN());
  const decoded = fromServer("play").parsePacketBuffer(bytes);
  const holder = decoded.data.params.dialog;
  assert.ok(holder.data, "the inline dialog arrives inside a registry holder");
  const description = describeDialog(holder, nbt);
  assert.equal(description.kind, "login");
  assert.equal(description.commandTemplate, "login $(password)");
});

test("a post-join dialog sent by registry id is ignored", () => {
  const description = describeDialog({ dialog: 4 }, nbt);
  assert.equal(description.kind, "unknown");
});

test("the answer the bot writes has the payload as length-prefixed NBT", () => {
  const bytes = encodeClickAction({
    state: "configuration",
    version: VERSION,
    id: "authme:prejoin-login/submit",
    values: { password: "hunter2" },
  });

  // Packet id 0x08 in the configuration state, then the action id, then the
  // byte count of the payload, then the NBT itself.
  assert.equal(bytes[0], 0x08);
  const decoded = fixtures.decodeClickAction(bytes);
  assert.equal(decoded.id, "authme:prejoin-login/submit");
  assert.equal(decoded.payloadSize, 22);
  assert.deepEqual(decoded.values, { password: "hunter2" });
  assert.equal(decoded.rest.length, 0, "nothing follows the payload");

  // Golden bytes, so a change to the layout shows up as a diff rather than as a
  // decode error from a server.
  assert.equal(
    bytes.toString("hex"),
    "081b617574686d653a7072656a6f696e2d6c6f67696e2f7375626d6974" +
      "160a08000870617373776f7264000768756e7465723200",
  );
});

test("the packet id comes from the protocol data, not a guess", () => {
  assert.equal(packetId("configuration", "1.21.6"), 0x08);
  assert.equal(packetId("configuration", "1.21.11"), 0x08);
  assert.equal(packetId("play", VERSION), 65);
  assert.throws(() => packetId("status", VERSION), /No custom_click_action/);
});

test("an answer with no fields still carries an empty compound", () => {
  const decoded = fixtures.decodeClickAction(
    encodeClickAction({
      state: "configuration",
      version: VERSION,
      id: "authme:prejoin-login/cancel",
      values: {},
    }),
  );
  assert.equal(decoded.id, "authme:prejoin-login/cancel");
  assert.deepEqual(decoded.values, {});
});

/**
 * End-to-end check: a real minecraft-protocol server, a real mineflayer client,
 * and the real bot wiring. The server shows the AuthMe pre-join dialog during
 * the configuration phase and the bot has to answer it before it may join.
 */
function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Starts a throwaway protocol server, retrying if another test grabbed the port
 * between the probe and the bind.
 */
async function startServer() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const port = await freePort();
    try {
      const server = mc.createServer({
        "online-mode": false,
        version: "1.21.6",
        port,
        motd: "afk-bot test server",
      });
      await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
      });
      return { server, port };
    } catch {
      // try another port
    }
  }
  throw new Error("Could not start the test server on a free port.");
}

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      ).unref(),
    ),
  ]);

test("the bot answers the pre-join AuthMe dialog end to end", async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  let answered;
  const response = new Promise((resolve) => (answered = resolve));

  server.on("login", (client) => {
    client.write("success", {
      uuid: "12345678-1234-1234-1234-123456789012",
      username: client.username,
      properties: [],
    });
    client.on("state", (state) => {
      if (state !== "configuration") return;
      client.write("show_dialog", { dialog: fixtures.PRE_JOIN_LOGIN() });
    });
    // The library cannot decode this packet, so the frame is read off the
    // socket: the splitter emits a compression marker followed by the body.
    client.on("error", () => {});
    client.splitter.on("data", (frame) => {
      if (frame[0] !== 0) return; // uncompressed at this size
      const body = frame.slice(1);
      if (body[0] !== 0x08) return; // not a click action
      answered(fixtures.decodeClickAction(body));
    });
  });
  server.on("error", () => {});

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "afk-bot-e2e-"));
  const envPath = path.join(tmpDir, ".env");
  fs.writeFileSync(envPath, 'MC_USERNAME="AFK_Bot"\n', "utf8");
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const logger = memoryLogger();
  const controller = start({
    config: loadConfig({
      MC_HOST: "127.0.0.1",
      MC_PORT: String(port),
      MC_USERNAME: "AFK_Bot",
      MASTER_USERNAME: "Owner",
      MC_VERSION: "1.21.6",
      AUTH_PASSWORD: "hunter2",
      FEATURE_AFK: "false",
      CHAT_MIN_INTERVAL_MS: "0",
      WATCHDOG_MS: "0",
    }),
    logger,
    envPath,
    signals: false,
    guardProcess: false,
    skipValidation: true,
    onExit: () => {},
  });
  t.after(() => controller.shutdown());

  const packet = await withTimeout(response, 15000, "the dialog answer");
  assert.equal(packet.id, "authme:prejoin-login/submit");
  assert.deepEqual(packet.values, { password: "hunter2" });

  const log = logger.text();
  assert.match(log, /Answered the login dialog \(attempt 1\/3\)/);
  assert.equal(
    log.includes("hunter2"),
    false,
    "the password never reaches the log",
  );
});

test("a post-join dialog turns into a login command", async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  let answered;
  const response = new Promise((resolve) => (answered = resolve));

  server.on("login", (client) => {
    client.write("success", {
      uuid: "12345678-1234-1234-1234-123456789012",
      username: client.username,
      properties: [],
    });
    client.on("state", (state) => {
      if (state !== "play") return;
      client.writeRaw(fixtures.showDialogPayload("play", fixtures.POST_JOIN_LOGIN()));
    });
    client.on("chat_command", (packet) => answered(packet));
  });
  server.on("error", () => {});

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "afk-bot-e2e-"));
  const envPath = path.join(tmpDir, ".env");
  fs.writeFileSync(envPath, 'MC_USERNAME="AFK_Bot"\n', "utf8");
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const controller = start({
    config: loadConfig({
      MC_HOST: "127.0.0.1",
      MC_PORT: String(port),
      MC_USERNAME: "AFK_Bot",
      MASTER_USERNAME: "Owner",
      MC_VERSION: "1.21.6",
      AUTH_PASSWORD: "hunter2",
      FEATURE_AFK: "false",
      CHAT_MIN_INTERVAL_MS: "0",
      WATCHDOG_MS: "0",
    }),
    logger: memoryLogger(),
    envPath,
    signals: false,
    guardProcess: false,
    skipValidation: true,
    onExit: () => {},
  });
  t.after(() => controller.shutdown());

  const packet = await withTimeout(response, 15000, "the login command");
  assert.equal(packet.command, "login hunter2");
});

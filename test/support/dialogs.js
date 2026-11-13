const { createSerializer } = require("minecraft-protocol/src/transforms/serializer");
const nbt = require("prismarine-nbt");

// Dialog NBT shaped like the packets AuthMe sends through Paper: a multi_action
// dialog with text inputs and either dynamic/custom buttons (pre-join) or
// dynamic/run_command templates (post-join).
const T = (value) => nbt.string(value);
const compound = (fields) => ({ type: "compound", value: fields });
const text = (value) => compound({ text: T(value) });
const compoundList = (items) => ({
  type: "list",
  value: { type: "compound", value: items },
});

function buildDialog({
  title = "Login",
  body = "Please log in to continue",
  inputs = ["password"],
  submitId,
  template,
  extraActions = [],
  afterAction = "wait_for_response",
} = {}) {
  const actions = [];
  if (submitId)
    actions.push({
      label: text("Submit"),
      action: compound({
        type: T("minecraft:dynamic/custom"),
        id: T(submitId),
      }),
    });
  if (template)
    actions.push({
      label: text("Submit"),
      action: compound({
        type: T("minecraft:dynamic/run_command"),
        template: T(template),
      }),
    });
  for (const extra of extraActions) actions.push(extra);

  return nbt.comp({
    title: text(title),
    can_close_with_escape: nbt.byte(1),
    after_action: T(afterAction),
    body: compound({
      type: T("minecraft:plain_message"),
      contents: text(body),
    }),
    inputs: compoundList(
      inputs.map((key) => ({
        type: T("minecraft:text"),
        key: T(key),
        width: nbt.int(200),
        max_length: nbt.int(100),
        label_visible: nbt.byte(1),
      })),
    ),
    type: compound({
      type: T("minecraft:multi_action"),
      columns: nbt.int(2),
      actions: compoundList(actions),
    }),
  });
}

const customAction = (id, label = "Button") => ({
  label: text(label),
  action: compound({ type: T("minecraft:dynamic/custom"), id: T(id) }),
});

const PRE_JOIN_LOGIN = () =>
  buildDialog({
    title: "Login",
    inputs: ["password"],
    submitId: "authme:prejoin-login/submit",
    extraActions: [
      customAction("authme:prejoin-login/recovery", "Forgot password"),
      customAction("authme:prejoin-login/cancel", "Cancel"),
    ],
  });

const PRE_JOIN_REGISTER = (inputs = ["password", "confirm"]) =>
  buildDialog({
    title: "Register",
    inputs,
    submitId: "authme:prejoin-register/submit",
    extraActions: [customAction("authme:prejoin-register/cancel", "Cancel")],
  });

const PRE_JOIN_RECOVERY = () =>
  buildDialog({
    title: "Recover your account",
    inputs: ["email"],
    submitId: "authme:prejoin-recovery/submit",
    extraActions: [customAction("authme:prejoin-recovery/cancel", "Cancel")],
  });

const POST_JOIN_LOGIN = () =>
  buildDialog({
    title: "Login",
    inputs: ["password"],
    template: "login $(password)",
    afterAction: "close",
  });

const POST_JOIN_REGISTER = () =>
  buildDialog({
    title: "Register",
    inputs: ["password", "confirm"],
    template: "register $(password) $(confirm)",
    afterAction: "close",
  });

const POST_JOIN_TOTP = () =>
  buildDialog({
    title: "Two-factor authentication",
    inputs: ["code"],
    template: "2fa code $(code)",
    afterAction: "close",
  });

// minecraft-protocol leaves a garbage byte where the inline registry holder's
// leading zero varint should go, so a play-state dialog it encodes is not what
// a real server sends. This patches that byte and returns the packet body,
// which is what writeRaw expects (it adds the length itself).
const DIALOG_PACKET_ID = { configuration: 0x12, play: 0x85 };
const VERSION = "1.21.6";

const varintLength = (value) => {
  let bytes = 1;
  let rest = value;
  while (rest > 0x7f) {
    rest >>>= 7;
    bytes += 1;
  }
  return bytes;
};

function showDialogPayload(state, dialog) {
  const serializer = createSerializer({
    state,
    isServer: true,
    version: VERSION,
  });
  const params = state === "play" ? { dialog: { data: dialog } } : { dialog };
  const payload = Buffer.from(
    serializer.createPacketBuffer({ name: "show_dialog", params }),
  );
  if (state === "play") payload[varintLength(DIALOG_PACKET_ID[state])] = 0;
  return payload;
}

// Reads back a click action the bot wrote, for tests that check the bytes.
function readVarInt(buffer, offset) {
  let value = 0;
  let size = 0;
  for (;;) {
    const byte = buffer[offset + size];
    if (byte === undefined) throw new Error("truncated varint");
    size += 1;
    value |= (byte & 0x7f) << (7 * (size - 1));
    if ((byte & 0x80) === 0) return { value: value >>> 0, size };
  }
}

function decodeClickAction(buffer) {
  let offset = 0;
  const id = readVarInt(buffer, offset);
  offset += id.size;
  const name = readVarInt(buffer, offset);
  offset += name.size;
  const text = buffer.slice(offset, offset + name.value).toString("utf8");
  offset += name.value;
  const length = readVarInt(buffer, offset);
  offset += length.size;
  const payload = buffer.slice(offset, offset + length.value);
  const tag = payload.length
    ? nbt.proto.read(payload, 0, "anonymousNbt")
    : undefined;
  return {
    packetId: id.value,
    id: text,
    payloadSize: length.value,
    values: tag ? nbt.simplify(tag.value) : undefined,
    rest: buffer.slice(offset + length.value),
  };
}

const NOTICE_DIALOG = () =>
  buildDialog({
    title: "Welcome",
    body: "Please read the rules",
    inputs: [],
    extraActions: [customAction("authme:prejoin-login/cancel", "Close")],
  });

module.exports = {
  NOTICE_DIALOG,
  POST_JOIN_LOGIN,
  POST_JOIN_REGISTER,
  POST_JOIN_TOTP,
  PRE_JOIN_LOGIN,
  PRE_JOIN_RECOVERY,
  PRE_JOIN_REGISTER,
  buildDialog,
  customAction,
  decodeClickAction,
  showDialogPayload,
};

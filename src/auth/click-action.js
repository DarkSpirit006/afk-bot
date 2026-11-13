// Serverbound custom_click_action, the packet a dialog button sends back.
//
// minecraft-data describes the payload as an optional tag, which is wrong: the
// payload is a VarInt byte count followed by raw NBT. A server kicks the bot
// with "Failed to decode packet" when the recorded shape is used, so the bytes
// are put together here instead of through the serializer.

const nbt = require("prismarine-nbt");
const minecraftData = require("minecraft-data");
const { types } = require("protodef");

const writeVarInt = types.varint[1];
const sizeOfVarInt = types.varint[2];

// Only used when minecraft-data has nothing for the version the client picked.
const FALLBACK_ID = { configuration: 0x08, play: 0x44 };

function varint(value) {
  const buffer = Buffer.alloc(sizeOfVarInt(value));
  writeVarInt(value, buffer, 0);
  return buffer;
}

function string(value) {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([varint(bytes.length), bytes]);
}

// Network NBT: the tag id and body, without the root name.
function anonymousNbt(values) {
  const tag = nbt.comp(
    Object.fromEntries(
      Object.entries(values ?? {}).map(([key, value]) => [
        key,
        nbt.string(String(value)),
      ]),
    ),
  );
  const buffer = Buffer.alloc(nbt.proto.sizeOf(tag, "anonymousNbt"));
  nbt.proto.write(tag, buffer, 0, "anonymousNbt");
  return buffer;
}

function packetId(state, version) {
  try {
    const mappings =
      minecraftData(version).protocol[state].toServer.types.packet[1][0].type[1]
        .mappings;
    for (const [id, name] of Object.entries(mappings))
      if (name === "custom_click_action") return Number(id);
  } catch {
    // Unknown version: fall through to the defaults.
  }
  const fallback = FALLBACK_ID[state];
  if (fallback === undefined)
    throw new Error(`No custom_click_action packet in the ${state} state.`);
  return fallback;
}

/** The whole packet body, ready for client.writeRaw. */
function encodeClickAction({ state, version, id, values }) {
  const payload = anonymousNbt(values);
  return Buffer.concat([
    varint(packetId(state, version)),
    string(id),
    varint(payload.length),
    payload,
  ]);
}

module.exports = { encodeClickAction, packetId };

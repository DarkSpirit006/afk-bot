const {
  USERNAME,
  normalizeMessage,
  normalizeName,
} = require("../utils/helpers");

/** Finds the player name that belongs to a packet sender UUID. */
function nameForUuid(players, uuid, cache) {
  const key = String(uuid || "").toLowerCase();
  if (!key) return "";
  for (const [name, player] of Object.entries(players || {}))
    if (String(player?.uuid || "").toLowerCase() === key) return name;
  return cache?.get(key) || "";
}

// Author from the message text, anchored at the start. Matching anywhere in the
// line picks up rank tags ("[VIP] Bob:" reads as VIP talking), so anything
// ambiguous returns "".
function parseChatAuthor(text) {
  const clean = normalizeMessage(text);
  if (!clean) return "";

  const angle = clean.match(/^<([A-Za-z0-9_]{1,16})>/);
  if (angle && USERNAME.test(angle[1])) return angle[1];

  // Drop leading "[Rank]" / "『Rank』" style decorations, then require an
  // explicit "Name <separator>" prefix.
  const withoutTags = clean.replace(/^(?:\[[^\]]{0,40}\]\s*)+/, "");
  const prefixed = withoutTags.match(
    /^([A-Za-z0-9_]{3,16})\s*(?::|>|»|→|->|\bwhispers?\b|\bsays\b)/i,
  );
  if (prefixed && USERNAME.test(prefixed[1])) return prefixed[1];

  return "";
}

// Requester of a teleport line ("Bob has requested to teleport to you"). Only
// used there, where the name comes from the server itself.
function senderFromText(text, players) {
  const clean = normalizeMessage(text).replace(/^(?:\[[^\]]{0,40}\]\s*)+/, "");
  const anchored = clean.match(/^([A-Za-z0-9_]{3,16})\b/);
  if (anchored && isKnownPlayer(players, anchored[1])) return anchored[1];

  const mentions = Object.keys(players || {}).filter((name) =>
    new RegExp(`(^|[^A-Za-z0-9_])${name}([^A-Za-z0-9_]|$)`, "i").test(clean),
  );
  return mentions.length === 1 ? mentions[0] : "";
}

/** True when the name is currently visible to the bot (case-insensitive). */
function isKnownPlayer(players, name) {
  const key = normalizeName(name);
  if (!key) return false;
  return Object.keys(players || {}).some(
    (playerName) => normalizeName(playerName) === key,
  );
}

// Who sent this? Try the packet uuid first, then an anchored name that belongs to
// a player we can see. No match means no command.
function resolveSender({ players, uuid, text, cache, self }) {
  const byUuid = nameForUuid(players, uuid, cache);
  if (byUuid && normalizeName(byUuid) !== normalizeName(self)) return byUuid;

  const parsed = parseChatAuthor(text);
  if (!parsed) return "";
  if (normalizeName(parsed) === normalizeName(self)) return "";
  if (isKnownPlayer(players, parsed)) return parsed;
  return "";
}

/** Extracts a readable name from a mineflayer senderName / chat JSON value. */
function senderNameValue(value) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  if (typeof value.text === "string" && value.text.trim())
    return value.text.trim();
  if (typeof value.name === "string" && value.name.trim())
    return value.name.trim();
  if (Array.isArray(value.extra))
    return value.extra.map(senderNameValue).find(Boolean) || "";
  return "";
}

/** Classifies a server line as a tpa or tpahere request, if it is one. */
function teleportType(text) {
  const clean = normalizeMessage(text);
  if (!clean) return undefined;
  if (
    /(?:^|\s)\/?tpahere(?:\s|$)/i.test(clean) ||
    /requested? (?:that you )?teleport(?:ed)? to (?:them|him|her)/i.test(
      clean,
    ) ||
    /requested? you (?:to )?teleport to (?:them|him|her)/i.test(clean)
  )
    return "tpahere";
  if (
    /(?:^|\s)\/?tpa(?:\s|$)/i.test(clean) ||
    /(?:requested?|wants?)\b.*\bteleport\b/i.test(clean)
  )
    return "tpa";
  return undefined;
}

module.exports = {
  isKnownPlayer,
  nameForUuid,
  parseChatAuthor,
  resolveSender,
  senderFromText,
  senderNameValue,
  teleportType,
};

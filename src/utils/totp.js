const crypto = require("node:crypto");

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Decodes an RFC 4648 base32 secret (padding and spacing tolerated). */
function decodeBase32(input) {
  const clean = String(input || "")
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const character of clean) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) throw new Error("TOTP secret is not valid base32.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (!bytes.length) throw new Error("TOTP secret is empty.");
  return Buffer.from(bytes);
}

/**
 * RFC 6238 one-time code. AuthMe's 2FA accepts the standard 6-digit, 30 s,
 * SHA-1 code, which is what this generates by default.
 */
function generateTotp({
  secret,
  digits = 6,
  period = 30,
  algorithm = "sha1",
  timestamp = Date.now(),
} = {}) {
  const key = typeof secret === "string" ? decodeBase32(secret) : secret;
  const counter = Math.floor(timestamp / 1000 / period);
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buffer.writeUInt32BE(counter >>> 0, 4);

  const digest = crypto.createHmac(algorithm, key).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, "0");
}

module.exports = { decodeBase32, generateTotp };

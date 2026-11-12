const USERNAME = /^[A-Za-z0-9_]{3,16}$/;
const TRUTHY = new Set(["1", "true", "yes", "y", "on", "enabled"]);
const FALSEY = new Set(["0", "false", "no", "n", "off", "disabled"]);

const normalizeName = (name) =>
  String(name || "")
    .trim()
    .toLowerCase();

const stripColors = (text) =>
  String(text ?? "").replace(/\u00a7[0-9A-FK-OR]/gi, "");

const normalizeMessage = (message) =>
  stripColors(message).replace(/\s+/g, " ").trim();

const format = (template, values = {}) =>
  Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    String(template ?? ""),
  );

const parseBoolean = (value, fallback) => {
  if (value === undefined || value === null || String(value).trim() === "")
    return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (TRUTHY.has(normalized)) return true;
  if (FALSEY.has(normalized)) return false;
  return fallback;
};

const parseList = (value) =>
  new Set(
    String(value || "")
      .split(",")
      .map(normalizeName)
      .filter(Boolean),
  );

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const isIntegerInRange = (value, min, max) =>
  Number.isInteger(value) && value >= min && value <= max;

const redact = (text, secrets = []) =>
  secrets
    .filter((secret) => typeof secret === "string" && secret.length > 0)
    .reduce(
      (line, secret) => line.split(secret).join("[redacted]"),
      String(text),
    );

const describeError = (error) =>
  error && typeof error === "object" && "message" in error
    ? String(error.message)
    : String(error);

const seconds = (milliseconds) => Math.floor(milliseconds / 1000);

module.exports = {
  USERNAME,
  clamp,
  describeError,
  format,
  isIntegerInRange,
  normalizeMessage,
  normalizeName,
  parseBoolean,
  parseList,
  redact,
  seconds,
  stripColors,
};

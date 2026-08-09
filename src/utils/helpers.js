const USERNAME = /^[A-Za-z0-9_]{3,16}$/;
const normalizeName = (name) => String(name || "").trim().toLowerCase();
const format = (template, values = {}) => Object.entries(values).reduce(
  (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), String(template),
);
const normalizeMessage = (message) => String(message).replace(/\u00a7[0-9A-FK-OR]/gi, "").replace(/\s+/g, " ").trim();
const parseBoolean = (value, fallback) => value === undefined ? fallback : String(value).toLowerCase() === "true";
const parseList = (value) => new Set(String(value || "").split(",").map(normalizeName).filter(Boolean));
module.exports = { USERNAME, normalizeName, format, normalizeMessage, parseBoolean, parseList };

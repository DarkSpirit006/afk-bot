#!/usr/bin/env node
/**
 * Entry point: loads `.env` and starts the bot.
 * Use `npm run setup` first to create the configuration.
 */
const fs = require("node:fs");
const path = require("node:path");

const envPath = path.join(__dirname, ".env");
if (!fs.existsSync(envPath)) {
  console.error(
    "No .env found. Run `npm run setup` to create one, or copy .env.example to .env and fill it in.",
  );
  process.exit(1);
}

require("dotenv").config({ path: envPath });
require("./src/bot").start();

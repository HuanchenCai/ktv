#!/usr/bin/env node
import { randomBytes, randomInt } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, renameSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(root, "config.json");
const examplePath = resolve(root, "config.example.json");
const guestAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function configureRoomConfig(config, address) {
  let url;
  try {
    url = new URL(address);
  } catch {
    throw new Error("Provide the room's HTTPS address, such as https://host.example.ts.net");
  }
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("Room address must be an HTTPS root URL without a path, query, or credentials");
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("config.json must contain a JSON object");
  }

  const guestCode = `KTV-${Array.from({ length: 8 }, () => guestAlphabet[randomInt(guestAlphabet.length)]).join("")}`;
  const adminCode = randomBytes(24).toString("base64url");
  return {
    ...config,
    room: {
      ...(config.room ?? {}),
      public_url: url.origin,
      guest_code: guestCode,
      admin_code: adminCode,
    },
  };
}

function main() {
  const address = process.argv[2];
  if (!address) {
    console.error("Usage: npm run room:configure -- https://your-room.example.ts.net");
    process.exitCode = 1;
    return;
  }
  if (!existsSync(configPath)) copyFileSync(examplePath, configPath);
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const updated = configureRoomConfig(config, address);
  const tempPath = `${configPath}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(updated, null, 2)}\n`, { mode: 0o600 });
  renameSync(tempPath, configPath);
  console.log(`Room address: ${updated.room.public_url}`);
  console.log(`Guest code:   ${updated.room.guest_code}`);
  console.log(`Admin code:   ${updated.room.admin_code}`);
  console.log("Restart KTV to enable the room. Keep the admin code private.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

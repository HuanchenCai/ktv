import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const ConfigSchema = z.object({
  http_port: z.number().int().positive().default(8080),
  openlist: z.object({
    port: z.number().int().positive().default(5244),
    data_dir: z.string().default("./openlist-data"),
    binary_path: z.string().default("./bin/openlist"),
    auto_spawn: z.boolean().default(true),
    api_token: z.string().default(""),
  }),
  library_path: z.string().min(1),
  baidu_root: z.string().default("/baidu"),
  mpv: z.object({
    binary_path: z.string().default(""),
    start_paused: z.boolean().default(false),
    fullscreen: z.boolean().default(false),
  }),
  scheduler: z.object({
    prefetch_ahead: z.number().int().min(0).max(10).default(2),
    poll_interval_ms: z.number().int().min(100).max(10000).default(500),
  }),
  vocal_channel_default: z.enum(["L", "R"]).default("L"),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(projectRoot?: string): Config {
  const root =
    projectRoot ??
    resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const configPath = resolve(root, "config.json");
  const examplePath = resolve(root, "config.example.json");

  if (!existsSync(configPath)) {
    if (existsSync(examplePath)) {
      copyFileSync(examplePath, configPath);
      console.log(
        `[config] created config.json from config.example.json — edit it before running`,
      );
    } else {
      throw new Error(
        `config.json not found at ${configPath} and no config.example.json to seed from`,
      );
    }
  }

  const raw = JSON.parse(readFileSync(configPath, "utf8"));
  const parsed = ConfigSchema.parse(raw);

  return {
    ...parsed,
    openlist: {
      ...parsed.openlist,
      data_dir: resolve(root, parsed.openlist.data_dir),
      binary_path: resolve(root, parsed.openlist.binary_path),
    },
    library_path: resolve(parsed.library_path),
  };
}

export function projectRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

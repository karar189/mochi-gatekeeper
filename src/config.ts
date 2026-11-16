import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface Config {
  hmacSecret: string;
  kurierApiKey: string | null;
  kurierApiUrl: string;
  registeredVkHash: string;
  circuitsDir: string;
  seenStorePath: string;
  kurierPollBudgetMs: number;
  kurierPollIntervalMs: number;
  taskSoftDeadlineMs: number;
  port: number;
}

function defaultCircuitsDir(): string {
  const candidates = [
    path.resolve(__dirname, "..", "circuits"),
    path.resolve(process.cwd(), "circuits"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "gatekeeper.wasm"))) return c;
  }
  return candidates[0];
}

function defaultSeenStorePath(): string {
  if (process.env.RENDER) {
    return path.resolve("/tmp", "gatekeeper-seen.json");
  }
  return path.resolve(process.cwd(), "data", "seen.json");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    hmacSecret: env.AGENT_GAMES_HMAC_SECRET ?? "",
    kurierApiKey: env.KURIER_API_KEY ? env.KURIER_API_KEY : null,
    kurierApiUrl: env.KURIER_API_URL ?? "https://api.kurier.xyz/api/v1",
    registeredVkHash:
      env.REGISTERED_VK_HASH ??
      env.GATEKEEPER_VK_HASH ??
      "0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0",
    circuitsDir: env.CIRCUITS_DIR ?? defaultCircuitsDir(),
    seenStorePath: env.SEEN_STORE_PATH ?? defaultSeenStorePath(),
    // Prefer fast signed responses: platform re-verifies Groth16 offline.
    kurierPollBudgetMs: Number(env.KURIER_POLL_BUDGET_MS ?? 8_000),
    kurierPollIntervalMs: Number(env.KURIER_POLL_INTERVAL_MS ?? 1_500),
    taskSoftDeadlineMs: Number(env.TASK_SOFT_DEADLINE_MS ?? 45_000),
    port: Number(env.PORT ?? 3000),
  };
}

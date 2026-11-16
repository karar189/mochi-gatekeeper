import "dotenv/config";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { SeenStore } from "./store/seen.js";

const cfg = loadConfig();

if (!cfg.hmacSecret) {
  console.warn(
    "[agent] WARNING: AGENT_GAMES_HMAC_SECRET is not set — POSTs will fail until it is configured.",
  );
}

const store = new SeenStore(cfg.seenStorePath);
const app = createApp(cfg, store);

app.listen(cfg.port, () => {
  console.log(
    `[agent] mochi-gatekeeper listening on :${cfg.port} (POST /agent, GET /health)`,
  );
  console.log(`[agent] circuits dir: ${cfg.circuitsDir}`);
});

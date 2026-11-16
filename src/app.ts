import express, { type NextFunction, type Response } from "express";
import type { Config } from "./config.js";
import { createAgentRouter, type RawBodyRequest } from "./routes/agent.js";
import type { SeenStore } from "./store/seen.js";

const MAX_BODY_BYTES = 1_048_576;

export function createApp(cfg: Config, store: SeenStore) {
  const app = express();

  // Capture RAW body for HMAC before JSON parsing.
  app.use(
    express.json({
      limit: MAX_BODY_BYTES,
      verify: (req, _res, buf) => {
        (req as RawBodyRequest).rawBody = Buffer.from(buf);
      },
    }),
  );

  app.use(createAgentRouter(cfg, store));

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  app.use(
    (
      err: Error,
      _req: express.Request,
      res: Response,
      _next: NextFunction,
    ) => {
      console.error("[agent] unhandled error:", err.message);
      res.status(500).json({ error: "internal_error" });
    },
  );

  return app;
}

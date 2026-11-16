import { Router, type Request, type Response } from "express";
import type { Config } from "../config.js";
import { signBody, verifyBodySignature } from "../crypto/hmac.js";
import { buildPreflightResponse } from "../handlers/preflight.js";
import { handleGatekeeperTask } from "../handlers/gatekeeper.js";
import { Prover } from "../proof/generate.js";
import type { SeenStore } from "../store/seen.js";
import {
  PREFLIGHT_TYPE,
  PROTOCOL_VERSION,
  SIGNATURE_HEADER,
  TASK_TYPE,
  type TaskEnvelope,
} from "../types.js";

export interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

export function createAgentRouter(cfg: Config, store: SeenStore): Router {
  const router = Router();
  const prover = new Prover(cfg.circuitsDir);

  router.get(["/agent", "/health", "/"], (_req, res) => {
    res.status(200).json({ ok: true, protocolVersion: PROTOCOL_VERSION });
  });

  router.post("/agent", async (req: RawBodyRequest, res: Response) => {
    const startedAt = Date.now();
    const rawBody = req.rawBody;

    if (!cfg.hmacSecret) {
      res.status(500).json({
        error: "server_misconfigured",
        detail: "AGENT_GAMES_HMAC_SECRET not set",
      });
      return;
    }

    if (!rawBody) {
      res.status(400).json({ error: "missing_raw_body" });
      return;
    }

    const signatureHeader = req.header(SIGNATURE_HEADER);
    if (!verifyBodySignature(cfg.hmacSecret, rawBody, signatureHeader)) {
      res.status(401).json({ error: "invalid_signature" });
      return;
    }

    let envelope: Record<string, unknown>;
    try {
      envelope = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
    } catch {
      sendSigned(res, cfg.hmacSecret, 400, {
        decision: "REJECT",
        reason_code: "INVALID_TASK",
      });
      return;
    }

    if (envelope.type === PREFLIGHT_TYPE) {
      sendSigned(res, cfg.hmacSecret, 200, buildPreflightResponse());
      return;
    }

    if (envelope.type !== TASK_TYPE) {
      sendSigned(res, cfg.hmacSecret, 400, {
        decision: "REJECT",
        reason_code: "INVALID_TASK",
      });
      return;
    }

    try {
      const response = await handleGatekeeperTask(
        cfg,
        store,
        prover,
        envelope as unknown as TaskEnvelope,
        startedAt,
      );
      sendSigned(res, cfg.hmacSecret, 200, response);
    } catch (err) {
      console.error("[agent] task handling error:", (err as Error).message);
      sendSigned(res, cfg.hmacSecret, 200, {
        decision: "REJECT",
        reason_code: "INVALID_TASK",
      });
    }
  });

  return router;
}

function sendSigned(
  res: Response,
  secret: string,
  status: number,
  obj: unknown,
): void {
  const body = JSON.stringify(obj);
  const signature = signBody(secret, body);
  res
    .status(status)
    .set(SIGNATURE_HEADER, signature)
    .type("application/json")
    .send(body);
}

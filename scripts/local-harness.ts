/**
 * Local test harness: boots the Express agent on an ephemeral port and
 * replays signed preflight + Gatekeeper envelopes (valid + all traps).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as snarkjs from "snarkjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const TEST_SECRET = "test-secret-for-local-harness-only";
process.env.AGENT_GAMES_HMAC_SECRET = TEST_SECRET;
process.env.SEEN_STORE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "gk-seen-")),
  "seen.json",
);
process.env.PORT = "0";
delete process.env.KURIER_API_KEY;

const VK_HASH =
  "0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0";
const RECIPIENT = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
const OTHER_RECIPIENT = "0x742d35Cc6634C0532925a3b844Bc454e4438f44f";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, extra?: string): void {
  if (cond) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

function tx(seed: string): string {
  return "0x" + crypto.createHash("sha256").update(seed).digest("hex");
}

function makeTask(
  taskId: string,
  overrides: Record<string, unknown> = {},
): object {
  const now = Date.now();
  return {
    type: "agent-games.proof-gatekeeper.v1",
    task_id: taskId,
    mode: "competition",
    issued_at: new Date(now).toISOString(),
    deadline_at: new Date(now + 55_000).toISOString(),
    input: {
      registered_vk: VK_HASH,
      proof_vk: VK_HASH,
      minimum: "1000",
      public_balance: "1460",
      expiry_block: 8430000,
      current_block: 8420000,
      recipient: RECIPIENT,
      condition_recipient: RECIPIENT,
      amount: "500",
      max_transfer: "1000",
      proof_tx: tx("proof-" + taskId),
      ...overrides,
    },
  };
}

async function main(): Promise<void> {
  const { createApp } = await import("../src/app.js");
  const { loadConfig } = await import("../src/config.js");
  const { signBody, verifyBodySignature } = await import("../src/crypto/hmac.js");
  const { SeenStore } = await import("../src/store/seen.js");

  const verificationKey = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, "circuits", "verification_key.json"),
      "utf8",
    ),
  );

  const cfg = loadConfig();
  const store = new SeenStore(cfg.seenStorePath);
  const app = createApp(cfg, store);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  async function post(
    body: string,
    opts: { sign?: boolean; secret?: string; signature?: string } = {},
  ): Promise<{ status: number; json: any; sig: string | null; text: string }> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (opts.sign !== false) {
      headers["x-agent-games-signature"] =
        opts.signature ?? signBody(opts.secret ?? TEST_SECRET, body);
    }
    const res = await fetch(`${base}/agent`, { method: "POST", headers, body });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* keep null */
    }
    return {
      status: res.status,
      json,
      sig: res.headers.get("x-agent-games-signature"),
      text,
    };
  }

  console.log("== HMAC unit checks ==");
  {
    const body = JSON.stringify({ hello: "world" });
    const hexSig = signBody(TEST_SECRET, body);
    check("hex signature verifies", verifyBodySignature(TEST_SECRET, body, hexSig));
    const b64Sig = crypto
      .createHmac("sha256", TEST_SECRET)
      .update(body)
      .digest("base64");
    check(
      "base64 signature verifies",
      verifyBodySignature(TEST_SECRET, body, b64Sig),
    );
    check(
      "prefixed signature verifies",
      verifyBodySignature(TEST_SECRET, body, "sha256=" + hexSig),
    );
    check(
      "tampered body rejected",
      !verifyBodySignature(TEST_SECRET, body + " ", hexSig),
    );
    check(
      "wrong secret rejected",
      !verifyBodySignature("other-secret", body, hexSig),
    );
    check(
      "missing header rejected",
      !verifyBodySignature(TEST_SECRET, body, undefined),
    );
  }

  console.log("== Preflight ==");
  {
    const body = JSON.stringify({
      type: "agent-games.preflight.v1",
      agent_id: "agt_test",
      issued_at: new Date().toISOString(),
      nonce: "abc123",
    });
    const r = await post(body);
    check("preflight status 200", r.status === 200, `got ${r.status}`);
    check(
      "preflight body shape",
      r.json?.ok === true && r.json?.protocolVersion === "v1",
      JSON.stringify(r.json),
    );
    check(
      "preflight response signed",
      r.sig !== null && verifyBodySignature(TEST_SECRET, r.text, r.sig),
    );
    const bad = await post(body, { secret: "wrong-secret" });
    check("preflight with bad HMAC -> 401", bad.status === 401, `got ${bad.status}`);
  }

  console.log("== Health ==");
  {
    const res = await fetch(`${base}/health`);
    const json: any = await res.json();
    check(
      "GET /health",
      res.status === 200 && json.ok === true && json.protocolVersion === "v1",
    );
  }

  async function expectTask(
    label: string,
    task: object,
    decision: string,
    reason: string,
    withProof: boolean,
  ): Promise<any> {
    const body = JSON.stringify(task);
    const r = await post(body);
    check(`${label} status 200`, r.status === 200, `got ${r.status}`);
    check(
      `${label} decision/reason`,
      r.json?.decision === decision && r.json?.reason_code === reason,
      JSON.stringify(r.json),
    );
    check(
      `${label} response signed`,
      r.sig !== null && verifyBodySignature(TEST_SECRET, r.text, r.sig),
    );
    if (withProof) {
      const hasProof =
        r.json?.proof &&
        Array.isArray(r.json?.public_signals) &&
        r.json.public_signals.length === 13;
      check(`${label} has proof + 13 public_signals`, hasProof);
      if (hasProof) {
        const ok = await snarkjs.groth16.verify(
          verificationKey,
          r.json.public_signals,
          r.json.proof,
        );
        check(`${label} proof verifies locally`, ok);
      }
    } else {
      check(
        `${label} has no proof`,
        !r.json?.proof && !r.json?.public_signals,
      );
    }
    return r.json;
  }

  console.log("== Valid APPROVE ==");
  await expectTask(
    "VALID_CONDITION",
    makeTask("gk_valid_1"),
    "APPROVE",
    "VALID_CONDITION",
    true,
  );

  console.log("== Traps ==");
  await expectTask(
    "VK_SUBSTITUTION",
    makeTask("gk_vk_1", {
      proof_vk:
        "0x1111111111111111111111111111111111111111111111111111111111111111",
    }),
    "REJECT",
    "VK_SUBSTITUTION",
    true,
  );

  const reuseTx = tx("reuse-shared");
  await expectTask(
    "first use (setup for reuse)",
    makeTask("gk_reuse_setup", { proof_tx: reuseTx }),
    "APPROVE",
    "VALID_CONDITION",
    true,
  );
  await expectTask(
    "PROOF_REUSED",
    makeTask("gk_reuse_1", { proof_tx: reuseTx }),
    "REJECT",
    "PROOF_REUSED",
    false,
  );

  await expectTask(
    "THRESHOLD_MISMATCH",
    makeTask("gk_thresh_1", { public_balance: "900" }),
    "REJECT",
    "THRESHOLD_MISMATCH",
    true,
  );

  await expectTask(
    "EXPIRED_CONDITION",
    makeTask("gk_exp_1", { current_block: 8430000 }),
    "REJECT",
    "EXPIRED_CONDITION",
    true,
  );

  await expectTask(
    "RECIPIENT_MISMATCH",
    makeTask("gk_recv_1", { recipient: OTHER_RECIPIENT }),
    "REJECT",
    "RECIPIENT_MISMATCH",
    true,
  );

  await expectTask(
    "AMOUNT_OVERFLOW",
    makeTask("gk_amt_1", { amount: "1500" }),
    "REJECT",
    "AMOUNT_OVERFLOW",
    true,
  );

  console.log("== Idempotent redelivery ==");
  {
    const task = makeTask("gk_idem_1");
    const body = JSON.stringify(task);
    const r1 = await post(body);
    const r2 = await post(body);
    check(
      "redelivery same decision",
      r1.json?.decision === r2.json?.decision &&
        r1.json?.reason_code === r2.json?.reason_code,
    );
  }

  console.log("== Wrong decision cannot prove (circuit referee) ==");
  {
    const { buildCircuitInputs, parseInput } = await import(
      "../src/decision/checklist.js"
    );
    const { deriveSalt } = await import("../src/crypto/hmac.js");
    const { Prover } = await import("../src/proof/generate.js");
    const prover = new Prover(path.join(ROOT, "circuits"));

    // Valid statement + REJECT (decision=0) must fail — circuit requires honesty.
    {
      const envelope = makeTask("gk_wrong_reject") as any;
      const parsed = parseInput(envelope.input)!;
      const salt = deriveSalt(TEST_SECRET, envelope.task_id);
      const inputs = buildCircuitInputs(envelope, parsed, "REJECT", salt);
      let threw = false;
      try {
        await prover.prove(inputs);
      } catch {
        threw = true;
      }
      check("valid task + REJECT fails prove", threw);
    }

    // Trap statement + APPROVE (decision=1) must fail.
    {
      const envelope = makeTask("gk_wrong_approve", {
        public_balance: "900",
      }) as any;
      const parsed = parseInput(envelope.input)!;
      const salt = deriveSalt(TEST_SECRET, envelope.task_id);
      const inputs = buildCircuitInputs(envelope, parsed, "APPROVE", salt);
      let threw = false;
      try {
        await prover.prove(inputs);
      } catch {
        threw = true;
      }
      check("trap task + APPROVE fails prove", threw);
    }
  }

  server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

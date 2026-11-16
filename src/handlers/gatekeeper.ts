import type { Config } from "../config.js";
import { deriveSalt } from "../crypto/hmac.js";
import {
  buildCircuitInputs,
  evaluate,
  parseInput,
} from "../decision/checklist.js";
import { Prover } from "../proof/generate.js";
import type { SeenStore } from "../store/seen.js";
import type { TaskEnvelope, TaskResponse } from "../types.js";
import { submitProofAndPoll } from "../zkverify/kurier.js";

/** Don't start Kurier if less than this remains before our soft deadline. */
const KURIER_MIN_REMAINING_MS = 6_000;

export async function handleGatekeeperTask(
  cfg: Config,
  store: SeenStore,
  prover: Prover,
  task: TaskEnvelope,
  startedAt: number,
): Promise<TaskResponse> {
  if (task.task_id) {
    const cached = store.getResponse(task.task_id);
    if (cached) {
      return JSON.parse(cached) as TaskResponse;
    }
  }

  const now = Date.now();
  const deadlineMs = parseTimestamp(task.deadline_at);
  const issuedMs = parseTimestamp(task.issued_at);
  if (deadlineMs !== null && now > deadlineMs) {
    return { decision: "REJECT", reason_code: "INVALID_TASK" };
  }
  if (issuedMs !== null && issuedMs > now + 5 * 60_000) {
    return { decision: "REJECT", reason_code: "INVALID_TASK" };
  }

  const parsed = parseInput(task.input);
  if (!parsed || !task.task_id) {
    return { decision: "REJECT", reason_code: "INVALID_TASK" };
  }

  const evaluation = evaluate(
    parsed,
    (tx) => store.hasProofTx(tx),
    cfg.registeredVkHash,
  );
  const response: TaskResponse = {
    decision: evaluation.decision,
    reason_code: evaluation.reason_code,
  };

  if (evaluation.provable) {
    // If the hard deadline is nearly gone, fail closed before expensive prove.
    const hardLeft =
      deadlineMs !== null ? deadlineMs - Date.now() : cfg.taskSoftDeadlineMs;
    if (hardLeft < 3_000) {
      return {
        decision: "REJECT",
        reason_code:
          evaluation.decision === "APPROVE"
            ? "INVALID_TASK"
            : evaluation.reason_code,
        proof_tx: parsed.proofTx,
      };
    }

    const salt = deriveSalt(cfg.hmacSecret, task.task_id);
    const circuitInputs = buildCircuitInputs(
      task,
      parsed,
      evaluation.decision,
      salt,
    );
    try {
      const { proof, publicSignals } = await prover.prove(circuitInputs);
      response.proof = proof;
      response.public_signals = publicSignals;

      // Platform re-verifies Groth16 offline; Kurier is optional audit pointer.
      // Prefer returning a valid proof in time over waiting for Finalized.
      const softLeft = cfg.taskSoftDeadlineMs - (Date.now() - startedAt);
      const hardRemaining =
        deadlineMs !== null ? deadlineMs - Date.now() : softLeft;
      const remaining = Math.min(softLeft, hardRemaining);
      if (remaining >= KURIER_MIN_REMAINING_MS) {
        const budget = Math.min(cfg.kurierPollBudgetMs, remaining - 2_000);
        const kurier = await submitProofAndPoll(
          cfg,
          proof,
          publicSignals,
          Math.max(0, budget),
        );
        response.proof_tx = kurier?.txHash ? kurier.txHash : parsed.proofTx;
      } else {
        response.proof_tx = parsed.proofTx;
      }
    } catch (err) {
      console.error("[agent] proof generation failed:", (err as Error).message);
      return {
        decision: "REJECT",
        reason_code:
          evaluation.decision === "APPROVE"
            ? "INVALID_TASK"
            : evaluation.reason_code,
        proof_tx: parsed.proofTx,
      };
    }
  } else {
    response.proof_tx = parsed.proofTx;
  }

  store.recordOutcome(parsed.proofTx, task.task_id, JSON.stringify(response));
  return response;
}

export function parseTimestamp(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v < 1e12 ? v * 1000 : v;
  }
  if (typeof v === "string") {
    const asNum = Number(v);
    if (/^[0-9]+$/.test(v.trim()) && Number.isFinite(asNum)) {
      return asNum < 1e12 ? asNum * 1000 : asNum;
    }
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

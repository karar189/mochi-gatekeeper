import type { Config } from "../config.js";
import type { Groth16Proof } from "../types.js";

/**
 * Kurier REST submission for optional on-chain audit.
 * Platform scoring re-verifies the Groth16 proof offline — Kurier is best-effort.
 * Returns as soon as a txHash appears (or budget expires); never blocks APPROVE.
 * Never throws.
 */
export interface KurierOutcome {
  jobId: string;
  status: string;
  txHash?: string;
  finalized: boolean;
}

export async function submitProofAndPoll(
  cfg: Config,
  proof: Groth16Proof,
  publicSignals: string[],
  budgetMs: number,
): Promise<KurierOutcome | null> {
  if (!cfg.kurierApiKey) {
    console.log("[kurier] KURIER_API_KEY not set — skipping zkVerify submission");
    return null;
  }
  const key = cfg.kurierApiKey;
  const deadline = Date.now() + Math.max(0, budgetMs);

  try {
    const submitRes = await fetch(`${cfg.kurierApiUrl}/submit-proof/${key}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        proofType: "groth16",
        vkRegistered: true,
        proofOptions: { library: "snarkjs", curve: "bn128" },
        proofData: {
          proof,
          publicSignals,
          vk: cfg.registeredVkHash,
        },
      }),
    });

    if (!submitRes.ok) {
      console.error(`[kurier] submit-proof HTTP ${submitRes.status}`);
      return null;
    }

    const job = (await submitRes.json()) as {
      jobId?: string;
      optimisticVerify?: string;
    };
    if (!job.jobId) {
      console.error("[kurier] submit-proof response missing jobId");
      return null;
    }
    console.log(
      `[kurier] job ${job.jobId} submitted (optimisticVerify=${job.optimisticVerify ?? "n/a"})`,
    );

    let status = "Submitted";
    let lastTxHash: string | undefined;

    while (Date.now() < deadline) {
      await sleep(Math.min(cfg.kurierPollIntervalMs, Math.max(0, deadline - Date.now())));
      const statusRes = await fetch(
        `${cfg.kurierApiUrl}/job-status/${key}/${job.jobId}`,
      );
      if (!statusRes.ok) {
        console.error(`[kurier] job-status HTTP ${statusRes.status}`);
        continue;
      }
      const s = (await statusRes.json()) as {
        status?: string;
        txHash?: string;
        transactionInfo?: { txHash?: string };
      };
      status = s.status ?? status;
      const txHash = s.txHash ?? s.transactionInfo?.txHash;
      if (txHash) lastTxHash = txHash;
      if (status === "Failed") {
        return { jobId: job.jobId, status, txHash, finalized: false };
      }
      if (status === "Finalized") {
        return { jobId: job.jobId, status, txHash: lastTxHash, finalized: true };
      }
      if (txHash) {
        return {
          jobId: job.jobId,
          status,
          txHash,
          finalized: false,
        };
      }
    }

    console.log(
      `[kurier] job ${job.jobId} no Finalized/txHash within budget (last=${status})`,
    );
    return {
      jobId: job.jobId,
      status,
      txHash: lastTxHash,
      finalized: false,
    };
  } catch (err) {
    console.error("[kurier] submission error:", (err as Error).message);
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

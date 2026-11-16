import path from "node:path";
import * as snarkjs from "snarkjs";
import type { Groth16Proof } from "../types.js";

/**
 * Local Groth16 proving with snarkjs against official gatekeeper artifacts.
 * Typically ~0.4–1.0s for this circuit — well inside the 60s deadline.
 * Proves are serialized to avoid Render starter OOM under concurrent tasks.
 */
export class Prover {
  private wasmPath: string;
  private zkeyPath: string;
  private vkCache: unknown | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(circuitsDir: string) {
    this.wasmPath = path.join(circuitsDir, "gatekeeper.wasm");
    this.zkeyPath = path.join(circuitsDir, "gatekeeper_final.zkey");
  }

  /** Prefetch VK so the first scored task does not pay cold zkey export cost. */
  async warmup(): Promise<void> {
    await this.getVerificationKey();
  }

  async prove(
    circuitInputs: Record<string, string>,
  ): Promise<{ proof: Groth16Proof; publicSignals: string[] }> {
    const run = async () => {
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        circuitInputs,
        this.wasmPath,
        this.zkeyPath,
      );

      const vk = await this.getVerificationKey();
      const ok = await snarkjs.groth16.verify(vk, publicSignals, proof);
      if (!ok) {
        throw new Error("locally generated proof failed verification");
      }

      return { proof: proof as Groth16Proof, publicSignals };
    };

    const next = this.chain.then(run, run);
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async getVerificationKey(): Promise<unknown> {
    if (!this.vkCache) {
      this.vkCache = await snarkjs.zKey.exportVerificationKey(this.zkeyPath);
    }
    return this.vkCache;
  }
}

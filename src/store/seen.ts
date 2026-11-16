import fs from "node:fs";
import path from "node:path";

/**
 * Seen-set for proof_tx (PROOF_REUSED trap) plus task_id → response cache
 * for idempotent redelivery.
 */
export class SeenStore {
  private seenProofTx = new Set<string>();
  private responseByTaskId = new Map<string, string>();
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const data = JSON.parse(raw) as {
        proofTx?: string[];
        responses?: Record<string, string>;
      };
      for (const tx of data.proofTx ?? []) this.seenProofTx.add(normalizeTx(tx));
      for (const [k, v] of Object.entries(data.responses ?? {})) {
        this.responseByTaskId.set(k, v);
      }
    } catch {
      /* empty store on missing/corrupt file */
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(
        tmp,
        JSON.stringify({
          proofTx: [...this.seenProofTx],
          responses: Object.fromEntries(this.responseByTaskId),
        }),
      );
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      console.error("[seen-store] persist failed:", (err as Error).message);
    }
  }

  hasProofTx(proofTx: string): boolean {
    return this.seenProofTx.has(normalizeTx(proofTx));
  }

  recordProofTx(proofTx: string): void {
    const key = normalizeTx(proofTx);
    if (!key) return;
    if (!this.seenProofTx.has(key)) {
      this.seenProofTx.add(key);
      this.persist();
    }
  }

  getResponse(taskId: string): string | null {
    return this.responseByTaskId.get(taskId) ?? null;
  }

  recordResponse(taskId: string, serializedResponse: string): void {
    if (!this.responseByTaskId.has(taskId)) {
      this.responseByTaskId.set(taskId, serializedResponse);
      this.persist();
    }
  }

  /** Single disk write for proof_tx + cached response (hot path). */
  recordOutcome(
    proofTx: string,
    taskId: string,
    serializedResponse: string,
  ): void {
    let dirty = false;
    const key = normalizeTx(proofTx);
    if (key && !this.seenProofTx.has(key)) {
      this.seenProofTx.add(key);
      dirty = true;
    }
    if (taskId && !this.responseByTaskId.has(taskId)) {
      this.responseByTaskId.set(taskId, serializedResponse);
      dirty = true;
    }
    if (dirty) this.persist();
  }
}

export function normalizeTx(tx: string): string {
  return (tx ?? "").trim().toLowerCase();
}

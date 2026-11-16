import { taskIdToField } from "../crypto/hmac.js";
import type {
  Decision,
  Evaluation,
  GatekeeperInput,
  TaskEnvelope,
} from "../types.js";

/**
 * Deterministic Gatekeeper policy — mirrors the circuit referee.
 * Trap order (first failing wins):
 *   VK_SUBSTITUTION → PROOF_REUSED → THRESHOLD_MISMATCH →
 *   EXPIRED_CONDITION → RECIPIENT_MISMATCH → AMOUNT_OVERFLOW
 */

function normalizeHex(v: string): string {
  return (v ?? "").trim().toLowerCase();
}

export function parseUint(v: unknown): bigint | null {
  if (typeof v === "number") {
    return Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : null;
  }
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (/^0x[0-9a-fA-F]+$/.test(s)) return BigInt(s);
  if (/^[0-9]+$/.test(s)) return BigInt(s);
  return null;
}

export interface ParsedInput {
  registeredVk: string;
  proofVk: string;
  minimum: bigint;
  publicBalance: bigint;
  expiryBlock: bigint;
  currentBlock: bigint;
  recipient: string;
  conditionRecipient: string;
  amount: bigint;
  maxTransfer: bigint;
  proofTx: string;
}

export function parseInput(input: GatekeeperInput | undefined): ParsedInput | null {
  if (!input || typeof input !== "object") return null;
  const minimum = parseUint(input.minimum);
  const publicBalance = parseUint(input.public_balance);
  const amount = parseUint(input.amount);
  const maxTransfer = parseUint(input.max_transfer);
  const expiryBlock = parseUint(input.expiry_block);
  const currentBlock = parseUint(input.current_block);
  if (
    minimum === null ||
    publicBalance === null ||
    amount === null ||
    maxTransfer === null ||
    expiryBlock === null ||
    currentBlock === null
  ) {
    return null;
  }
  if (
    typeof input.registered_vk !== "string" ||
    !input.registered_vk ||
    typeof input.proof_vk !== "string" ||
    !input.proof_vk ||
    typeof input.recipient !== "string" ||
    !input.recipient ||
    typeof input.condition_recipient !== "string" ||
    !input.condition_recipient ||
    typeof input.proof_tx !== "string" ||
    !input.proof_tx
  ) {
    return null;
  }
  return {
    registeredVk: input.registered_vk,
    proofVk: input.proof_vk,
    minimum,
    publicBalance,
    expiryBlock,
    currentBlock,
    recipient: input.recipient,
    conditionRecipient: input.condition_recipient,
    amount,
    maxTransfer,
    proofTx: input.proof_tx,
  };
}

export function evaluate(
  parsed: ParsedInput,
  isProofTxSeen: (proofTx: string) => boolean,
): Evaluation {
  if (normalizeHex(parsed.proofVk) !== normalizeHex(parsed.registeredVk)) {
    return { decision: "REJECT", reason_code: "VK_SUBSTITUTION", provable: true };
  }
  if (isProofTxSeen(parsed.proofTx)) {
    return { decision: "REJECT", reason_code: "PROOF_REUSED", provable: false };
  }
  if (parsed.publicBalance < parsed.minimum) {
    return { decision: "REJECT", reason_code: "THRESHOLD_MISMATCH", provable: true };
  }
  if (parsed.currentBlock >= parsed.expiryBlock) {
    return { decision: "REJECT", reason_code: "EXPIRED_CONDITION", provable: true };
  }
  if (normalizeHex(parsed.recipient) !== normalizeHex(parsed.conditionRecipient)) {
    return { decision: "REJECT", reason_code: "RECIPIENT_MISMATCH", provable: true };
  }
  if (parsed.amount > parsed.maxTransfer) {
    return { decision: "REJECT", reason_code: "AMOUNT_OVERFLOW", provable: true };
  }
  return { decision: "APPROVE", reason_code: "VALID_CONDITION", provable: true };
}

/**
 * Circuit inputs for gatekeeper.wasm (signal names recovered from the artifact).
 * Hex VK/address fields are passed as hex strings (snarkjs accepts them).
 * Numeric fields as decimal strings. decision: "1" APPROVE / "0" REJECT.
 */
export function buildCircuitInputs(
  envelope: TaskEnvelope,
  parsed: ParsedInput,
  decision: Decision,
  salt: bigint,
): Record<string, string> {
  return {
    registeredVkHash: parsed.registeredVk,
    proofVkHash: parsed.proofVk,
    minimum: parsed.minimum.toString(10),
    publicBalance: parsed.publicBalance.toString(10),
    expiryBlock: parsed.expiryBlock.toString(10),
    currentBlock: parsed.currentBlock.toString(10),
    recipient: parsed.recipient,
    conditionRecipient: parsed.conditionRecipient,
    amount: parsed.amount.toString(10),
    maxTransfer: parsed.maxTransfer.toString(10),
    decision: decision === "APPROVE" ? "1" : "0",
    taskId: taskIdToField(envelope.task_id),
    salt: salt.toString(10),
  };
}

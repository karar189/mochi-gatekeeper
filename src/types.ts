/**
 * Protocol types for zkVerify Agent Games "Proof Gatekeeper".
 * Field names match https://agentgames.zkverify.io/build
 */

export const TASK_TYPE = "agent-games.proof-gatekeeper.v1";
export const PREFLIGHT_TYPE = "agent-games.preflight.v1";
export const PROTOCOL_VERSION = "v1";
export const SIGNATURE_HEADER = "x-agent-games-signature";

/** Documented trap taxonomy on /events/proof-gatekeeper. */
export type ReasonCode =
  | "VALID_CONDITION"
  | "VK_SUBSTITUTION"
  | "PROOF_REUSED"
  | "THRESHOLD_MISMATCH"
  | "EXPIRED_CONDITION"
  | "RECIPIENT_MISMATCH"
  | "AMOUNT_OVERFLOW"
  | "INVALID_TASK";

export type Decision = "APPROVE" | "REJECT";

export interface GatekeeperInput {
  registered_vk: string;
  proof_vk: string;
  minimum: string;
  public_balance: string;
  expiry_block: number | string;
  current_block: number | string;
  recipient: string;
  condition_recipient: string;
  amount: string;
  max_transfer: string;
  proof_tx: string;
}

export interface TaskEnvelope {
  type: typeof TASK_TYPE;
  task_id: string;
  mode?: string;
  issued_at: string;
  deadline_at: string;
  input: GatekeeperInput;
}

export interface PreflightEnvelope {
  type: typeof PREFLIGHT_TYPE;
  agent_id?: string;
  issued_at?: string;
  nonce?: string;
}

export interface Groth16Proof {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol: string;
  curve: string;
}

export interface TaskResponse {
  decision: Decision;
  reason_code: ReasonCode;
  proof?: Groth16Proof;
  public_signals?: string[];
  proof_tx?: string;
}

export interface PreflightResponse {
  ok: true;
  protocolVersion: typeof PROTOCOL_VERSION;
}

export interface Evaluation {
  decision: Decision;
  reason_code: ReasonCode;
  /** False only for PROOF_REUSED (no proof to submit). */
  provable: boolean;
}

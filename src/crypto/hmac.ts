import crypto from "node:crypto";
import { keccak256, toBytes } from "viem";

/**
 * HMAC-SHA256 for x-agent-games-signature over the RAW body.
 * Outbound: lowercase hex. Inbound: hex, base64, or sha256= prefix.
 */

export const BN128_PRIME =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export function signBody(secret: string, rawBody: string | Buffer): string {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

function macBytes(secret: string, rawBody: string | Buffer): Buffer {
  return crypto.createHmac("sha256", secret).update(rawBody).digest();
}

function decodeCandidate(headerValue: string): Buffer | null {
  let v = headerValue.trim();
  if (v.toLowerCase().startsWith("sha256=")) v = v.slice("sha256=".length).trim();
  if (/^[0-9a-fA-F]{64}$/.test(v)) return Buffer.from(v, "hex");
  try {
    const b = Buffer.from(v, "base64");
    if (b.length === 32) return b;
  } catch {
    /* ignore */
  }
  return null;
}

export function verifyBodySignature(
  secret: string,
  rawBody: string | Buffer,
  headerValue: string | undefined | null,
): boolean {
  if (!secret || !headerValue) return false;
  const candidate = decodeCandidate(headerValue);
  if (!candidate) return false;
  const expected = macBytes(secret, rawBody);
  return (
    candidate.length === expected.length &&
    crypto.timingSafeEqual(candidate, expected)
  );
}

/** Deterministic private salt bound to the HMAC secret + task_id. */
export function deriveSalt(secret: string, taskId: string): bigint {
  const digest = crypto
    .createHmac("sha256", secret || "gatekeeper-local-dev")
    .update(`gatekeeper-salt:${taskId}`)
    .digest();
  return BigInt(`0x${digest.toString("hex")}`) % BN128_PRIME;
}

/** taskId circuit input: keccak256(UTF-8 task_id) mod BN128 prime. */
export function taskIdToField(taskId: string): string {
  const hash = keccak256(toBytes(taskId));
  return (BigInt(hash) % BN128_PRIME).toString(10);
}

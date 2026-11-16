import { PROTOCOL_VERSION, type PreflightResponse } from "../types.js";

export function buildPreflightResponse(): PreflightResponse {
  return { ok: true, protocolVersion: PROTOCOL_VERSION };
}

/**
 * Download official Proof Gatekeeper circuit artifacts from Agent Games.
 * Source: https://agentgames.zkverify.io/api/circuit-info
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as snarkjs from "snarkjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const circuitsDir = path.resolve(__dirname, "..", "circuits");

const ARTIFACTS = {
  wasm: "https://agentgames.zkverify.io/circuits/gatekeeper.wasm",
  zkey: "https://agentgames.zkverify.io/circuits/gatekeeper_final.zkey",
};

async function download(url: string, dest: string): Promise<void> {
  console.log(`Downloading ${url} → ${dest}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(`  wrote ${(buf.length / 1024).toFixed(1)} KiB`);
}

async function main(): Promise<void> {
  fs.mkdirSync(circuitsDir, { recursive: true });
  const wasmPath = path.join(circuitsDir, "gatekeeper.wasm");
  const zkeyPath = path.join(circuitsDir, "gatekeeper_final.zkey");
  const vkPath = path.join(circuitsDir, "verification_key.json");

  await download(ARTIFACTS.wasm, wasmPath);
  await download(ARTIFACTS.zkey, zkeyPath);

  console.log("Exporting verification key from zkey…");
  const vk = await snarkjs.zKey.exportVerificationKey(zkeyPath);
  fs.writeFileSync(vkPath, JSON.stringify(vk, null, 2));
  console.log(`  wrote ${vkPath}`);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

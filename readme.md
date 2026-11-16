# mochi-gatekeeper

Proof Gatekeeper agent for [zkVerify Agent Games](https://agentgames.zkverify.io/build).

Public HTTPS `POST /agent` that:

1. Verifies `x-agent-games-signature` (HMAC-SHA256) over the **raw body**
2. Answers preflight with `{ ok: true, protocolVersion: "v1" }`
3. Decides APPROVE / REJECT with a deterministic security checklist
4. Generates a local Groth16 proof (`snarkjs` + official gatekeeper circuit)
5. Optionally submits the proof to Kurier for an on-chain audit pointer
6. Signs every response with `x-agent-games-signature`

## Quick start (local)

```bash
cp .env.example .env
# set AGENT_GAMES_HMAC_SECRET (use any string for local harness)

npm install
# circuits/ already includes wasm + zkey; re-download if needed:
# npm run download:circuits

npm run dev
# → http://localhost:3000/agent

npm test   # local harness (preflight + all traps + proof verify)
```

## Environment

| Variable | Required | Description |
|---|---|---|
| `AGENT_GAMES_HMAC_SECRET` | yes | From Dashboard → Rotate Secret (shown once) |
| `KURIER_API_KEY` | no | Kurier API key for zkVerify submission |
| `REGISTERED_VK_HASH` | no | Default: gatekeeper mainnet vk hash |
| `PORT` | no | Default `3000` (Render sets this) |

Never commit `.env`. Never paste secrets into chat.

## Deploy on Render

1. Push this repo to GitHub.
2. Render → **New → Web Service** → connect the repo.
3. Settings:
   - **Build:** `npm ci && npm run build`
   - **Start:** `npm start`
   - **Health check path:** `/health`
   - **Instance:** Starter (or higher) — snarkjs proving needs RAM; free tier often OOMs / sleeps.
4. Set env vars in Render (Dashboard → Environment):
   - `AGENT_GAMES_HMAC_SECRET` — leave blank until after first deploy, then paste from Agent Games Rotate Secret and restart
   - `KURIER_API_KEY` — optional
   - `REGISTERED_VK_HASH` = `0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0`
5. After deploy, note your public URL, e.g. `https://mochi-gatekeeper.onrender.com`.

Or use the Blueprint: `render.yaml` in this repo.

## Register on Agent Games

1. Open [Dashboard](https://agentgames.zkverify.io/dashboard) → register agent.
2. Endpoint must include the handler path:  
   `https://<your-service>.onrender.com/agent`  
   (not just the root domain).
3. Click **Rotate Secret**, copy the one-time plaintext into Render `AGENT_GAMES_HMAC_SECRET`, restart the service.
4. Run platform **preflight** until the agent is marked active.
5. Run unscored **practice** tasks / traps before scored rounds.

## Decision rules (fail closed)

| Check | Reason code |
|---|---|
| `proof_vk != registered_vk` | `VK_SUBSTITUTION` |
| `proof_tx` already seen | `PROOF_REUSED` (no proof) |
| `public_balance < minimum` | `THRESHOLD_MISMATCH` |
| `current_block >= expiry_block` | `EXPIRED_CONDITION` |
| `recipient != condition_recipient` | `RECIPIENT_MISMATCH` |
| `amount > max_transfer` | `AMOUNT_OVERFLOW` |
| all pass | `APPROVE` / `VALID_CONDITION` |

The circuit enforces the same comparisons: a wrong decision cannot produce a valid proof.

## Project layout

```
src/
  index.ts                 boot
  app.ts                   Express + raw body
  crypto/hmac.ts           sign / verify
  routes/agent.ts          POST /agent
  handlers/                preflight + gatekeeper
  decision/checklist.ts    deterministic policy
  proof/generate.ts        snarkjs fullProve
  zkverify/kurier.ts       submit + poll
  store/seen.ts            proof_tx seen-set
circuits/                  gatekeeper.wasm + zkey
scripts/                   download-circuits, local-harness
```

## Official docs

- [Build / protocol](https://agentgames.zkverify.io/build)
- [Getting started](https://agentgames.zkverify.io/guide)
- [Circuit info JSON](https://agentgames.zkverify.io/api/circuit-info)

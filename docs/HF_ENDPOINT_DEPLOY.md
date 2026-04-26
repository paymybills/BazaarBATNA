# Deploying Sauda v2 as an HF Inference Endpoint

The `/sell` page calls `/seller-mode/step` with `strategy="sauda"` which routes through `server/sauda_buyer.py` to a HuggingFace Inference Endpoint serving `PayMyBills/bestdealbot-v2`. This doc is the click-through to get that endpoint live.

## Prerequisites

- HF account with billing enabled (Inference Endpoints are paid)
- HF token with **read** access to `PayMyBills/bestdealbot-v2`
- ~$1-3 of HF credit for the demo window (a10g-small at min replicas=1 is ~$0.60/hr)

## The adapter's base model is already ungated ✅

Earlier we worried about the adapter pointing at the gated `meta-llama/Llama-3.1-8B-Instruct`. Confirmed:

```bash
curl -sf "https://huggingface.co/PayMyBills/bestdealbot-v2/raw/main/adapter_config.json" \
  | python -c "import sys,json; print(json.load(sys.stdin)['base_model_name_or_path'])"
# → unsloth/Llama-3.1-8B-Instruct
```

The adapter loads on top of the ungated unsloth mirror. **No license click-through needed at deploy time.**

## Click-through

1. Go to <https://huggingface.co/PayMyBills/bestdealbot-v2>
2. Click **Deploy → Inference Endpoints**
3. Settings:
   - **Endpoint name**: `bestdealbot-v2-prod` (or anything)
   - **Region**: `us-east-1` (or whichever has lowest a10g-small price right now)
   - **Hardware**: `GPU · Nvidia A10G · small` (~$0.60/hr)
   - **Min replicas**: `1` (no scale-to-zero — first cold start is 4+ min, kills the demo)
   - **Max replicas**: `1` (we don't need autoscaling)
   - **Container Type**: `Default` (text-generation handler)
   - **Auto-scale to zero**: **Off** (re-emphasizing — leave OFF for the demo window)
4. Click **Create Endpoint**.
5. Wait ~3-5 min for status to flip from `Initializing` → `Running`.

## Wire to the server

Once the endpoint shows `Running`, copy the URL from the endpoint detail page (looks like `https://abc123.us-east-1.aws.endpoints.huggingface.cloud`).

```bash
export SAUDA_HF_URL="https://abc123.us-east-1.aws.endpoints.huggingface.cloud"
export SAUDA_HF_TOKEN="hf_..."         # token with read access to the model
export SAUDA_BACKEND=hf                # default but explicit
export SAUDA_ADMIN_TOKEN="$(openssl rand -hex 16)"   # for /sauda/health ops view

# Safety knobs (defaults shown — tighten for paranoid demos)
export SAUDA_HF_MAX_CALLS_PER_DAY=1500   # hard cap; trip → flip to ollama
export SAUDA_RL_PER_MIN=30               # per-IP sliding window
export SAUDA_RL_PER_HOUR=200
export SAUDA_RL_PER_DAY=500
export SAUDA_MAX_CONCURRENT_HF=4         # max in-flight HF calls
export SAUDA_CB_ERRORS=3                 # circuit-breaker error threshold
export SAUDA_CB_COOLDOWN=300             # circuit-breaker cooldown (sec)
export SAUDA_MAX_PROMPT_CHARS=4000       # anti-injection ballooning

# restart the FastAPI server so it picks up the env-vars
python -m server.app
```

Verify (public response — minimal on purpose, no spend numbers leaked):

```bash
curl -sf http://localhost:8000/sauda/health | python -m json.tool
```

```json
{
  "status": "ok",
  "live_agent_available": true
}
```

Ops view (full state — pass the admin token via header):

```bash
curl -sf -H "X-Sauda-Admin: $SAUDA_ADMIN_TOKEN" http://localhost:8000/sauda/health | python -m json.tool
```

Returns the daily counter, in-flight count, circuit-breaker state, lifetime block tallies, etc.

## Smoke test

```bash
curl -sf -X POST http://localhost:8000/seller-mode/reset \
  -H "Content-Type: application/json" \
  -d '{"task":"single_deal","strategy":"sauda","seed":42,"opening_price":60.0}' \
  | python -m json.tool
```

The response should have:
- `buyer_message`: a Hinglish/English line (not empty, not a template)
- `buyer_action`: `"offer"` with a sane `buyer_price`

The response intentionally does **not** include which backend served the call — we keep that internal so a public observer can't see when we're degraded. To see internal state during a smoke test, hit `/sauda/health` with the admin header.

If smoke responses look like template Hinglish or the price is exactly 35% of opening, the HF path likely failed and ollama/rule kicked in. Check the admin /sauda/health for `safety.lifetime.hf_errors` and `circuit_breaker_open`. If the issue is `403`, your token doesn't have access to the model — regenerate at <https://huggingface.co/settings/tokens> with `read` scope.

## Safety / cost defenses

The `/seller-mode` route sits in front of a paid HF endpoint, so we layer
multiple gates between the public internet and a token-burning call:

| Gate | What it does | Trips when | Default |
|---|---|---|---|
| Daily call cap | Hard ceiling on HF calls per UTC day | exceeded | 1500/day (≈ $3-5 a10g-small) |
| Per-IP rate limit | Sliding windows: 1m / 1h / 1d | abuse from one source | 30 / 200 / 500 |
| Concurrency cap | Max in-flight HF calls | flash crowd | 4 |
| Circuit breaker | Auto-pause HF after consecutive errors | 3 errors in a row | 5 min cooldown |
| Prompt-size cap | Reject oversized prompts before calling | injection ballooning | 4000 chars |

**When any gate trips, the request silently falls through HF → ollama → rule.**
The user sees the same `/sell` page response shape and just gets a slightly
slower or simpler buyer. We don't return a "rate-limited" status — we just
serve them with the next backend down, so a public observer can't fingerprint
when we're throttled (or grind to fingerprint our caps).

Daily counter persists to `runs/safety_state.json` so a server restart
doesn't reset the budget and let an attacker get a fresh allowance.

To watch in real time during a demo:

```bash
watch -n 5 'curl -sf -H "X-Sauda-Admin: $SAUDA_ADMIN_TOKEN" \
    http://localhost:8000/sauda/health | python -m json.tool | grep -E "calls|inflight|blocked|circuit"'
```

If you see `blocked_ip` or `blocked_concurrency` climbing fast in the demo
window, you're being scanned — tighten `SAUDA_RL_PER_MIN` or restart with
a smaller `SAUDA_HF_MAX_CALLS_PER_DAY` to fail-safe.

**Panic button:** if you suspect the endpoint is being drained:

```bash
# 1. Cap budget instantly: re-export a tiny daily cap and restart server
export SAUDA_HF_MAX_CALLS_PER_DAY=1
# kill+restart the FastAPI process

# 2. Or: forcibly route everything to ollama
export SAUDA_BACKEND=ollama
# kill+restart

# 3. Or: pause the HF endpoint from the dashboard (stops billing immediately)
```

## After the demo

```bash
# Pause (saves money but cold-start on resume)
# Just hit "Pause" on the endpoint detail page.

# Or delete entirely if not needed again
# Click "Delete" on the endpoint detail page.
```

a10g-small at min=1 for ~3hr demo = ~$2. Pausing immediately after = stops billing. Don't forget.

## Troubleshooting

- **Endpoint stuck "Initializing" >10 min**: check the endpoint logs tab — probably an OOM or model-download issue. The `bestdealbot-v2` adapter is small (~80MB) but the unsloth base is 16GB; first-time download takes 2-3 min on a10g.
- **`hf_ok: false` with 502/504**: endpoint is up but the handler isn't responding to `/health`. Some HF endpoint container types don't expose `/health` — the actual chat call might still work. Try the smoke test directly.
- **Slow generates (>5s/turn)**: the endpoint is cold or under-provisioned. Bump to `a10g-medium` (more VRAM headroom for kv-cache) or accept the latency.
- **Server returns Hinglish but `buyer_backend == "hf+fallback"`**: the HF call failed and the rule-based fallback (with template Hinglish) kicked in. Check `buyer_error` for the underlying cause — usually unset env-vars or 403.

## Pre-demo checklist

- [ ] Endpoint status: Running
- [ ] `SAUDA_HF_URL` and `SAUDA_HF_TOKEN` exported on demo machine
- [ ] FastAPI server restarted with env-vars in scope
- [ ] `curl /sauda/health` shows `hf_ok: true`
- [ ] One end-to-end smoke through `/seller-mode/reset` confirms `buyer_backend == "hf"`
- [ ] Ollama installed on demo laptop as a fallback (`ollama pull bestdealbot`)
- [ ] Mental note: kill the endpoint after demo to stop billing

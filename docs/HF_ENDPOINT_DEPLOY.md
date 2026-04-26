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
export SAUDA_HF_TOKEN="hf_..."  # token with read access to the model
export SAUDA_BACKEND=hf  # default but explicit

# restart the FastAPI server so it picks up the env-vars
python -m server.app
```

Verify:

```bash
curl -sf http://localhost:8000/sauda/health | python -m json.tool
```

Should return:

```json
{
  "active_backend": "hf",
  "hf_configured": true,
  "hf_ok": true,
  "hf_status": 200,
  ...
}
```

## Smoke test

```bash
curl -sf -X POST http://localhost:8000/seller-mode/reset \
  -H "Content-Type: application/json" \
  -d '{"task":"single_deal","strategy":"sauda","seed":42,"opening_price":60.0}' \
  | python -m json.tool
```

The response should have:
- `buyer_backend`: `"hf"` (not `"hf+fallback"`)
- `buyer_message`: a Hinglish/English line (not empty, not a template)
- `buyer_error`: `null`

If `buyer_backend == "hf+fallback"` and `buyer_error` says `403`, your token doesn't have access to the model. Generate a new token at <https://huggingface.co/settings/tokens> with `read` scope.

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

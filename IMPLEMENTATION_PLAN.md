# Implementation Plan

Honest status and prioritized next steps for BazaarBot.

## Real and working (shipped code)

- **Environment**: 8 tasks, 4 seller personalities, tells system, career mode,
  Amazon listings (1,417 products), counterfactual replay, multi-buyer arena,
  WebSocket streaming. [server/](server/) + [bazaarbot_env/](bazaarbot_env/).
  OpenEnv-compliant.
- **UI**: Next.js app with play/spectate/replay/arena/leaderboard pages.
  [ui/](ui/).
- **Training pipeline**: Kaggle notebook runs SFT → GRPO top-to-bottom.
  [training/train.ipynb](training/train.ipynb).
- **v1 adapter on HF**: https://huggingface.co/PayMyBills/bestdealbot — LoRA
  on Llama-3.2-3B-Instruct, SFT loss 3.0 → 0.21, GRPO 30 steps.
- **Eval harness**: [eval/eval_harness.py](eval/eval_harness.py) — runs
  rule-based / trained / baseline policies against tasks, writes summaries.
  Smoke-tested with rule-based.
- **Submission doc**: [SUBMISSION.md](SUBMISSION.md) — hits all 4 themes.

## Built but untested end-to-end

- **v1 on Ollama locally.** Adapter is on HF but not yet pulled + merged +
  quantized + registered. No local verification the model works outside
  Kaggle.
- **Eval harness with real models.** Works with rule-based policy only.
  `--policy ollama` and `--policy baseline` haven't been run because Ollama
  isn't set up locally.
- **Actual numbers.** No mean_surplus, no deal_rate, no comparison to
  baseline Llama. Submission says "Preliminary Results" section will go
  here — it's empty.

## Not built (planned, called out in submission)

- **Stage 3: LLM-judge-tagged DPO self-improvement loop.** The bullseye
  theme. Explicitly deferred to on-site. This is the differentiated
  contribution — everything before it is table stakes.
- **Judge taxonomy, rollout → tag → repair pipeline, DPO trainer** — none
  exists yet.
- **v2 checkpoint** — can't exist until the judge loop runs.

## Gaps that matter for the submission

1. **No eval numbers in SUBMISSION.md.** Doc promises "v2 beats v1 by ≥10%"
   but gives no v1 numbers. Can't write that credibly without running the
   harness.

2. **Self-improvement loop is pure prose.** Judges will read "planned,
   on-site" and either buy it or not depending on how concrete the plan is.
   A 100-line `judge.py` prototype that demonstrates classify → repair on
   a single transcript makes the plan tangible without requiring on-site
   training.

3. **Agent hasn't been smoke-tested on actual negotiations.** Unknown if
   it's good, bad, or middling. Running 10 negotiations in the Kaggle
   notebook with the trained adapter would tell us in 5 minutes.

## Next steps, ranked

### Fast path to concrete numbers (~1 hour, do before submission)

1. In the Kaggle notebook (same session, adapter loaded), add a 10-episode
   smoke test — play the trained agent against each task type, dump
   transcripts and surplus. No Ollama needed. Gives real v1 performance
   data immediately.

2. Add a baseline comparison cell — swap adapter off (or load base model
   fresh), run same 10 episodes, compare. Tells us if training helped.

### Medium path (~3–4 hours)

3. Write judge prototype: `judge.py` with `classify(transcript) → FailureMode`
   and `repair(transcript, mode) → corrected_action`. Even a hard-coded
   rule-based version demonstrates the interface. Call it once on a real
   transcript to prove it works.

4. Add "Preliminary Results" section to SUBMISSION.md with smoke-test
   numbers.

### Longer path (~6–8 hours, on-site territory)

5. Local Ollama setup + full eval harness runs.

6. Actually implement judge-DPO against a small local LLM.

7. Show one iteration of self-improvement improving a specific failure
   mode.

## Recommended minimum for submission

**Do (1) + (4) today.** 10-episode smoke test in the Kaggle notebook while
the adapter is loaded, then write numbers into SUBMISSION.md. ~30 minutes
total.

**Skip (2), (3), (5), (6), (7) until on-site.** They're right to defer.
The hackathon explicitly says training happens on-site.

The single biggest improvement to the submission is **3 numbers**: v1 mean
surplus on `amazon_realistic`, baseline Llama mean surplus on same,
rule-based mean surplus on same. Converts the doc from "we built a thing
and have a plan" to "we built a thing, measured it, and have a plan."

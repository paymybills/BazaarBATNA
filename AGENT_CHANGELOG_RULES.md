# Agent Changelog Rules

From now on, every AI agent (Codex, Gemini, Claude, etc.) must log edits in the same format.

## Required format (mandatory)

```md
## Agent: <agent-name>
- Timestamp: <ISO-8601 datetime>
- Edit:
  - <what changed (multi-line allowed)>
  - <additional edit detail>
- Scope: <what was touched>
- Files touched: <path1>, <path2>, ...
- Notes: <optional extra context>
```

## Naming rules

1. Use exact agent labels like `codex`, `gemini`, `claude`, or `copilot`.
2. Timestamp must be full ISO-8601 (example: `2026-04-24T01:25:53+05:30`).
3. `Edit` can be multiple lines and should include enough detail for other agents to recover context.
4. `Files touched` is mandatory and must list the concrete file paths.

## Example entries

```md
## Agent: codex
- Timestamp: 2026-04-24T01:25:53+05:30
- Edit:
  - Added negotiation replay controls.
  - Fixed counterfactual request payload.
- Scope: UI behavior + API integration
- Files touched: ui/app/replay/page.tsx, ui/app/lib/api.ts
- Notes: Verified payload matches backend schema.
```

```md
## Agent: gemini
- Timestamp: 2026-04-24T02:10:12+05:30
- Edit:
  - Updated leaderboard rendering.
  - Improved arena status labels.
- Scope: Presentation layer
- Files touched: ui/app/leaderboard/page.tsx, ui/app/arena/page.tsx
- Notes: Kept existing API contract unchanged.
```

## Enforcement

- No free-form logs.
- No missing fields.
- Every edit batch must include one entry in this exact structure.

## Agent: codex
- Timestamp: 2026-04-24T02:36:13+05:30
- Edit:
  - Set up local Ollama `bestdealbot`.
  - Ran benchmark baselines for rule-based, baseline llama, and bestdealbot.
  - Generated fresh evaluation output artifacts.
- Scope: Local model runtime + evaluation outputs
- Files touched: eval/out/results_ollama_bestdealbot.jsonl, eval/out/summary_ollama_bestdealbot.json, eval/out/results_baseline_llama3.2_3b.jsonl, eval/out/summary_baseline_llama3.2_3b.json, eval/out/results_rule_based.jsonl, eval/out/summary_rule_based.json
- Notes: Used GGUF Q8_0 path due to missing local quantizer toolchain.

## Agent: codex
- Timestamp: 2026-04-24T02:48:56+05:30
- Edit:
  - Updated changelog policy to allow multi-line edit details.
  - Replaced `Files` field with mandatory `Files touched`.
  - Removed `Location` requirement from the format.
- Scope: Collaboration/process rules
- Files touched: AGENT_CHANGELOG_RULES.md
- Notes: Updated to improve cross-agent context handoff quality.

## Agent: codex
- Timestamp: 2026-04-24T02:56:02+05:30
- Edit:
  - Implemented Bayesian persuasion steering for buyer actions based on posterior urgency/flexibility from tells.
  - Added adaptive fallback and anti-premature-walk guardrails to increase closing behavior near deadline.
  - Wired steering into Ollama policy evaluation path while keeping baseline policy unsteered.
  - Rewrote README into separate BazaarBATNA Platform and BazaarBot Agent sections.
  - Documented the end-to-end agent creation workflow (SFT -> GRPO -> HF adapter -> local Ollama -> eval harness).
- Scope: Agent policy logic + documentation
- Files touched: bazaarbot_env/gym_wrapper.py, bazaarbot_env/__init__.py, eval/eval_harness.py, README.md, AGENT_CHANGELOG_RULES.md
- Notes: Strategy gating now happens after JSON parse, before env step, so malformed/unsafe actions are normalized consistently.

## Agent: codex
- Timestamp: 2026-04-24T03:06:29+05:30
- Edit:
  - Ran full benchmark pass across rule-based, baseline llama3.2, and bestdealbot policies.
  - Collected metrics for amazon_realistic, read_the_tells, and career_10 with n=20.
  - Updated README with benchmark table and source summary file references.
- Scope: Evaluation + documentation refresh
- Files touched: eval/out/summary_rule_based.json, eval/out/summary_baseline_llama3.2_3b.json, eval/out/summary_ollama_bestdealbot.json, eval/out/results_rule_based.jsonl, eval/out/results_baseline_llama3.2_3b.jsonl, eval/out/results_ollama_bestdealbot.jsonl, README.md, AGENT_CHANGELOG_RULES.md
- Notes: bestdealbot was evaluated through the steered Ollama path in eval_harness.

## Agent: claude
- Timestamp: 2026-04-24T16:58:42+00:00
- Edit:
  - Rewrote IMPLEMENTATION_PLAN.md to reflect full on-site roadmap discussed in session.
  - Added Pillar 1: NLP Tell Extractor + Condition/Depreciation Block (nlp_extractor.py, TellObservation extension, Bayesian steering update).
  - Added Pillar 2: LLM Seller sim opponent (llm_seller.py, drop-in for SellerState.respond()).
  - Added Pillar 3: Synthetic Indian C2C dataset pipeline (generate_indian_negotiations.py, CraigslistBargains + CaSiNo + Deal-or-No-Deal + eBay listings sources).
  - Added Pillar 4: DPO self-improvement loop (judge.py with failure taxonomy, dpo_loop.py with eval gate, v2 checkpoint target criteria).
  - Documented dependency graph, on-site priority order, and files to create/modify.
- Scope: Planning / architecture
- Files touched: IMPLEMENTATION_PLAN.md, AGENT_CHANGELOG_RULES.md
- Notes: Supersedes all prior plan versions. Minimum viable path to v2: Pillar 1 Steps 1.1-1.2 then Pillar 4 — can run DPO against rule-based seller before LLM seller is ready.

## Agent: claude
- Timestamp: 2026-04-24T17:23:05+00:00
- Edit:
  - Created nlp/ directory with __init__.py, extractor.py, fetch_datasets.py.
  - extractor.py: TellExtractor class backed by gemma4:e2b via Ollama. Extracts full TellObservation schema from free text. Dual-path: LLM for urgency/deception/confidence, rule-based fast pass for condition keywords. Hinglish + English few-shots from Chicago HAI and Indian marketplace patterns inline in prompt.
  - fetch_datasets.py: fetches craigslist_bargains, ChicagoHAI/language-of-bargaining, casino. Maps per-turn labels to TellObservation supervision signal. Merges into extractor_supervision.jsonl.
  - Extended TellObservation in bazaarbot_env/models.py with condition_score, depreciation_score, condition_label fields.
- Scope: NLP extraction pipeline (Pillar 1)
- Files touched: nlp/__init__.py, nlp/extractor.py, nlp/fetch_datasets.py, bazaarbot_env/models.py
- Notes: Extractor has a fast=True mode that skips Ollama for use during GRPO rollouts. Rule-based condition override applies when LLM leaves condition_label as unknown.

## Agent: claude
- Timestamp: 2026-04-24T17:25:43+00:00
- Edit:
  - Stitched NLP extractor into environment.py at _tell_to_model() — the single join point between seller output and buyer observation.
  - _tell_to_model() now accepts message + history, calls TellExtractor, blends NLP verbal signals with rule-based body-language tells (55/45 NLP/rule weight for verbal dims, NLP-only for condition).
  - Rule-based non-verbal signals (fidget, posture, eye_contact) unchanged — NLP has no signal for those.
  - Added enable_nlp: bool = False to TaskConfig — off by default so GRPO rollouts don't pay Ollama latency.
  - Added recent_history construction in _handle_offer() for NLP context window.
- Scope: NLP integration into core env loop
- Files touched: bazaarbot_env/environment.py, bazaarbot_env/models.py
- Notes: To enable NLP for a task: task.enable_nlp = True. Extractor failure (Ollama down) silently falls back to rule-based — no crash.

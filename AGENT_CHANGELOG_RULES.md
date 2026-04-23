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

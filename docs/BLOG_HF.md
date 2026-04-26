---
title: "I Spent 24 Hours Teaching An LLM To Haggle In Hinglish And It Tried To Buy A Sofa Eight Times"
thumbnail: /blog/assets/sauda/thumbnail.png
authors:
- user: PayMyBills
- user: ankur-1232
tags:
- hackathon
- rl
- grpo
- dpo
- llama
- negotiation
- openenv
- agents
---

# I Spent 24 Hours Teaching An LLM To Haggle In Hinglish And It Tried To Buy A Sofa Eight Times

> A live-from-the-venue hackathon journal of building **Sauda** — an 8B Llama buyer agent for the OpenEnv hackathon. If you're looking for the responsible engineering write-up, this is not it. At one point Sauda agreed to a price and then five turns later said "27. done?" like that was a normal thing to do. Code: [github.com/paymybills/BazaarBATNA](https://github.com/paymybills/BazaarBATNA) · Models: [`PayMyBills/bestdealbot-v2`](https://huggingface.co/PayMyBills/bestdealbot-v2) · Live demo: [metathon.vercel.app](https://metathon.vercel.app)

> *(Reader, I am writing this between bug fixes. The DPO smoke is on attempt 2 of 30 in another tab. We have not finished. By the time you read this we may have. Or may not have. The blog is being committed in real time alongside the code. Anyway.)*

## the premise

OpenEnv hackathon. Ship a negotiation environment, a buyer that wins it, and a website where humans can play. We have been building this for weeks. We have not been doing it well.

The buyer needed a name. We had been calling it MolBhav. Halfway through Saturday we renamed it Sauda because MolBhav, when said out loud at a hackathon, sounds like a deli sandwich.

The renaming took three commits across the entire codebase including a CSS class and a thinking-beat animation timer. This is foreshadowing. (Most paragraphs in this blog are foreshadowing. You will get used to it.)

## the part where I lie to myself about how hard SFT will be

The plan was the standard RLHF trilogy. SFT to teach the JSON output format. GRPO to push past the rule-based baseline on actual reward. DPO with Claude as judge to polish the prose. We'd been calling it "the trilogy" all week which was our first mistake because trilogies imply you finish them.

I fired SFT on Colab. Loss went from 2.14 down to 0.10. The buyer learned to emit:

```json
{"action": "offer", "price": 32, "message": "32 mein de dijiye?"}
```

I clicked "Run All" on the eval cell.

The model output Korean. Then the model output `gc gc gc gc gc gc gc gc`. Then the model output Korean again. Then it output a beautifully formed JSON object whose `message` field was the string `"gc gc gc gc gc gc gc gc"`.

The fix was in commit `8915f87`: **Fix cell 14: disable gradient checkpointing for generate(), bump max_new_tokens to 128**. Gradient checkpointing was on during inference. KV cache was getting corrupted. `model.gradient_checkpointing_disable()` and `model.config.use_cache = True` and the model produced English again.

This is the kind of bug that, if you have not seen it before, has no business existing. Gradient checkpointing is a *training* optimization. You leave it on to save VRAM during backprop. Why does it affect inference? **It doesn't, except when you forget to turn it off, and then it does, and the model speaks Korean.**

I committed the fix. I committed it again because the first commit was wrong. The second commit was `55d5267: Cell 12: re-enable gradient checkpointing before SFT training (handles re-run after cell 14)` because turning it off for inference broke training the next time you re-ran the cell. **Every fix had a cost.**

> **Lesson from the trenches #1**: SFT is the easiest part of the trilogy. The hard part is everything that depends on inference being fast and stable, which is everything else. The model speaks Korean if you breathe wrong on it.

*(I want to clarify something before we keep going. I said "I" up there. The way I am writing this blog, "I" am one person, the engineer, the protagonist, the chump. In reality there are two of us, plus a hackathon's worth of code, plus a model that is at this exact moment generating text I will need to debug in approximately fifteen minutes. The "I" is a narrative simplification. The bugs are real.)*

There was a brief Kaggle dependency-hell era I will not recap because nobody learns anything from "I rolled back bitsandbytes 0.45.1 because it wanted GLIBCXX_3.4.32 that Kaggle didn't have." We switched to Colab. Onward.

## the seller is a real character now

We had a seller. Gemma-4-E4B with persona prompts. The seller had four hard rules baked into code, not just into the prompt:

1. Never accept below reservation
2. Never leak reservation in messages
3. Counter offers always >= reservation
4. Counter must improve toward buyer

I ran the seller-quality eval. Gemma walked away on round 1. Every episode. 50 walks, 0 deals.

The walk threshold was too aggressive. I fixed it. Now Gemma never walked. Every episode expired at round 8 because the eval buyer plateaued at 74% of ask while reservation was 78%. The buyer was *literally physically incapable* of reaching the price the seller could accept. I fixed that. Now Gemma reached the right offers but still wouldn't say accept — because the LLM doesn't *know* what the reservation is (we don't put it in the prompt; we don't want it leaked). It would just keep countering its way past reservation forever.

Commit `ef753a6: Auto-accept when buyer offer ≥ reservation (LLM doesn't know the floor, would keep countering)`. If the buyer's offer is already above reservation, force `action="accept"`.

Three commits to get the seller to accept a deal. *Three.* The buyer is a whole separate adventure.

*(This is the moment I quietly promise the reader we'll come back to. The buyer's eval numbers were measured against this seller. The seller just got a lot smarter. Hold this thought.)*

The eval ran clean: **5 of 6 metrics passed.** The 6th (`persona_consistency`) is Gemma classifying its own persona from a transcript across four overlapping classes. It scores 38%. The metric is structurally cursed and we ship it anyway because hiding it would be worse.

## the part where notebooks died and HF Jobs took over

Up to here we'd been running everything in Colab notebooks. Open `train_colab.ipynb`, click "Run All", babysit it, restart when the kernel times out, restart when the cell that downloads the dataset 504s, restart when bitsandbytes wants a CUDA driver Colab doesn't have, restart when the runtime decides it's been alive too long and disconnects you mid-step-22 of GRPO and now those step-22 weights are *gone* because you never saved a checkpoint that early.

The math here is brutal. A run takes 45 minutes. A disconnect kills it at minute 30. That's a 30-minute payment for a 0-step result. Do this enough times and your hackathon has fewer hours left than the model has training to do.

I ported everything to **HF Jobs**.

```bash
hf jobs run \
    --flavor l40sx1 \
    --timeout 2h \
    --secrets HF_TOKEN \
    -e MODEL_REPO=PayMyBills/bestdealbot-v2 \
    python:3.11-slim \
    bash -c "$JOB_SCRIPT"
```

That's the entire deploy. The job runs in HF infra, on a 48GB L40S, with `HF_TOKEN` mounted as a secret, and the entire script (`pip install`, `git clone`, run training, push artifacts to a results dataset repo) is one heredoc passed in `bash -c`. No notebook. No browser tab to keep alive. No "you've been disconnected." If my laptop dies, the job doesn't.

The migration unlocked things we couldn't have done in notebooks:

- **Parallel adapters.** I fired v2 GRPO, v2-tells GRPO, and v3 DPO as three separate jobs on three separate flavors at the same time. In a notebook world I'd have run them sequentially over six hours. In HF Jobs world I ran them in parallel and saw all three results within one hour.
- **Reproducible from a fresh container.** Every job starts from `python:3.11-slim` and clones the public repo. There's no "well it worked on my Colab because pip resolved differently." If it works in HF Jobs, it works for the judges.
- **Results dump auto-uploads.** Each job ends with an `HfApi.upload_folder` to a dataset repo (`PayMyBills/scaling-eval-runs`, `PayMyBills/dpo-runs`, etc.). I didn't have to remember to download artifacts before a kernel timeout. The artifacts were *the goal* of the job.
- **Logs are first-class.** `hf jobs logs <job_id>` streams stdout live, and the full log is preserved in the dashboard after the job ends. Notebooks lose the cell output the moment the runtime disconnects.

The migration cost was a Saturday afternoon. Every script in `scripts/run_*_hfjobs.sh` is the same shape: take env-vars, build a heredoc `JOB_SCRIPT`, hand it to `hf jobs run`. We have eight of these now. If we were still on notebooks I'd have shipped maybe two adapters; on HF Jobs I shipped four (v1, v2, v2-tells, v3) plus an SFT-with-tells follow-up that fired *during this blog post*.

There's one annoying edge — the `/whoami-v2` endpoint on the HF API is rate-limited per-account. Submit five jobs in two minutes and the sixth will 429. The fix is "wait six minutes." I learned this the bad way (rapid-fire retries, which makes the limit *worse*), so I'm telling you the easy way: budget your job submits, don't loop them.

> **Lesson from the trenches #N**: Move off notebooks the moment you have more than one experiment to run. The browser-tab-as-runtime model is fine for `print(model.config)`. It is not fine for any process that takes longer than a coffee.

## sauda v1 and the seller that was secretly garbage

A few days ago, before the seller hardening, we ran a Sauda v1 eval. Numbers were beautiful:

```
amazon_realistic: surplus 0.913, deal 1.00, rounds 7.5
```

**91% of available surplus captured.** I screenshotted it. I sent it to my teammate. We celebrated with the seriousness of people who think a single number means anything.

Then I shipped the seller hardening. The seller was no longer leaky. The seller would auto-accept at reservation instead of meandering past it.

I re-ran the eval. **Same buyer (Sauda v2).** **Same task.** Different seller.

```
amazon_realistic: surplus 0.521, deal 0.91, rounds 3.6
```

**Surplus halved.** I had a moment.

I did `git log` on the seller code between the two evals. There was the auto-accept commit, sitting there, undeniable. The buyer wasn't worse. The seller had stopped leaking surplus.

The lower number is the more honest number. The 0.91 was inflated by a leaky seller that didn't enforce its own reservation. The 0.52 is what a buyer captures against a seller that actually plays.

> **Lesson from the trenches #2**: If you fix the opponent mid-experiment, every old number is now a different benchmark. Tag the eval with the opponent's git SHA. Better yet, snapshot the opponent into a versioned model file. Otherwise your old screenshots are lying to you and you don't know they're lying because they're *your* screenshots.

We left both numbers in the README. The full story is more interesting than either number alone. We also added a section called "the amazon_realistic regression" which is just a `git log -p bazaarbot_env/llm_seller.py af7b31d..HEAD` and a paragraph explaining what happened.

*(I told you we'd get to this moment. We are now at this moment. The buyer looked like a genius. The seller had been broken. The seller is fixed. The buyer is still good — just less of a genius. This is fine. This is research. Hello again, dear reader.)*

## the dpo pipeline that almost worked seven times

This is where it gets stupid.

The plan was preference pairs. Roll out the buyer twice on the same scenario at different temperatures, have Claude judge which transcript negotiated better, train Sauda v3 on the (chosen, rejected) pairs.

Claude was busy when I needed it most. The fix was a heuristic fallback. The heuristic fallback had been written six weeks ago and never actually tested against real transcripts. Foreshadowing #2.

*(The blog you are reading currently has more foreshadowing than payoff. This is because the payoff hasn't happened yet — the DPO smoke is still running. If you have come back to this blog later and the ending has changed, that is why. The story is being lived.)*

### Smoke v1: the silence

I fired the smoke. The job ran for 38 minutes producing **zero output**. No `[1/10]` progress lines. No errors. Nothing. Just `Building 10 DPO pairs (judge: Claude-as-judge if ANTHROPIC_API_KEY set, else heuristic)` and then 38 minutes of nothing.

I started panicking. I opened a second terminal to check `nvidia-smi` on the HF Job. I couldn't. HF Jobs don't expose `nvidia-smi`. I opened a third terminal to check the HF dashboard. The job was using GPU. The job was producing no output. The job was, in some sense, *silently winning*.

Diagnosis: Python's stdout is full-buffered (not line-buffered) when stdout isn't a tty. HF Jobs runs without a tty. Every `print()` was sitting in a 4KB buffer waiting for the process to exit. The job was *fine*. It was running attempts. It just couldn't tell us.

Commit `2728bf7: Force unbuffered stdout in HF Jobs scripts`. Added `python -u`. Added `flush=True` to every print I cared about. The job had been working the entire time. It just couldn't tell anyone.

### Smoke v2: gated repo (the warm-up)

The HF token in the job container didn't have Llama 3.1 license access. The token I'd done the original SFT on did, on a different account. Switched to `unsloth/Meta-Llama-3.1-8B-Instruct`, an ungated public mirror with byte-identical weights. The adapter loaded on top fine because PEFT cares about architecture, not repo name.

This was the easy bug.

### Smoke v3: the EOS bug, oh my god the EOS bug

Smoke v3 fired. Buyer started generating. I watched the timestamps:

```
9:31:20 → first generate
9:31:50 → +30s
9:32:20 → +30s
9:32:50 → +30s
9:33:20 → +30s
9:33:51 → +31s
```

**Thirty seconds per generate.** A buyer turn at `max_new_tokens=64` on A10G should take 2-3 seconds. Something was forcing the model to produce all 64 tokens every time instead of stopping at end-of-message.

I stared at this for 45 minutes. Then it hit me.

Llama-3.1-Instruct emits `<|eot_id|>` at end-of-turn. The default `eos_token_id` from the tokenizer is `<|end_of_text|>`. When you pass chat-template input, the model wants to emit `<|eot_id|>` to mean "I'm done with my turn." Then `generate()` checks: "Did the model emit `eos_token_id`?" The answer is no, the model emitted `<|eot_id|>`. They are different tokens. `generate()` keeps going. **For all 64 tokens.** Every. Single. Call.

Commit `b3e7dca: Fix critical generation hang: pass turn-boundary tokens as eos_token_id`. Explicitly pass `eos_token_id=[<|end_of_text|>, <|eot_id|>, <end_of_turn>]`. The third one is for Gemma which has the same bug but with a different token.

The fix took our generates from 30 seconds to 3 seconds. **Two orders of magnitude.** The kicker: this bug had been silently halving our eval throughput on every previous run. *Every* previous run. The 50-episode seller eval that took 5 hours? It was supposed to take ~30 minutes. We had been bleeding compute for weeks and we had no idea.

I sat there. I thought about every wall-clock estimate I had given my teammate in the past month. They were all off by 10x.

*(If you remember nothing else from this blog, remember this section. This is the most important paragraph. This is the paragraph where, if it lands for one person, the blog has paid for itself. `eos_token_id` as a list. Pass it. Today.)*

> **Lesson from the trenches #3**: Modern instruction-tuned models have multiple end-of-turn tokens. The default tokenizer config does not always wire them all in. If your generation runs to `max_new_tokens` every time, this is your bug. Pass `eos_token_id` as a list. Now. Today. Before reading the next paragraph of this blog.

### Smoke v4: 4-bit is slow

After EOS, generates were 10s each. Still too slow. We were loading the buyer in 4-bit because that's the default everyone uses to fit small GPUs. But we were on a10g-large with 80GB of VRAM and an 8B model in bf16 fits in 16GB with massive headroom. The 4-bit dequant step on every forward pass adds latency that compounds across 200 generates per pair. Switched to bf16. Generates dropped to 3s. Moving on.

### Smoke v5: the judge that judged everything as a tie

I fired smoke v5. Logs streamed in real-time now. Beautiful. They said:

```
attempt 1: persona=flexible listing=Kitchen Hutch
    tie (Both rollouts failed to close.) — skipping
attempt 2: persona=default listing=Lee Sofa and Loveseat - Gorgeous
    tie (Both rollouts failed to close.) — skipping
attempt 3: persona=firm listing=2013 Hyundai Elantra GLS 4dr Sedan Gas S
    tie (Both rollouts failed to close.) — skipping
[...30 more attempts, all ties, all "Both rollouts failed to close."]
```

Zero pairs produced.

I traced into `_heuristic_compare` in `eval/judge.py`. The function looked for `role == "buyer" and action == "accept"` to find the agreed price.

In our negotiation flow, **the seller usually accepts.** The buyer keeps offering until the seller's reservation is hit, then the *seller* says accept. The buyer almost never says accept. The judge was looking for a thing that almost never happens, finding it didn't happen, returning `None`, and the comparator was returning "tie" for everything.

The heuristic had been written six weeks ago. It had never been tested against a real transcript. We had been using Claude every other time which is more expensive but smarter and Claude doesn't care which side accepts because Claude can read.

Commit `f496128: Fix heuristic judge: recognise either side's accept + soft tiebreak`. Made `share()` accept either side's accept. Added a soft tiebreak: if neither rollout closes, rank by who pushed the seller's final counter lower.

> **Lesson from the trenches #4**: Write your fallbacks against real data. Specs lie. Specs say "the buyer accepts the deal." Real data says "the seller accepts because the buyer's offer hit reservation and the LLM seller doesn't know to reach for the accept action."

### Smoke v6 onwards: the part where I started this blog

I'll skip v6 (a `echo $X | while read` shell-trivia bug that ate an hour and isn't worth re-living) and v7 (cancelled before it produced anything useful).

By midnight Saturday I had cancelled four DPO smokes and re-fired three. The HF Jobs dashboard showed `69ecdc20`, `69ece351`, `69ece4b0`, `69ece6a5`, `69ecef4c`, `69ecf12e`, `69ecf269` — all cancelled, all my fault.

We pivoted. **Sauda v2 is on HF. The seller-quality eval is solid. The env works. v3-dpo is gravy.**

I redirected the night's compute to an overnight scaling-ladder eval and a tells ablation. Both completed. Real numbers below.

## the ablation that disproved my own hypothesis

We had built an entire "tells" channel. Keyword pattern matcher mining urgency/deception cues from seller messages. Bayesian steering that adjusts the buyer's price downward when deception confidence is high. Ministral as an alternate extractor. Templates with register escalation. Half a week of work.

The ablation was supposed to be a victory lap. Run Sauda v2 with tells ON, run Sauda v2 with tells OFF, show the gap.

Here is the gap:

| Buyer | Tells | single_deal | asymmetric | amazon | **Mean** | Deal | Rounds |
|---|---|---|---|---|---|---|---|
| Llama-3.2-3B base | ON | 0.722 | 0.731 | 0.258 | **0.570** | 1.00 | 2.2 |
| Llama-3.1-8B base | ON | 0.818 | 0.787 | 0.430 | **0.678** | 0.99 | 3.1 |
| **Sauda v2 (SFT+GRPO)** | OFF | 0.835 | 0.827 | 0.521 | **0.728** | 0.91 | 6.0 |
| **Sauda v2 (SFT+GRPO)** | **ON** | 0.810 | 0.768 | 0.507 | **0.695** | 0.88 | 6.0 |

Tells ON: **0.695**.
Tells OFF: **0.728**.

The tells channel makes it **slightly worse on every single task**. I built it. I am proud of it. It is mathematically wrong.

I sat with this for a few minutes. Then I laughed. Then I wrote this paragraph.

There are honest reasons this could be:
1. The rule-based pattern matcher fires on weak signals (every "last one I have" gets flagged as deception) and the Bayesian steering amplifies that into bad price adjustments.
2. Sauda was never trained *with* tells in-loop. The buyer doesn't know how to use the channel because nothing in training told it the channel was meaningful. The channel is inference-time-only.
3. n=30 per task. The 1-6 percentage point deltas could be noise.

**I am not going to bury this result.** The whole point of an ablation is to be willing to be wrong. Future work: train Sauda *with* tells in-loop. Until then, the headline finding is "we built a feature that doesn't help" and that is fine because we *measured* it instead of assuming.

> **Lesson from the trenches #5**: If you don't test the feature, the feature works. If you test the feature, sometimes the feature does not work. Test the feature. The feature not working is the second-best outcome because you can fix it.

## the arena: in which a 3B model paid full asking price three times in a row

The arena is a side feature where four buyers — Aggressive (rule), Smart heuristic (rule), Llama-3.2-3B (prompted base), Bestdealbot (Sauda v1) — bid on the same listing and we watch how each closes. We pre-computed three scenarios as a static demo because running four LLMs concurrently doesn't fit in one A10G.

Running them offline to fill the demo, I watched Llama-3.2-3B do something I had not seen a model do before. Round 1, listing at ₹40,000, seller reservation ₹32,000:

- Aggressive offers ₹22,000.
- Smart heuristic offers ₹26,000.
- Bestdealbot (v1) offers ₹24,500.
- **Llama-3.2-3B offers ₹28,000.**

Round 2, seller counters at ₹36,000:

- Aggressive walks.
- Smart heuristic counters at ₹30,000.
- Bestdealbot counters at ₹28,000.
- **Llama-3.2-3B accepts at ₹36,000.**

Two rounds. No real negotiation. Llama paid ₹4,000 above seller reservation when every other buyer in the arena was trying to push *under* it. I checked the next two scenarios. Same pattern. Llama accepted in round 2 of the scooter shootout (₹55,000 vs Bestdealbot's ₹52,500 final offer). Llama accepted in round 2 of the dining-table bid (₹360 vs reservation ₹310).

**Three scenarios. Three near-instant accepts.** This is what a base model does on a negotiation task: it treats "be agreeable" as the dominant strategy because the prompt asks it to be a buyer and "yes" is what helpful assistants say to buyers. There is no concept of bargaining surplus. There is no concept of reservation. There is only the chat trained into the weights, and the chat says: come to an agreement.

This is also, incidentally, why the scaling ladder is interesting. The 8B base model in the same arena pushes back more than the 3B. Sauda — which was *trained* on the env's reward signal — pushes back more than the 8B. **The training is doing real work; you can see it in how often the buyer says "no."**

The arena's per-buyer trace strip on `/arena` was originally rendering all four buyers' bars at the same length, which made the "Llama capitulated in round 1" beat invisible. We fixed it: a buyer's bar now visibly ends at the round it accepted or walked, with a small marker on the exit segment. Now you can see the capitulation at a glance, the way it played out for me when I ran it offline at 2am and laughed.

## the buyer that walked back its own agreement

This is the part where I want to introduce you to a real Sauda v2 transcript I pulled from the eval results. Episode 3 of `single_deal`. Ground truth: budget=100, seller cost=21, asking=60. Sauda v2 with tells off, temperature 0.7. Read this:

```
seller: Seller opens: "60 rupees for this handwoven silk scarf. Very fair."
buyer:  thoda kam karo, 39 pe finalize?
seller: Seller: "54 rupees. That's my best offer."
buyer:  35 sahi rate lagta hai mujhe
seller: Seller: "Okay, 48. But that's the limit."
buyer:  31 chalega bhai?
seller: Seller: "I can do 42. Not lower."
buyer:  27 chalega bhai?
seller: Seller: "Okay, 36. But that's the limit. This is the last one I have."
buyer:  honestly, 30 is what comparable listings go for
seller: Seller: "I can do 32. Not lower. Someone else was looking at this earlier..."
buyer:  32 mein de dijiye?
seller: Seller: "I can do 32. Not lower."
buyer:  okay 27 — bas yahi ceiling hai
```

Read it again. Slow.

Turn 12: buyer says "**32 mein de dijiye?**" which is "give it for 32?" — *agreeing to the seller's price of 32.*

Turn 13: seller says "I can do 32." — *also agreeing.*

Turn 14: buyer says "**okay 27 — bas yahi ceiling hai**" — *no longer agreeing. Now offering 27. Saying 27 is the ceiling. Five rupees lower than the deal that was just made.*

This is a buyer that **agreed to a deal and then forgot it agreed and counteroffered itself five rupees lower.**

I love this transcript. I am also slightly afraid of it.

The fix is well-understood: the buyer's `format_observation` only gives current-round state, not full chat history. The buyer is generating fresh each turn with no memory of the agreement message it just made. The agreement was prose; prose got sent over the wire; prose did not get fed back into the next-turn obs.

We did not fix this. It is on the future-work list. The transcript is going in the README as Exhibit A.

> **Lesson from the trenches #6**: A buyer with no memory will agree, walk away, and re-agree on every turn. This is not negotiation. This is goldfish theater. Pipe the last 2-3 turns into the obs. Or train the buyer on multi-turn coherence as a metric. Or both.

## what exists right now (as I type this)

*(Time check, dear reader: it is the second day. The DPO smoke is still running. The HF Jobs dashboard says attempt 2 of 30 with the upgraded judge. I refresh it every fifteen minutes like a person checking a stock ticker. We have not finished. The list below is what is on HF and in this repo at the moment of typing. By the time you read this it may be longer. It will not be shorter.)*

1. **OpenEnv-compliant FastAPI environment** with three negotiation tasks and seller personas. `/reset`, `/step`, `/state`, `/score`. Standard.
2. **Sauda v2 buyer adapter** — Llama-3.1-8B + QLoRA SFT + GRPO. On HF: `PayMyBills/bestdealbot-v2`. Loads in 16GB bf16 or 5GB 4-bit.
3. **Seller-quality 50-episode eval** — 5/6 acceptance criteria pass. Uploaded to HF dataset with full transcripts.
4. **Scaling-ladder eval** — 3B base / 8B base / Sauda v2 across three tasks, 30 episodes each. Sauda wins. Numbers above.
5. **Tells ablation** — surprising negative result. Reported honestly. To be revisited.
6. **Live buyer endpoint** wired to the `/sell` page with HF Inference Endpoint (primary) + Ollama (fallback) backends. The `/sauda/health` endpoint probes both. The `/sauda/backends` endpoint feeds the UI dropdown.
7. **DPO pipeline** scaffolded — `eval/build_dpo_pairs.py`, `eval/judge.py`, `training/v2/dpo.py`, `scripts/run_dpo_hfjobs.sh`. Smoke validates each stage. Reproducible with one command. Has not produced a v3-dpo adapter at the moment of typing because attempt 2 of 30 is still running. *(Refresh.)* Still attempt 2.

The website does not crash on `/replay` anymore (commit `761fed8: Fix /replay crash: defensive optional chaining for state.offer_history / tells_history`). This was a six-line fix. It took me three hours to find because I assumed the bug was in the rendering and it was actually in the data shape because we had renamed a field two weeks earlier and not propagated.

## what is happening right now

Two DPO jobs are running in parallel — the smoke I fired this morning on `a100-large` after the first run lost its rollouts, and a real run on `l40sx1` that I queued an hour later after I figured out the queue trick. The smoke validates the new per-pair upload logic. The l40sx1 actually produces an adapter. Both write to different output repos so they cannot collide. The HF Inference Endpoint for the live `/sell` buyer needs to be deployed before judges arrive — that is a click-through I am about to do, and if I forget, the page falls back to the Ollama path on my laptop, which works but ties the demo to my laptop staying awake. Also: the README needs a final pass to incorporate the scaling-ladder table and the tells-ablation result. Also: I need to stop writing this blog and go do that.

*(I will come back to this section when the day is done. There will be more rows in the "what exists" list. There will probably also be more bugs. The blog will grow downward, like a lazy plant. Bookmark this paragraph if you want to know when I'm back.)*

## the day two scoreboard

*(We are now in the final two-hour stretch. I am writing this paragraph between refreshes of two HF Jobs dashboards, which is a thing I have started doing without irony.)*

Day two opened with a number I had been chasing for a week. Sauda v2 — 8B, our fine-tune — beat Llama-3.1-8B base by **7.4% mean surplus** across the scaling ladder. Same seller, same seeds, same tasks, n=30 each. 0.678 → 0.728. The amazon task, the brutal one where the seller refuses below MSRP, more than doubled from the 3B base (0.258) to us (0.521). I screenshotted the table and stared at it for a minute. Numbers were on the correct side of the inequality. The training had taken.

Forty minutes later the same day, I lost four hours of DPO rollouts to a four-character bash typo. The script that uploads the pairs file reads `${BUYER_MODEL}` in a commit message. There is no `BUYER_MODEL`. There is `BUYER_BASE`. With `set -eu`, the unbound expansion killed the script *immediately after* the rollout finished and *before* the pairs file uploaded. Four hours of rollouts existed only inside the container's ephemeral disk. The container shut down. The pairs went with it.

```
+ PAIRS_COMMIT_MSG=pairs built from  vs google/gemma-4-E4B, n=30
$BUYER_MODEL: unbound variable
```

The fix took eight minutes once I figured out it was supposed to be nothing. Then I rewrote the rollout loop to flush the JSONL and `HfApi.upload_file` after *every accepted pair*, wrapped in try/except so a future failure can't cascade. The next time a job dies, the pairs survive.

> **Lesson from the trenches #7**: Upload incrementally. The pairs file should hit HF after every accepted pair, not after the loop terminates. If the script crashes, the pairs survive.

## the rewrite that paid for itself a day later

Smoke job this morning, 6am, fired to validate the per-pair upload. It crashed. But — and this is the part I want to underline — it crashed at *a different line*. TRL changed `DPOConfig` between versions and `max_prompt_length` no longer exists. I found that out by error message instead of by losing more rollouts, because the pairs from that smoke are already on HF, mirrored every time a pair was accepted, sitting in `ankur-1232/dpo-pairs-smoke` waiting for a rerun. The setback from yesterday paid for the recovery today. The next rerun is `SKIP_PAIR_BUILD=1` and one minute of compute away.

Then I tried to fire the real DPO on the most overkill maxxed-out GPU I could find. Typed `h100`. Got `Error: Invalid value for '--flavor': 'h100' is not one of …`. Typed `a100-large`. Job sat in SCHEDULING for twenty minutes. While it waited, I fired a parallel job on `l40sx1` — 48GB VRAM, runs 8B comfortably, half the price of an a100, and the queue was empty because nobody fights for the L40S. **It started RUNNING in 30 seconds.** The a100-large finally moved to RUNNING right as the l40sx1 was already five minutes in. As I type this, the l40sx1 is on attempt 4 of 6 rollouts. The pairs are uploading every time the judge accepts one.

> **Lesson from the trenches #8**: Hardware availability is a function of brand recognition. Pick the unfashionable card. The L40S has the same VRAM as you need and none of the queue.

## the bug I caught by playing my own demo

*(While the DPO jobs run, I am playing the live `/sell` page myself. This is what catches the bugs the eval suite doesn't.)*

I sent Sauda an offer of 175 on an item it had counter-offered at 140 on. I added "im sorry 170 and im making a loss, theres 3 other offers that ive got" — pressure plus a deception bluff plus a sympathy push, the trifecta. Sauda replied with **139**.

A buyer that *decreases* its own offer mid-negotiation is incoherent. I had a monotonicity guard for exactly this. The guard was running. The buyer still went 140 → 139. The bug was on the line *after* the bump:

```python
steered_price = min(ceiling_offer, own_last_offer + bump)
```

`ceiling_offer` can fall below `own_last_offer` when the seller raises ask. The `min()` drags us *back* to `ceiling_offer`. I had protected the model from retreating but not the ceiling from retreating, which turns out to be the same thing in different clothing. One-line fix:

```python
target = max(own_last_offer, min(ceiling_offer, own_last_offer + bump))
```

Reload, replay the same line, Sauda holds at 140. Twelve minutes from "huh" to "fixed and pushed." This is the bug the judges would have seen on the live demo. They will not see it now.

> **Lesson from the trenches #9**: When you write a guard, the invariant is the floor of the new value, not the input to a clamp. `max(invariant, …)` is the shape. The day ceiling < floor — and there is always such a day — order matters and the guard fails silently.

Same negotiation, second bug, found in the same minute. The "What Sauda reads" panel lit up with zeros even though I had just typed "3 other offers that ive got" — a textbook deception cue. The pattern file had ten regexes for deception, including the gold-standard CaSiNo cue `\bteen\s+aur\s+log\b`. What it didn't have: the same thing in English with digits. Or "making a loss." The corpus I'd hand-curated was Hinglish; the demo I was playing was English. Three new regexes for English numeric deception, three for sympathy-urgency, curl `/highlight` against my exact sentence:

```json
{ "spans": [
    { "text": "im making a loss", "signal": "urgency",   "score": 0.55 },
    { "text": "3 other offers",   "signal": "deception", "score": 0.75 }
] }
```

Bars light up red and orange. The demo got meaningfully more impressive in the time it took to write three regexes — and again, this is a bug the judges would have hit and now will not.

> **Lesson from the trenches #10**: Patterns mined from a dataset cover the dataset's distribution, not the user's. Test against your own typing. Especially if the dataset is one language and the demo runs in another.

## the bonus that didn't math

The `/sell` page told the human seller "you earn $1 per $1k above your reservation, capped at $10." Direct port from the Chicago HAI / Kellogg study brief. Kellogg's study used houses. Mine uses Craigslist hat racks. A $399 listing with a $311 reservation has an $88 gap. You cannot earn $1-per-$1k of $88. The bonus structure was mathematically unreachable on every listing in the catalog and I had not noticed in a week of testing because I was always running the buyer side and never reading the seller brief.

Caught it before any judge did. Three lines of TypeScript later: $1 per $10 above reservation, capped at 10% of (ask − reservation). Same hat rack now has a $9 max bonus, hit at the asking price, linear payouts in between. The spirit of Kellogg with the scale of Craigslist. The seller brief now reads like a real game with real stakes.

> **Lesson from the trenches #11**: When you port an experimental setup across domains, port the *structure* and re-derive the *parameters*. Kellogg's $1-per-$1k was tuned for $200k transactions. Yours is $200.

## what's actually on HF, and what isn't yet

Stepping back. The wins are the durable ones, the kind a judge can verify by clicking a link, not the kind I have to talk them into believing.

The OpenEnv environment is a running Docker Space at `PayMyBills/BazaarBATNA`. `/reset`, `/step`, `/state`, `/score`, `/tasks`, `/health` all respond. The Sauda v2 adapter is at `PayMyBills/bestdealbot-v2`, including a `last-checkpoint/trainer_state.json` with the full 30-step GRPO log_history — loss, reward, entropy, grad_norm, every step. Anyone can `curl` it. The scaling-ladder eval with the 7.4% win is in `PayMyBills/scaling-eval-runs` with full transcripts. The seller-quality eval — 5 of 6 acceptance criteria pass — is in `PayMyBills/seller-quality-runs`. The tells ablation is reported honestly as a negative result and kept in the codebase as substrate for future in-loop training. Two training notebooks live at `training/train_colab.ipynb` (SFT+GRPO) and `training/dpo_colab.ipynb` (DPO/RLAIF).

The DPO v3 adapter does not exist yet. The `l40sx1` job will produce it when its rollouts finish and we rerun the trainer with the patched `dpo.py` and `SKIP_PAIR_BUILD=1`. The pairs are durable. The compute is one minute. The path from here to a v3 adapter is short and the script is debugged. We will or will not get there before the deadline. Either way, the v2 result is the headline and the v2 result is locked in.

## the running lessons list

The eleven numbered lessons above are the ones that survived editing. There were eighteen at one point. Several of them turned out to be variations on the same lesson, or just shell trivia that wasn't worth a quote block. These eleven are the ones I would still hand to past-me at the start of the project:

- **#1** — SFT is the easiest part of the trilogy. Inference is where the bugs live.
- **#2** — Pin the opponent. Snapshot the seller. Otherwise old screenshots lie about a different game.
- **#3** — Modern instruction-tuned models have multiple end-of-turn tokens. Pass `eos_token_id` as a list.
- **#4** — Write your fallbacks against real data. Specs lie about which side accepts.
- **#5** — Test the feature. The feature not working is the second-best outcome because you can fix it.
- **#6** — A buyer with no memory will agree, walk away, and re-agree on every turn. Multi-turn coherence is a training objective, not a runtime hope.
- **#7** — `set -eu` + heredoc + typoed variable + four-hour computation is a configuration the universe will exploit. Upload incrementally; let crashes be cheap.
- **#8** — The cool GPU has a queue. Pick the unfashionable card with the same VRAM and start training while the rest of the world waits for `a100`.
- **#9** — A guard is `max(invariant, …)`, not a clamp. `min(ceiling, max(floor, x))` ≠ `max(floor, min(ceiling, x))` the day ceiling < floor — and there is always such a day.
- **#10** — Patterns mined from a dataset cover the dataset's distribution, not the user's typing. Curl your own endpoints against the sentences you would actually write.
- **#11** — When you port an experimental setup across domains, port the structure and re-derive the parameters. Kellogg's $1-per-$1k assumes the transaction is a house.

There are also smaller diagnostic shorthands the project taught me — when the model speaks Korean it's gradient checkpointing during inference, when the heuristic returns "tie" thirty times in a row it's the heuristic, when the seller walks on round 1 the walk threshold is too low, when the buyer offers $139 after offering $140 you have a `min(ceiling, …)` where you wanted `max(own_last_offer, …)` — but those are tips, not lessons.

---

*Cost so far: ~$25 of HF Jobs across the smoke debugging plus the overnight evals plus the seller-quality eval plus the DPO pipeline that is still running in another tab. Out of $90 team budget. **We came in under budget. We came in over expectation. The mistakes were the cheap part. The wins are on HF.***

*Sauda v2 accepts 91% of the deals it should have, walks 9% it shouldn't have taken, beats Llama-3.1-8B base by 7.4% mean surplus across three negotiation tasks, and once told a seller "32 mein de dijiye?" before saying "okay 27 — bas yahi ceiling hai" five turns later. We're still investigating those five turns. We suspect goldfish theater. **We're going to fix it next.***

*Reader: I am closing this tab now and going back to work. There is a website to wire, an endpoint to deploy, a smoke to babysit. I will be back. Probably with another section, possibly with another lesson. The post will keep growing for as long as the build does.*

---

## Appendix: live logs from the shipped artifacts

Everything below was fetched live from HF when this section was last updated. The same data, re-pullable on demand, is in [`training/train_colab.ipynb`](https://github.com/paymybills/BazaarBATNA/blob/main/training/train_colab.ipynb) (last cell — re-run to refresh).

### Sauda v2 (PayMyBills/bestdealbot-v2) — GRPO trainer_state

Source: `https://huggingface.co/PayMyBills/bestdealbot-v2/raw/main/last-checkpoint/trainer_state.json`

<details><summary>Per-step log (30 steps)</summary>

`global_step=30`, `epoch=0.2344`

| step | loss | reward | entropy | grad_norm | step_time(s) |
|---:|---:|---:|---:|---:|---:|
| 1 | 0.0108 | 0.9663 | 0.5101 | 1.9922 | 92.90 |
| 2 | -0.0484 | 0.9505 | 0.3398 | 1.9219 | 84.76 |
| 3 | 0.0000 | 0.8173 | 0.4465 | 2.0469 | 86.37 |
| 4 | 0.0422 | 0.9142 | 0.4206 | 1.8828 | 84.81 |
| 5 | 0.0829 | 0.6129 | 0.3950 | 1.5234 | 101.71 |
| 6 | 0.0169 | 0.9624 | 0.4080 | 1.8047 | 86.69 |
| 7 | -0.0000 | 0.9623 | 0.4106 | 1.0703 | 87.05 |
| 8 | -0.0000 | 0.9268 | 0.4037 | 0.9062 | 85.77 |
| 9 | -0.0001 | 0.9522 | 0.4373 | 1.4062 | 85.23 |
| 10 | -0.0285 | 0.9721 | 0.3893 | 1.5938 | 86.71 |
| 11 | 0.0412 | 0.9912 | 0.3145 | 1.2031 | 82.25 |
| 12 | -0.0056 | 0.9723 | 0.3521 | 1.4922 | 83.60 |
| 13 | 0.0286 | 0.9403 | 0.3954 | 1.7266 | 84.21 |
| 14 | 0.0183 | 0.9652 | 0.4058 | 1.1953 | 85.33 |
| 15 | -0.0174 | 0.9903 | 0.3609 | 1.2266 | 84.16 |
| 16 | 0.0176 | 0.9826 | 0.3188 | 1.2188 | 82.14 |
| 17 | 0.0117 | 0.9252 | 0.3919 | 1.8203 | 85.88 |
| 18 | 0.0239 | 0.9780 | 0.3903 | 1.3438 | 81.95 |
| 19 | -0.0357 | 0.9056 | 0.5992 | 2.1250 | 88.51 |
| 20 | 0.0339 | 0.9680 | 0.4206 | 1.4375 | 87.49 |
| 21 | -0.0072 | 0.9828 | 0.3704 | 1.1094 | 82.83 |
| 22 | -0.0118 | 0.9939 | 0.3437 | 2.2656 | 84.94 |
| 23 | 0.0168 | 0.9879 | 0.3804 | 0.8555 | 83.03 |
| 24 | -0.0243 | 0.9733 | 0.4343 | 3.3125 | 86.76 |
| 25 | -0.0287 | 0.9238 | 0.5656 | 2.5000 | 87.01 |
| 26 | 0.0408 | 0.9347 | 0.4831 | 2.0156 | 87.03 |
| 27 | 0.0124 | 0.9662 | 0.3714 | 1.8984 | 83.76 |
| 28 | -0.0218 | 0.9588 | 0.3851 | 2.2500 | 88.16 |
| 29 | -0.0652 | 0.7400 | 0.5394 | 2.8906 | 90.64 |
| 30 | 0.0220 | 0.9695 | 0.4199 | 1.5391 | 87.23 |

</details>

### Sauda v2-tells (ankur-1232/bestdealbot-v2-tells) — GRPO trainer_state

Source: `https://huggingface.co/ankur-1232/bestdealbot-v2-tells/raw/main/last-checkpoint/trainer_state.json`

<details><summary>Per-step log (30 steps)</summary>

`global_step=30`, `epoch=0.4688`

| step | loss | reward | entropy | grad_norm | step_time(s) |
|---:|---:|---:|---:|---:|---:|
| 1 | -0.0000 | 0.1566 | 0.4195 | 2.0000 | 6.05 |
| 2 | 0.0000 | 0.1633 | 0.4922 | 1.7578 | 5.37 |
| 3 | 0.0000 | 0.1935 | 0.3481 | 2.1250 | 5.22 |
| 4 | -0.0000 | 0.1614 | 0.5797 | 4.0312 | 5.40 |
| 5 | 0.0000 | 0.1441 | 0.5450 | 1.6484 | 5.41 |
| 6 | 0.0000 | 0.2316 | 0.4580 | 4.1250 | 5.21 |
| 7 | 0.0000 | 0.6093 | 0.3999 | 1.6875 | 5.32 |
| 8 | -0.0000 | 0.6471 | 0.4038 | 5.8125 | 5.25 |
| 9 | 0.0000 | 0.5744 | 0.4794 | 1.1719 | 5.40 |
| 10 | 0.0000 | 0.6410 | 0.4240 | 3.4375 | 5.25 |
| 11 | 0.0000 | 0.6320 | 0.4808 | 1.7578 | 5.23 |
| 12 | -0.0000 | 0.6625 | 0.4151 | 2.4375 | 5.23 |
| 13 | -0.0000 | 0.9854 | 0.4166 | 3.3281 | 4.91 |
| 14 | -0.0000 | 0.4863 | 0.5517 | 2.5781 | 5.32 |
| 15 | -0.0000 | 0.6238 | 0.3445 | 1.7969 | 5.23 |
| 16 | 0.0000 | 0.6014 | 0.4196 | 3.0625 | 5.24 |
| 17 | -0.0181 | 0.6164 | 0.3518 | 4.5312 | 5.29 |
| 18 | -0.0087 | 0.4538 | 0.5380 | 2.5938 | 5.45 |
| 19 | 0.0000 | 0.2603 | 0.4901 | 1.6328 | 5.40 |
| 20 | -0.0000 | 0.3358 | 0.4329 | 3.9062 | 5.49 |
| 21 | 0.0000 | 0.6137 | 0.5690 | 3.0000 | 5.43 |
| 22 | -0.0000 | 0.9688 | 0.3361 | 3.2656 | 4.69 |
| 23 | 0.1632 | 0.6735 | 0.3766 | 4.3750 | 7.68 |
| 24 | 0.0000 | 0.9544 | 0.4887 | 1.7656 | 5.10 |
| 25 | 0.0000 | 0.9936 | 0.4175 | 0.8750 | 4.95 |
| 26 | 0.0000 | 0.9913 | 0.3346 | 1.3750 | 4.88 |
| 27 | 0.0000 | 0.1989 | 0.4355 | 1.1719 | 5.51 |
| 28 | 0.0000 | 0.5411 | 0.5218 | 2.8281 | 5.33 |
| 29 | -0.0000 | 0.9647 | 0.3337 | 2.9062 | 4.90 |
| 30 | 0.0000 | 0.9060 | 0.4553 | 1.3125 | 5.08 |

</details>

### Sauda v3 (ankur-1232/bestdealbot-v3) — DPO config

Source: `https://huggingface.co/datasets/ankur-1232/dpo-runs/resolve/main/20260426_095235_dpo_8b/config.json`

```json
{
  "base_model": "unsloth/Meta-Llama-3.1-8B-Instruct",
  "sft_adapter_dir": "",
  "sft_hf_repo": "PayMyBills/bestdealbot-v2",
  "pairs_path": "data/dpo_pairs.jsonl",
  "repo_id": "ankur-1232/bestdealbot-v3",
  "beta": 0.1,
  "lr": 5e-06,
  "epochs": 1,
  "max_length": 1024,
  "seed": 0,
  "git_sha": "65e54a1",
  "argv": [
    "training/v2/dpo.py"
  ]
}
```

### Sauda v3 — DPO summary

Source: `https://huggingface.co/datasets/ankur-1232/dpo-runs/resolve/main/20260426_095235_dpo_8b/summary.json`

```json
{
  "train_runtime": 6.3588,
  "train_samples_per_second": 0.944,
  "train_steps_per_second": 0.157,
  "total_flos": 463433495003136.0,
  "train_loss": 0.6931471824645996
}
```

### Eval — Sauda v3 (per-task)

Source: `https://huggingface.co/datasets/ankur-1232/sauda-eval-runs/resolve/main/20260426_100451_ankur-1232-bestdealbot-v3/summary_hf_unsloth_Meta-Llama-3.1-8B-Instruct+ankur-1232_bestdealbot-v3_ankur-1232-bestdealbot-v3.json`

| task | n | mean_surplus | deal_rate | mean_rounds |
|---|---:|---:|---:|---:|
| single_deal | 10 | 0.8199 | 1.00 | 3.00 |
| asymmetric_pressure | 10 | 0.8070 | 1.00 | 3.70 |
| amazon_realistic | 10 | 0.4566 | 1.00 | 3.80 |

### Eval — Sauda v2-tells in-loop (per-task)

Source: `https://huggingface.co/datasets/ankur-1232/sauda-eval-runs/resolve/main/20260426_104614_ankur-1232-bestdealbot-v2-tells/summary_hf_unsloth_Meta-Llama-3.1-8B-Instruct+ankur-1232_bestdealbot-v2-tells_ankur-1232-bestdealbot-v2-tells.json`

| task | n | mean_surplus | deal_rate | mean_rounds |
|---|---:|---:|---:|---:|
| single_deal | 30 | 0.7920 | 1.00 | 3.00 |
| asymmetric_pressure | 30 | 0.7794 | 1.00 | 3.00 |
| amazon_realistic | 30 | 0.3888 | 1.00 | 2.90 |


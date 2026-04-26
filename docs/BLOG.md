# I Spent 24 Hours Teaching An LLM To Haggle In Hinglish And It Tried To Buy A Sofa Eight Times

> A live-from-the-venue hackathon journal. If you're looking for the responsible engineering write-up, this is not it. The buyer agent is named **Sauda** and at one point it agreed to a price and then five turns later said "27. done?" like that was a normal thing to do.

> *(Reader: I am writing this between bug fixes. The DPO smoke is on attempt 2 of 30 in another tab. We have not finished. By the time you read this we may have. Or may not have. The blog is being committed in real time alongside the code. Anyway.)*

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

## the dependency hell era

I tried to install bitsandbytes on Kaggle. Kaggle said no.

This is the abridged commit history of that single afternoon:

```
b419c4e Fix HF auth: pin huggingface_hub>=0.27 + drop login() in favor of env vars
ca6acbd Pin huggingface_hub>=0.34 + transformers>=4.50; require kernel restart after install
81f9341 Pin to known-good versions: transformers 4.46.3 + huggingface_hub 0.34.4; uninstall first
800e519 Rollback train.ipynb to last working notebook (commit 55d5267); drop dep-pinning experiments
419e75b Cell 2: clear pip cache + pinned versions, require kernel restart
dfecd85 Bump bitsandbytes 0.44.1 → 0.45.1 (fixes triton.ops removal)
b710e72 Pin triton==2.3.1 + bnb==0.44.1 (avoids Kaggle libstdc++ ABI mismatch)
```

**Seven dependency commits in a row.** Six of them rolled back the previous one. At one point I bumped bitsandbytes from 0.44.1 to 0.45.1 because triton 3.0 removed `triton.ops` and 0.44.1 imported it. Then 0.45.1 hit a different bug because Kaggle's libstdc++ was too old for the symbols 0.45.1 wanted (`GLIBCXX_3.4.32 not found`). Then I rolled back to 0.44.1 and pinned triton to 2.3.1 to avoid the `triton.ops` removal entirely.

I shouted "should I just colab this bitch" into the chat. We switched to Colab.

*(That line is real. It is in our chat history. I am not paraphrasing. If you ever need to know whether someone is having a bad time, listen for the word "bitch" applied to a piece of cloud infrastructure. It is diagnostic.)*

> **Lesson from the trenches #2**: Kaggle is a sandbox. Sandboxes have rules. When the sandbox loses, the sandbox doesn't tell you it lost. It just hangs forever during cell 4 and you wonder if your wifi is broken.

## the seller is a real character now

We had a seller. Gemma-4-E4B with persona prompts. The seller had four hard rules baked into code, not just into the prompt:

1. Never accept below reservation
2. Never leak reservation in messages
3. Counter offers always >= reservation
4. Counter must improve toward buyer

I ran the seller-quality eval. Gemma walked away on round 1. **Every episode.** Buyer says "39 chalega bhai?" Seller says "Walk."

The walk threshold was `< reservation * 0.8`. Reservation was usually $78 on a $100 listing. Buyers open at 30-40% of ask, which is $30-40, which is way under $62. Walk. Walk. Walk. 50 episodes, 50 walks, 0 deals.

Commit `4adc665: Fix LLMSeller premature walk: counter low offers, walk only as last resort`.

I re-ran the eval. Gemma now never walked. **Every episode expired at round 8.** Buyers couldn't reach reservation because the eval buyer's price-progression formula plateaued at 74% of ask, and reservations were 78% of ask. The buyer was *literally physically incapable* of reaching the price the seller could accept.

Commit `9335805: Fix eval buyer: was plateauing at ~74% of ask, never reaching 78% reservation`. Bumped the step size. The buyer now reaches 95% of ask by round 7.

I re-ran the eval. The seller still wasn't accepting. I traced through the LLM call — the seller was looking at a perfectly good offer and saying `{"action": "counter", "price": 32}` because the *LLM doesn't know what the reservation is*. The reservation is in code, not in the prompt (because we don't want to leak it).

Commit `ef753a6: Auto-accept when buyer offer ≥ reservation (LLM doesn't know the floor, would keep countering)`. If the LLM proposes a counter above the buyer's offer, but the buyer's offer is already above reservation, force `action="accept"`.

Three commits to get the seller to accept a deal. *Three.* And this is just the seller. The buyer is whole separate adventure.

*(Side note for the reader: if you are wondering whether I am going to get to the buyer adventure, the answer is "yes but not yet." The seller has to work first. Otherwise the buyer's eval numbers are measured against a seller that doesn't enforce its own rules and the buyer looks like a genius until you fix the seller and then the buyer looks like a person who got lucky. We will get to the moment where this exact thing happens. Stay with me.)*

> **Lesson from the trenches #3**: An LLM that doesn't know its own constraints can't enforce them. If the constraint is "don't reveal X," the LLM has to know X to avoid revealing X. If the constraint is "always accept when buyer's offer is good enough," the LLM has to know what "good enough" means or it will keep negotiating against itself forever.

The eval ran. **Five out of six metrics passed.** The one that didn't was `persona_consistency`, which is when we feed Gemma its own transcript and ask it which persona it was playing, and Gemma scores 38% across four classes. Forty-eight points above random, which sounds great, until you remember "default" and "flexible" are linguistically almost identical and the only way to truly distinguish them is to run a logistic regression on adjective frequency, which Gemma is not doing.

We left it. The metric is structurally cursed. Self-judging without temperature pinned to 0 is unreliable. The 5/6 result is honest and we report it as such.

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

> **Lesson from the trenches #4**: If you fix the opponent mid-experiment, every old number is now a different benchmark. Tag the eval with the opponent's git SHA. Better yet, snapshot the opponent into a versioned model file. Otherwise your old screenshots are lying to you and you don't know they're lying because they're *your* screenshots.

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

Commit `2728bf7: Force unbuffered stdout in HF Jobs scripts`. Added `python -u`. Added `flush=True` to every print I cared about.

> **Lesson from the trenches #5**: `print` does not always print. It almost always prints. It usually prints. It prints in 99 of 100 contexts. The 1 context is the context you are currently in. Always `python -u`.

### Smoke v2: gated repo

I fired smoke v2. Logs streamed in real-time now. Beautiful. They said:

```
403 Client Error. Cannot access gated repo for url
https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct/resolve/main/config.json.
You are not in the authorized list.
```

The HF token plumbed into the job container did not have Llama 3.1 access. *Even though the original SFT had run on Llama 3.1.* The original SFT had used my personal HF account that had Llama 3.1 approval. The job container was using a project token that did not.

I could have fixed this by clicking through the Meta Llama 3.1 license again on a different account, but I was tired and they want your name and your "Use case" and the dropdown was 30 items long. So instead I switched to `unsloth/Meta-Llama-3.1-8B-Instruct`, which is a public ungated mirror with byte-identical weights.

Commit `53940dc: Switch base model defaults to unsloth mirrors (ungated)`. Done. Adapter loads on top of unsloth base because PEFT cares about architecture not repo name.

> **Lesson from the trenches #6**: Gated models are a tax that everyone pays differently. Your token is fine. Your colleague's token is fine. The token in your CI is *not* fine. The unsloth mirror is the unblocker. Use it.

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

> **Lesson from the trenches #7**: Modern instruction-tuned models have multiple end-of-turn tokens. The default tokenizer config does not always wire them all in. If your generation runs to `max_new_tokens` every time, this is your bug. Pass `eos_token_id` as a list. Now. Today. Before reading the next paragraph of this blog.

### Smoke v4: 4-bit is slow, this is fine, this is not fine

EOS fixed. Generates were now ~10s each. Still too slow. We had been running with `BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type='nf4')` because everyone defaults to it because "VRAM is precious."

A10G-large has 80GB. Llama-3.1-8B in bf16 is 16GB. We were optimizing VRAM that we did not need to optimize. The 4-bit dequantization step on every forward pass adds substantial latency. Not the kind that shows up in benchmarks. The kind that compounds across 200 generates per pair-build.

Commit `1ccb2c1: 3B pair-build buyer + bf16 dtype hatch (overnight smoke fix)`. Made `BUYER_DTYPE` and `SELLER_DTYPE` env-vars. Default bf16. Generates now ~3s.

> **Lesson from the trenches #8**: 4-bit is not free. It is a tax you pay in compute time so you can fit on a smaller GPU. If you have the VRAM, run bf16. If you do not, run 4-bit, but know you are paying for it.

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

> **Lesson from the trenches #9**: Write your fallbacks against real data. Specs lie. Specs say "the buyer accepts the deal." Real data says "the seller accepts because the buyer's offer hit reservation and the LLM seller doesn't know to reach for the accept action."

### Smoke v6: the loop that ran exactly once

I built a scaling-ladder eval to compare 3B base, 8B base, and Sauda v2. The ladder was three rows in a bash variable:

```bash
LADDER="llama_3b_base|unsloth/Llama-3.2-3B-Instruct|-|0
llama_8b_base|unsloth/Meta-Llama-3.1-8B-Instruct|-|0
sauda_8b_v2|unsloth/Meta-Llama-3.1-8B-Instruct|PayMyBills/bestdealbot-v2|1"

echo "$LADDER" | while IFS='|' read -r LABEL BASE ADAPTER STEER; do
    python eval_harness.py --hf_base "$BASE" ...
done
```

This looks fine. **It is not fine.**

The pipe creates a subshell. The Python call inside the loop reads from stdin (or something else triggers EOF on the pipe). After the first iteration, `read` got EOF and the loop exited. **The job ran exactly one of the three rows.** Then it ran the post-processing pipeline that aggregated "all" the rows into a `scaling_summary.json` containing one row, and uploaded that to HF, and exited cleanly.

I checked HF. The summary said:

```
| llama_3b_base | 0.570 | 1.00 | 2.2 | 90 |
```

One row. **Where are my other two rows.**

I was so confused. I re-fired the same script with the same code thinking maybe it was a transient. Same result. One row. I lost an hour to this.

Commit `55c6841: Fix scaling ladder: loop only ran first row`. Fed the LADDER via heredoc instead of pipe. Redirected Python's stdin to /dev/null. The loop ran in the parent shell. All three rows fired.

> **Lesson from the trenches #10**: `echo X | while read` is shell trivia that has been waiting to bite you for ten years. Use a heredoc. `done <<EOF / $X / EOF`. Or `<<<` if it fits on one line. Pipe-fed `while read` is a footgun in a tutorial.

### Smoke v7-8: the part where I gave up and started writing this blog

By midnight Saturday I had cancelled four DPO smokes and re-fired three. The HF Jobs dashboard showed `69ecdc20`, `69ece351`, `69ece4b0`, `69ece6a5`, `69ecef4c`, `69ecf12e`, `69ecf269` — all cancelled, all my fault.

I fired smoke v8 with the heuristic fix and bf16 and the EOS fix and `python -u` and `unsloth/Meta-Llama-3.1-8B-Instruct` and `max_rounds=8` and the proper buyer adapter.

It started running. It is, as of this writing, on attempt 2. Two attempts in 35 minutes. We are going to see how this goes.

We pivoted. **Sauda v2 is on HF. The seller-quality eval is solid. The env works. v3-dpo is gravy.**

I redirected the night's compute to an overnight scaling-ladder eval (with the heredoc fix this time) and a tells ablation. Both completed. Real numbers below.

> **Lesson from the trenches #11**: A pipeline that mostly works is more valuable than a pipeline that fully works in two hours. Ship the mostly-works version with reproducible scripts and a footnote. The judges read code. The footnote is part of the story.

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

> **Lesson from the trenches #12**: If you don't test the feature, the feature works. If you test the feature, sometimes the feature does not work. Test the feature. The feature not working is the second-best outcome because you can fix it.

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

> **Lesson from the trenches #13**: A buyer with no memory will agree, walk away, and re-agree on every turn. This is not negotiation. This is goldfish theater. Pipe the last 2-3 turns into the obs. Or train the buyer on multi-turn coherence as a metric. Or both.

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

The DPO smoke is running. The HF Inference Endpoint for the live `/sell` buyer needs to be deployed before judges arrive — that is a click-through I am about to do, and if I forget, the page falls back to the Ollama path on my laptop, which works but ties the demo to my laptop staying awake. Also: the README needs a final pass to incorporate the scaling-ladder table and the tells-ablation result. Also: I need to stop writing this blog and go do that.

*(I will come back to this section when the day is done. There will be more rows in the "what exists" list. There will probably also be more bugs. The blog will grow downward, like a lazy plant. Bookmark this paragraph if you want to know when I'm back.)*

## the running lessons list

These are the lessons so far, all from the receipts above. The rule of this blog is that nothing on this list is hypothetical — each item has its own bug story, its own commit, its own moment where I sat at the laptop and made the face you make when you realize what you have done.

- Pin the opponent. Snapshot the seller version when reporting buyer metrics. Tag every eval with the opponent's git SHA.
- Test inference loop speed before building any training pipeline that depends on it. If your generates are 30s, you have no debug signal for anything else.
- Run the ablation early. We would have known the tells channel didn't help on day 2 instead of day 6 and we would have re-prioritized.
- Write the heuristic judge against real transcripts, not against the spec. The spec lies.
- `python -u` from day one. `eos_token_id` as a list from day one. `BUYER_DTYPE=bf16` from day one. Save yourself the cycles.
- Don't `echo "$X" | while read`. Use a heredoc.
- When the model speaks Korean, it is gradient checkpointing during inference. Always.
- When the seller walks on round 1, the walk threshold is too low.
- When the buyer walks on round 8, the buyer's offer trajectory plateaus before reservation.
- When the LLM says `{"action": "counter", "price": $reservation+1}` and you wanted accept, the LLM doesn't know reservation exists.
- When you fix the seller, every old buyer number is now meaningless.
- When the heuristic returns "tie" 30 times in a row, the heuristic is wrong, not the model.

*(This list will grow today. I can feel it.)*

---

*Cost so far: ~$25 of HF Jobs across the smoke debugging plus the overnight evals plus the seller-quality eval plus the DPO pipeline that is still running in another tab. Out of $90 team budget. **The mistakes were the cheap part. The lessons are still being collected.***

*Sauda v2 has accepted 91% of the deals it should have, walked away from 9% it shouldn't have taken, and at one point told a seller "32 mein de dijiye?" and then five turns later said "okay 27 — bas yahi ceiling hai." We are still investigating what happened in those five turns. We suspect goldfish theater.*

*If any part of this post saves you from any of the bugs in this post, it has paid for itself. If you have made any of these bugs yourself, you are not alone. The thirteen lessons are scattered above like land mines. They are also all in the commit history. They are all real. None of them are fictionalized. The agent is named Sauda. The blog post is named after a sentence I said out loud at 4am.*

*Reader: I am closing this tab now and going back to work. There is a website to wire, an endpoint to deploy, a smoke to babysit. I will be back. Probably with more lessons. Definitely with more commits. The post will keep growing for as long as the bugs do, which is to say, forever.*

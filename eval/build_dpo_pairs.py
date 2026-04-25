"""Build DPO preference pairs from buyer rollouts.

For each (listing, seller_brief) scenario:
1. Roll out the v2 buyer twice with different sampling temperatures
2. Use eval/judge.py to pick which rollout was better
3. Save the (prompt, chosen_completion, rejected_completion) triple

Output: data/dpo_pairs.jsonl, ready for trl.DPOTrainer.

Usage:
    PYTHONPATH=. python eval/build_dpo_pairs.py \\
        --buyer-model PayMyBills/bestdealbot-v2 \\
        --seller-model google/gemma-4-E4B \\
        --n 100 \\
        --out data/dpo_pairs.jsonl
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path
from typing import Any

from bazaarbot_env import DEFAULT_SYSTEM_PROMPT, format_observation, parse_action
from bazaarbot_env.llm_seller import LLMSeller
from data.craigslist_loader import load_listings
from eval.judge import compare_rollouts
from eval.seller_quality import buyer_message, buyer_offer, make_role_brief
from utils.run_logger import RunLogger


# ── Real-buyer rollout: load buyer adapter once, sample at the requested temp ──

_BUYER_BUNDLE: dict[str, Any] = {}


def _load_buyer(base_model: str, adapter: str | None) -> tuple[Any, Any, Any]:
    """Cache (tokenizer, model, device) bundle. Adapter optional — when None we
    sample from the base model directly."""
    key = f"{base_model}::{adapter or '-'}"
    if key in _BUYER_BUNDLE:
        b = _BUYER_BUNDLE[key]
        return b["tok"], b["model"], b["device"]

    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    tok = AutoTokenizer.from_pretrained(base_model, use_fast=True, trust_remote_code=True)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token

    kwargs: dict[str, Any] = {"device_map": "auto", "trust_remote_code": True}
    if torch.cuda.is_available():
        kwargs["torch_dtype"] = torch.bfloat16
        kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,
            bnb_4bit_use_double_quant=True,
        )
    else:
        kwargs["torch_dtype"] = torch.float32

    model = AutoModelForCausalLM.from_pretrained(base_model, **kwargs)
    if adapter:
        from peft import PeftModel
        model = PeftModel.from_pretrained(model, adapter)
    model.config.use_cache = True
    model.eval()

    device = next(model.parameters()).device
    _BUYER_BUNDLE[key] = {"tok": tok, "model": model, "device": device}
    return tok, model, device


def _buyer_sample(
    base_model: str,
    adapter: str | None,
    obs: dict[str, Any],
    temperature: float,
    max_new_tokens: int = 64,
) -> dict[str, Any]:
    """Sample one buyer action from the HF model at the given temperature.

    Llama-3.1-Instruct emits `<|eot_id|>` (turn boundary), not the default
    `<|end_of_text|>`. Without passing both as eos_token_id the model runs
    to max_new_tokens every time — 30s/turn on A10G. We pass both, so the
    model can stop early when it finishes its turn.
    """
    import torch

    tok, model, device = _load_buyer(base_model, adapter)

    # Resolve stop tokens: include <|eot_id|> if present (Llama-3.1) plus the
    # default eos. Falls back gracefully on non-Llama tokenizers.
    eos_ids = []
    default_eos = tok.eos_token_id
    if isinstance(default_eos, int):
        eos_ids.append(default_eos)
    eot = tok.convert_tokens_to_ids("<|eot_id|>")
    if isinstance(eot, int) and eot != tok.unk_token_id and eot not in eos_ids:
        eos_ids.append(eot)

    messages = [
        {"role": "system", "content": DEFAULT_SYSTEM_PROMPT},
        {"role": "user", "content": format_observation(obs)},
    ]
    prompt = None
    if getattr(tok, "chat_template", None):
        try:
            prompt = tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        except Exception:
            prompt = None
    if prompt is None:
        prompt = f"{DEFAULT_SYSTEM_PROMPT}\n\n{format_observation(obs)}\n"

    inputs = tok(prompt, return_tensors="pt", truncation=True, max_length=2048).to(device)
    with torch.no_grad():
        out = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=temperature > 0,
            temperature=max(temperature, 1e-5),
            top_p=0.9,
            eos_token_id=eos_ids if eos_ids else tok.eos_token_id,
            pad_token_id=tok.eos_token_id,
        )
    text = tok.decode(out[0][inputs["input_ids"].shape[-1]:], skip_special_tokens=True)
    action = parse_action(text, fallback_price=obs.get("own_private_budget", 100) * 0.3)
    action.pop("_parse_error", None)
    return action


def buyer_complete(
    buyer_base: str,
    buyer_adapter: str | None,
    listing: dict[str, Any],
    brief: dict[str, Any],
    seller_model: str,
    max_rounds: int,
    rng: random.Random,
    temperature: float,
    use_real_buyer: bool = True,
) -> tuple[list[dict[str, Any]], str]:
    """Run one buyer rollout. When use_real_buyer is True, samples actions from
    the actual HF buyer model (base + optional adapter) at the given temperature
    — this is what makes DPO pairs meaningful (otherwise both rollouts are the
    same deterministic policy and every pair is a tie).

    Returns (transcript, prompt_chat) — prompt_chat is the JSON-serialised first
    user-turn prompt fed to the buyer, used as the DPO `prompt` field.
    """
    seller = LLMSeller(listing, brief, model=seller_model)
    transcript: list[dict[str, Any]] = []

    opening = seller.open()
    transcript.append({"role": "seller", "message": opening, "price": brief["asking_price"]})

    asking = float(brief["asking_price"])
    budget = asking * 1.05  # mirrors seller_quality buyer-budget heuristic
    prev_offer: float | None = None
    seller_last = asking
    prompt_chat = ""

    for turn in range(1, max_rounds + 1):
        # Build the observation the buyer model expects (mirrors eval_harness)
        obs = {
            "seller_asking_price": asking,
            "opponent_last_offer": seller_last,
            "own_private_budget": budget,
            "own_last_offer": prev_offer,
            "current_round": turn - 1,
            "max_rounds": max_rounds,
            "message": transcript[-1].get("message", ""),
        }

        if turn == 1:
            prompt_chat = json.dumps({
                "system": DEFAULT_SYSTEM_PROMPT,
                "user": format_observation(obs),
            })

        if use_real_buyer:
            try:
                action = _buyer_sample(buyer_base, buyer_adapter, obs, temperature)
            except Exception as e:
                print(f"    buyer-sample fell back ({e}); using deterministic policy", flush=True)
                action = None
        else:
            action = None

        if action is None or action.get("price") is None and action.get("action") != "accept":
            # Fallback: deterministic policy (also catches walks where price=None is fine)
            offer = buyer_offer(asking, turn, max_rounds, prev_offer, seller_last)
            msg = buyer_message(offer, turn, max_rounds, rng)
            action = {"action": "offer", "price": offer, "message": msg}

        offer = float(action["price"]) if action.get("price") is not None else (prev_offer or asking * 0.5)
        msg = action.get("message") or buyer_message(offer, turn, max_rounds, rng)
        prev_offer = offer

        transcript.append({
            "role": "buyer",
            "message": msg,
            "price": offer,
            "action": action.get("action", "offer"),
            "temperature": temperature,
        })

        if action.get("action") == "walk":
            break

        reply = seller.respond(transcript, msg, offer)
        transcript.append({
            "role": "seller",
            "message": reply["message"],
            "price": reply["price"],
            "action": reply["action"],
        })

        if reply["action"] in ("accept", "walk"):
            break
        if reply["price"] is not None:
            seller_last = float(reply["price"])

    return transcript, prompt_chat


def _trajectory_text(transcript: list[dict[str, Any]]) -> str:
    """Render a transcript as a single text completion for DPO."""
    parts = []
    for t in transcript:
        role = t.get("role", "?")
        msg = str(t.get("message", "")).strip()
        price = t.get("price")
        if price is not None:
            parts.append(f"[{role} ${price:.0f}] {msg}")
        else:
            parts.append(f"[{role}] {msg}")
    return "\n".join(parts)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--buyer-model", default="PayMyBills/bestdealbot-v2",
                   help="(deprecated) HF repo of full buyer model — use --buyer-base + --buyer-adapter")
    p.add_argument("--buyer-base", default="meta-llama/Llama-3.1-8B-Instruct",
                   help="Base model for the buyer (loaded in 4-bit)")
    p.add_argument("--buyer-adapter", default="PayMyBills/bestdealbot-v2",
                   help="PEFT adapter stacked on buyer-base; pass '-' or empty to skip")
    p.add_argument("--temp-a", type=float, default=0.5, help="Sampling temp for rollout A")
    p.add_argument("--temp-b", type=float, default=0.9, help="Sampling temp for rollout B")
    p.add_argument("--seller-model", default="google/gemma-4-E4B")
    p.add_argument("--n", type=int, default=50, help="Number of pairs to generate")
    p.add_argument("--out", default="data/dpo_pairs.jsonl")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--max-rounds", type=int, default=8)
    p.add_argument("--use-real-buyer", type=int, default=1,
                   help="1 = sample from HF buyer (default); 0 = deterministic placeholder")
    args = p.parse_args()
    buyer_adapter = args.buyer_adapter if args.buyer_adapter and args.buyer_adapter != "-" else None
    use_real_buyer = bool(args.use_real_buyer)

    rng = random.Random(args.seed)
    listings = load_listings(split="dev", min_price=100, max_price=50_000)
    if not listings:
        raise RuntimeError("No listings found in data/dev.json — run the eval setup first")

    pairs: list[dict[str, Any]] = []
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with RunLogger("build_dpo_pairs") as log:
        log.config({
            "buyer_base": args.buyer_base,
            "buyer_adapter": buyer_adapter,
            "temp_a": args.temp_a,
            "temp_b": args.temp_b,
            "seller_model": args.seller_model,
            "n_pairs_target": args.n,
            "use_real_buyer": use_real_buyer,
            "seed": args.seed,
        })

        # NOTE: this implementation uses buyer_message() as the buyer policy
        # placeholder; for real DPO you'd replace this with two sampled completions
        # from the actual trained buyer model at different temperatures. The
        # judge + pair structure is identical.
        i = 0
        attempts = 0
        while i < args.n and attempts < args.n * 3:
            attempts += 1
            listing = rng.choice(listings)
            brief = make_role_brief(listing, rng)
            print(f"  attempt {attempts}: persona={brief['persona']} listing={listing.get('title','?')[:40]}", flush=True)

            try:
                # Two rollouts with same listing/brief, different rng seeds → behaviour diverges
                rng_a = random.Random(rng.randint(0, 1_000_000))
                rng_b = random.Random(rng.randint(0, 1_000_000))
                rollout_a, prompt = buyer_complete(
                    args.buyer_base, buyer_adapter, listing, brief,
                    args.seller_model, args.max_rounds, rng_a, args.temp_a,
                    use_real_buyer=use_real_buyer,
                )
                rollout_b, _ = buyer_complete(
                    args.buyer_base, buyer_adapter, listing, brief,
                    args.seller_model, args.max_rounds, rng_b, args.temp_b,
                    use_real_buyer=use_real_buyer,
                )
            except Exception as e:
                print(f"  ! attempt {attempts} rollout failed: {e}", flush=True)
                continue

            verdict = compare_rollouts(listing, brief, rollout_a, rollout_b)
            if verdict["winner"] == "tie":
                print(f"    tie ({verdict['reason'][:80]}) — skipping", flush=True)
                continue

            chosen = rollout_a if verdict["winner"] == "a" else rollout_b
            rejected = rollout_b if verdict["winner"] == "a" else rollout_a

            pair = {
                "prompt": prompt,
                "chosen": _trajectory_text(chosen),
                "rejected": _trajectory_text(rejected),
                "judge_reason": verdict["reason"],
                "listing_title": listing.get("title"),
                "persona": brief["persona"],
            }
            pairs.append(pair)
            log.metric({
                "pair_idx": i,
                "judge_winner": verdict["winner"],
                "persona": brief["persona"],
                "reason": verdict["reason"],
            })
            print(f"  [{i+1}/{args.n}] {brief['persona']:>10} → winner={verdict['winner']}", flush=True)
            i += 1

        with open(out_path, "w") as f:
            for p_obj in pairs:
                f.write(json.dumps(p_obj, ensure_ascii=False) + "\n")

        log.summary({"n_pairs": len(pairs), "attempts": attempts, "out": str(out_path)})

    print(f"\nWrote {len(pairs)} pairs to {out_path}", flush=True)


if __name__ == "__main__":
    main()

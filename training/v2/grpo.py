"""Track B: GRPO continuation on the SFT'd Llama-3.1-8B adapter.

Loads the adapter from training/v2/sft.py output (or HF Hub), runs GRPO with the
shaped first-step reward, pushes final model to HF.

Usage on HF:
    SFT_ADAPTER_DIR=runs/{ts}_sft_8b/adapter PYTHONPATH=. python training/v2/grpo.py
    # or pull the SFT'd model from HF:
    SFT_HF_REPO=PayMyBills/bestdealbot-v2-sft PYTHONPATH=. python training/v2/grpo.py

Outputs:
    - LoRA adapter saved to runs/{ts}_grpo_8b/adapter/
    - Pushed to HF Hub as $REPO_ID if HF_PUSH=1
    - Training metrics in runs/{ts}_grpo_8b/metrics.jsonl
"""

import json
import math
import os
import random
import sys

import torch
from datasets import Dataset
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from trl import GRPOConfig, GRPOTrainer

sys.path.insert(0, os.getcwd())
from bazaarbot_env import (
    BazaarGymEnv,
    DEFAULT_SYSTEM_PROMPT,
    format_observation,
    parse_action,
)
from utils.run_logger import RunLogger


BASE_MODEL = os.environ.get("BASE_MODEL", "meta-llama/Llama-3.1-8B-Instruct")
SFT_ADAPTER_DIR = os.environ.get("SFT_ADAPTER_DIR", "")
SFT_HF_REPO = os.environ.get("SFT_HF_REPO", "")  # alternative to SFT_ADAPTER_DIR
REPO_ID = os.environ.get("REPO_ID", "PayMyBills/bestdealbot-v2")
HF_PUSH = os.environ.get("HF_PUSH", "0") == "1"
N_PROMPTS = int(os.environ.get("N_PROMPTS", "256"))
MAX_STEPS = int(os.environ.get("MAX_STEPS", "100"))
SEED = int(os.environ.get("SEED", "0"))


def _shaped_first_step_reward(obs, action, step_reward):
    if action.get("_parse_error"):
        return -0.3
    act = action.get("action")
    ask = obs.get("seller_asking_price") or 0
    budget = obs.get("own_private_budget") or 0
    price = action.get("price") or 0

    if act == "accept":
        return -0.2
    if act == "walk":
        return -0.3
    if ask <= 0 or budget <= 0:
        return float(step_reward)
    if price <= 0 or price > budget:
        return -0.3

    ratio = price / ask
    shape = math.exp(-((ratio - 0.25) ** 2) / 0.08)
    return float(step_reward) + shape


def make_reward_fn():
    def reward_fn(completions, prompts=None, completion_ids=None, **kwargs):
        rewards = []
        tasks = kwargs.get("task") or ["amazon_realistic"] * len(completions)
        seeds = kwargs.get("seed") or [None] * len(completions)
        for completion, task, seed in zip(completions, tasks, seeds):
            env = BazaarGymEnv(task_name=task, seed=seed)
            obs, _ = env.reset()
            action = parse_action(
                completion,
                fallback_price=obs.get("own_private_budget", 100) * 0.3,
            )
            _obs, r, done, info = env.step(action)
            rewards.append(_shaped_first_step_reward(obs, action, r))
        return rewards

    return reward_fn


def main():
    if not SFT_ADAPTER_DIR and not SFT_HF_REPO:
        print("ERROR: set SFT_ADAPTER_DIR or SFT_HF_REPO", file=sys.stderr)
        sys.exit(1)

    with RunLogger("grpo_8b") as log:
        log.config({
            "base_model": BASE_MODEL,
            "sft_adapter": SFT_ADAPTER_DIR or SFT_HF_REPO,
            "n_prompts": N_PROMPTS,
            "max_steps": MAX_STEPS,
            "seed": SEED,
            "hf_push": HF_PUSH,
            "repo_id": REPO_ID if HF_PUSH else None,
        })

        print(f"Loading base {BASE_MODEL} ...")
        bnb = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,
            bnb_4bit_use_double_quant=True,
        )
        tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, use_fast=True)
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token

        base = AutoModelForCausalLM.from_pretrained(
            BASE_MODEL,
            quantization_config=bnb,
            device_map="auto",
            torch_dtype=torch.bfloat16,
        )

        adapter_src = SFT_ADAPTER_DIR or SFT_HF_REPO
        print(f"Loading SFT adapter from {adapter_src} ...")
        model = PeftModel.from_pretrained(base, adapter_src, is_trainable=True)
        model.config.use_cache = True

        print(f"Building GRPO prompt set ({N_PROMPTS} prompts) ...")
        rng = random.Random(SEED)
        train_tasks = ["amazon_realistic", "amazon_realistic", "single_deal"]
        # ENABLE_TELLS_IN_LOOP=1: half the prompts come from mid-rollout (tells
        # populated), half from reset (tells absent). This balances the two
        # distributions the trained model will see at eval time.
        enable_tells = os.environ.get("ENABLE_TELLS_IN_LOOP", "0") == "1"
        rows = []
        for i in range(N_PROMPTS):
            task = rng.choice(train_tasks)
            seed = rng.randint(0, 1_000_000)
            env = BazaarGymEnv(task_name=task, seed=seed)
            obs, _ = env.reset()
            if enable_tells and (i % 2 == 0):
                # Step once with a placeholder buyer offer so the seller
                # responds and the next obs carries seller-tell signals.
                ask = float(obs.get("seller_asking_price") or 60)
                placeholder = {"action": "offer", "price": round(ask * 0.45, 2), "message": ""}
                try:
                    obs, _, done, _ = env.step(placeholder)
                    if done:
                        env = BazaarGymEnv(task_name=task, seed=seed)
                        obs, _ = env.reset()
                except Exception:
                    env = BazaarGymEnv(task_name=task, seed=seed)
                    obs, _ = env.reset()
            chat = tokenizer.apply_chat_template(
                [
                    {"role": "system", "content": DEFAULT_SYSTEM_PROMPT},
                    {"role": "user", "content": format_observation(obs)},
                ],
                tokenize=False,
                add_generation_prompt=True,
            )
            rows.append({"prompt": chat, "task": task, "seed": seed})
        train_ds = Dataset.from_list(rows)

        cfg = GRPOConfig(
            output_dir=str(log.path("trainer_out")),
            per_device_train_batch_size=1,
            gradient_accumulation_steps=4,
            num_generations=2,
            max_completion_length=64,
            learning_rate=5e-6,
            num_train_epochs=1,
            max_steps=MAX_STEPS,
            logging_steps=1,
            save_steps=20,
            save_total_limit=2,
            bf16=True,
            report_to="none",
            remove_unused_columns=False,
            push_to_hub=HF_PUSH,
            hub_model_id=REPO_ID if HF_PUSH else None,
            hub_strategy="checkpoint" if HF_PUSH else "end",
            hub_private_repo=False,
        )

        trainer = GRPOTrainer(
            model=model,
            processing_class=tokenizer,
            reward_funcs=make_reward_fn(),
            args=cfg,
            train_dataset=train_ds,
        )

        print("Training GRPO ...")
        trainer.train()

        for entry in trainer.state.log_history:
            log.metric(entry)

        adapter_dir = log.path("adapter")
        print(f"Saving final adapter to {adapter_dir} ...")
        model.save_pretrained(str(adapter_dir))
        tokenizer.save_pretrained(str(adapter_dir))

        if HF_PUSH:
            print(f"Pushing final to {REPO_ID} ...")
            model.push_to_hub(REPO_ID, private=False)

        log.summary({
            "base_model": BASE_MODEL,
            "adapter_dir": str(adapter_dir),
            "max_steps": MAX_STEPS,
            "final_reward": trainer.state.log_history[-1].get("reward")
                if trainer.state.log_history else None,
            "pushed": REPO_ID if HF_PUSH else None,
        })

        print("\n=== GRPO DONE ===")
        print(f"Adapter: {adapter_dir}")


if __name__ == "__main__":
    main()

"""Track A: SFT warmup for Llama-3.1-8B-Instruct on BazaarBATNA buyer task.

Same recipe as training/train.ipynb cell 8-12, but as a script that runs cleanly
on HF AutoTrain / a single A10G. Logs to runs/{ts}_sft_8b/.

Usage on HF:
    cd /workspace/MetaThon
    pip install -q "trl>=0.12" "peft>=0.13" "transformers>=4.46" "accelerate>=1.1" \\
        "bitsandbytes>=0.44" "datasets>=3.0" huggingface_hub
    huggingface-cli login --token $HF_TOKEN
    PYTHONPATH=. python training/v2/sft.py

Outputs:
    - LoRA adapter saved to runs/{ts}_sft_8b/adapter/
    - Pushed to HF Hub as $REPO_ID-sft if HF_PUSH=1
    - Loss curves in runs/{ts}_sft_8b/metrics.jsonl
"""

import json
import os
import random
import sys

import torch
from datasets import Dataset
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from trl import SFTConfig, SFTTrainer

sys.path.insert(0, os.getcwd())
from bazaarbot_env import BazaarGymEnv, DEFAULT_SYSTEM_PROMPT, format_observation
from utils.run_logger import RunLogger


BASE_MODEL = os.environ.get("BASE_MODEL", "meta-llama/Llama-3.1-8B-Instruct")
REPO_ID = os.environ.get("REPO_ID", "PayMyBills/bestdealbot-v2")
HF_PUSH = os.environ.get("HF_PUSH", "0") == "1"
N_TRAIN = int(os.environ.get("N_TRAIN", "512"))
SEED = int(os.environ.get("SEED", "42"))


def _rule_based_buyer(obs: dict) -> dict:
    """Same baseline used to bootstrap SFT in train.ipynb."""
    ask = obs.get("seller_asking_price") or obs.get("opponent_last_offer") or 100
    budget = obs.get("own_private_budget") or 100
    rnd = obs.get("current_round") or 0
    last = obs.get("own_last_offer")

    if ask <= budget * 0.5:
        return {"action": "accept", "price": None}
    if ask > budget:
        return {"action": "walk", "price": None}
    if rnd == 0 or last is None:
        price = ask * random.uniform(0.25, 0.40)
    else:
        price = last + (ask - last) * random.uniform(0.2, 0.35)
    price = max(1.0, min(price, budget * 0.8))
    return {"action": "offer", "price": round(price, 2)}


def build_sft_rows(tokenizer, n: int) -> list[dict]:
    """Generate (prompt, action) pairs from rule-based buyer rollouts.

    With ENABLE_TELLS=1, builds multi-turn rollouts so the SFT prompts
    actually contain seller-tell observations (which only appear after
    round 0, populated by the seller's response). Each rollout produces
    up to `max_rounds` (prompt, action) pairs, each pair being one
    buyer turn with the obs the buyer saw at that turn.

    Without ENABLE_TELLS the original single-turn-from-reset() behavior
    is preserved — tells block won't render because obs.tells is None
    at reset.
    """
    rng = random.Random(SEED)
    tasks = ["amazon_realistic", "single_deal", "career_10"]
    enable_tells = os.environ.get("ENABLE_TELLS_IN_LOOP", "0") == "1"
    rows: list[dict] = []
    target_rows = n
    while len(rows) < target_rows:
        task = rng.choice(tasks)
        seed = rng.randint(0, 1_000_000)
        env = BazaarGymEnv(task_name=task, seed=seed)
        obs, _ = env.reset()
        for _turn in range(8):  # max episode length
            action = _rule_based_buyer(obs)
            action["message"] = ""

            chat = tokenizer.apply_chat_template(
                [
                    {"role": "system", "content": DEFAULT_SYSTEM_PROMPT},
                    {"role": "user", "content": format_observation(obs)},
                    {"role": "assistant", "content": json.dumps(action)},
                ],
                tokenize=False,
            )
            rows.append({"text": chat})

            if not enable_tells:
                break  # original single-turn-per-rollout behavior

            if len(rows) >= target_rows:
                break

            # Step the env so the next turn's obs carries seller-tell signals
            try:
                obs, _, done, _ = env.step(action)
            except Exception:
                break
            if done:
                break
    return rows[:target_rows]


def main():
    with RunLogger("sft_8b") as log:
        log.config({
            "base_model": BASE_MODEL,
            "n_train": N_TRAIN,
            "seed": SEED,
            "hf_push": HF_PUSH,
            "repo_id": REPO_ID if HF_PUSH else None,
        })

        print(f"Loading {BASE_MODEL} ...")
        bnb = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,
            bnb_4bit_use_double_quant=True,
        )
        tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, use_fast=True)
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token

        model = AutoModelForCausalLM.from_pretrained(
            BASE_MODEL,
            quantization_config=bnb,
            device_map="auto",
            torch_dtype=torch.bfloat16,
        )
        model = prepare_model_for_kbit_training(model)
        lora = LoraConfig(
            r=16,
            lora_alpha=32,
            target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
            lora_dropout=0.05,
            bias="none",
            task_type="CAUSAL_LM",
        )
        model = get_peft_model(model, lora)
        model.print_trainable_parameters()

        print(f"Building SFT dataset ({N_TRAIN} rows) ...")
        rows = build_sft_rows(tokenizer, N_TRAIN)
        sft_ds = Dataset.from_list(rows)

        adapter_dir = log.path("adapter")
        cfg = SFTConfig(
            output_dir=str(log.path("trainer_out")),
            per_device_train_batch_size=2,
            gradient_accumulation_steps=4,
            learning_rate=1e-4,
            num_train_epochs=1,
            logging_steps=5,
            save_strategy="no",
            bf16=True,
            report_to="none",
            max_length=1024,
            dataset_text_field="text",
            packing=False,
        )
        trainer = SFTTrainer(
            model=model,
            processing_class=tokenizer,
            args=cfg,
            train_dataset=sft_ds,
        )

        print("Training ...")
        trainer.train()

        # Capture training history
        for entry in trainer.state.log_history:
            log.metric(entry)

        print(f"Saving adapter to {adapter_dir} ...")
        model.save_pretrained(str(adapter_dir))
        tokenizer.save_pretrained(str(adapter_dir))

        if HF_PUSH:
            print(f"Pushing to {REPO_ID}-sft ...")
            model.push_to_hub(f"{REPO_ID}-sft", private=False)
            tokenizer.push_to_hub(f"{REPO_ID}-sft", private=False)

        log.summary({
            "base_model": BASE_MODEL,
            "adapter_dir": str(adapter_dir),
            "final_loss": trainer.state.log_history[-1].get("loss") if trainer.state.log_history else None,
            "pushed": f"{REPO_ID}-sft" if HF_PUSH else None,
        })

        print("\n=== SFT DONE ===")
        print(f"Adapter: {adapter_dir}")


if __name__ == "__main__":
    main()

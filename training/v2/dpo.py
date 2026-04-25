"""Track C: DPO continuation on the SFT/GRPO'd Llama-3.1-8B adapter.

Reads preference pairs from data/dpo_pairs.jsonl (built by eval/build_dpo_pairs.py
with Claude-as-judge), runs trl.DPOTrainer, pushes a fresh adapter to HF.

Usage on HF Jobs:
    PAIRS_PATH=data/dpo_pairs.jsonl \\
    SFT_HF_REPO=PayMyBills/bestdealbot-v2 \\
    REPO_ID=PayMyBills/bestdealbot-v3-dpo \\
    HF_PUSH=1 \\
    PYTHONPATH=. python training/v2/dpo.py

Inputs (env-vars):
    BASE_MODEL        — HF base model id (default Llama-3.1-8B-Instruct)
    SFT_ADAPTER_DIR   — local SFT adapter dir, OR
    SFT_HF_REPO       — HF repo id of SFT adapter (default bestdealbot-v2)
    PAIRS_PATH        — JSONL with {prompt, chosen, rejected} rows
    REPO_ID           — push target on HF (default bestdealbot-v3-dpo)
    HF_PUSH           — "1" to push final adapter
    BETA              — DPO beta (default 0.1)
    LR                — learning rate (default 5e-6, lower than SFT)
    EPOCHS            — number of epochs (default 1)
    MAX_LENGTH        — token cap (default 1024)

Outputs:
    runs/{ts}_dpo_8b/adapter/   — LoRA adapter
    runs/{ts}_dpo_8b/metrics.jsonl
"""

import json
import os
import sys

import torch
from datasets import Dataset
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from trl import DPOConfig, DPOTrainer

sys.path.insert(0, os.getcwd())
from utils.run_logger import RunLogger


BASE_MODEL = os.environ.get("BASE_MODEL", "meta-llama/Llama-3.1-8B-Instruct")
SFT_ADAPTER_DIR = os.environ.get("SFT_ADAPTER_DIR", "")
SFT_HF_REPO = os.environ.get("SFT_HF_REPO", "PayMyBills/bestdealbot-v2")
PAIRS_PATH = os.environ.get("PAIRS_PATH", "data/dpo_pairs.jsonl")
REPO_ID = os.environ.get("REPO_ID", "PayMyBills/bestdealbot-v3-dpo")
HF_PUSH = os.environ.get("HF_PUSH", "0") == "1"
BETA = float(os.environ.get("BETA", "0.1"))
LR = float(os.environ.get("LR", "5e-6"))
EPOCHS = int(os.environ.get("EPOCHS", "1"))
MAX_LENGTH = int(os.environ.get("MAX_LENGTH", "1024"))
SEED = int(os.environ.get("SEED", "0"))


def load_pairs(path: str) -> Dataset:
    rows = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            prompt = obj.get("prompt") or ""
            chosen = obj.get("chosen") or ""
            rejected = obj.get("rejected") or ""
            if not (prompt and chosen and rejected):
                continue
            rows.append({"prompt": prompt, "chosen": chosen, "rejected": rejected})
    if not rows:
        raise RuntimeError(f"No valid pairs in {path}")
    print(f"Loaded {len(rows)} DPO pairs from {path}")
    return Dataset.from_list(rows)


def main() -> None:
    with RunLogger("dpo_8b") as log:
        log.config({
            "base_model": BASE_MODEL,
            "sft_adapter_dir": SFT_ADAPTER_DIR,
            "sft_hf_repo": SFT_HF_REPO,
            "pairs_path": PAIRS_PATH,
            "repo_id": REPO_ID,
            "beta": BETA,
            "lr": LR,
            "epochs": EPOCHS,
            "max_length": MAX_LENGTH,
            "seed": SEED,
        })

        torch.manual_seed(SEED)

        tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, use_fast=True)
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token

        bnb = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,
            bnb_4bit_use_double_quant=True,
        )
        base = AutoModelForCausalLM.from_pretrained(
            BASE_MODEL,
            quantization_config=bnb,
            device_map="auto",
            torch_dtype=torch.bfloat16,
        )

        adapter_src = SFT_ADAPTER_DIR or SFT_HF_REPO
        if not adapter_src:
            raise RuntimeError("Set SFT_ADAPTER_DIR or SFT_HF_REPO")
        print(f"Loading SFT/GRPO adapter from {adapter_src}")
        model = PeftModel.from_pretrained(base, adapter_src, is_trainable=True)
        model.print_trainable_parameters()

        ds = load_pairs(PAIRS_PATH)

        cfg = DPOConfig(
            output_dir=str(log.dir / "trainer"),
            num_train_epochs=EPOCHS,
            per_device_train_batch_size=1,
            gradient_accumulation_steps=8,
            learning_rate=LR,
            beta=BETA,
            max_length=MAX_LENGTH,
            max_prompt_length=MAX_LENGTH // 2,
            logging_steps=5,
            save_strategy="no",
            report_to=[],
            bf16=True,
            seed=SEED,
        )

        trainer = DPOTrainer(
            model=model,
            ref_model=None,
            args=cfg,
            train_dataset=ds,
            processing_class=tokenizer,
        )
        result = trainer.train()
        print(f"Training done: {result.metrics}")
        log.summary(result.metrics)

        adapter_out = log.dir / "adapter"
        adapter_out.mkdir(exist_ok=True)
        model.save_pretrained(adapter_out)
        tokenizer.save_pretrained(adapter_out)
        print(f"Adapter saved to {adapter_out}")

        if HF_PUSH:
            from huggingface_hub import HfApi
            api = HfApi()
            api.create_repo(repo_id=REPO_ID, exist_ok=True)
            api.upload_folder(
                folder_path=str(adapter_out),
                repo_id=REPO_ID,
                commit_message=f"DPO adapter trained on {len(ds)} pairs (beta={BETA}, lr={LR})",
            )
            print(f"Pushed to https://huggingface.co/{REPO_ID}")


if __name__ == "__main__":
    main()

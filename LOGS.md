# Sauda — full training + eval log dump

_Snapshot fetched 2026-04-26 11:59 UTC._ Re-fetch any time with the URLs below.

This file is a single-page receipt for every training run and eval that produced a published Sauda artifact. It pairs with [`BLOG.md`](BLOG.md) (the narrative) and the [training notebook](https://github.com/paymybills/BazaarBATNA/blob/main/training/train_colab.ipynb) (the recipe). The notebook's last cell re-runs all of these fetches live.

## Repo lineup

| Artifact | Repo | Account | Stage |
|---|---|---|---|
| Sauda v1 | [`PayMyBills/bestdealbot`](https://huggingface.co/PayMyBills/bestdealbot) | PayMyBills | 3B SFT+GRPO baseline |
| **Sauda v2** (canonical) | [`PayMyBills/bestdealbot-v2`](https://huggingface.co/PayMyBills/bestdealbot-v2) | PayMyBills | 8B SFT+GRPO |
| Sauda v2-tells | [`ankur-1232/bestdealbot-v2-tells`](https://huggingface.co/ankur-1232/bestdealbot-v2-tells) | ankur-1232 | 8B GRPO with tells in loop |
| Sauda v3 | [`ankur-1232/bestdealbot-v3`](https://huggingface.co/ankur-1232/bestdealbot-v3) | ankur-1232 | 8B DPO/RLAIF on top of v2 |

Eval dataset repos: [`PayMyBills/scaling-eval-runs`](https://huggingface.co/datasets/PayMyBills/scaling-eval-runs), [`ankur-1232/sauda-eval-runs`](https://huggingface.co/datasets/ankur-1232/sauda-eval-runs). DPO run artifacts: [`ankur-1232/dpo-runs`](https://huggingface.co/datasets/ankur-1232/dpo-runs).

---

## Sauda v2 (PayMyBills/bestdealbot-v2) — GRPO trainer_state

Source: <https://huggingface.co/PayMyBills/bestdealbot-v2/raw/main/last-checkpoint/trainer_state.json>

<details><summary>Per-step log (click to expand)</summary>

`global_step=30` · `epoch=0.2344` · `max_steps=30`

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

---

## Sauda v2-tells (ankur-1232/bestdealbot-v2-tells) — GRPO trainer_state

Source: <https://huggingface.co/ankur-1232/bestdealbot-v2-tells/raw/main/last-checkpoint/trainer_state.json>

<details><summary>Per-step log (click to expand)</summary>

`global_step=30` · `epoch=0.4688` · `max_steps=30`

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

---

## Sauda v3 (ankur-1232/bestdealbot-v3) — DPO config

Source: <https://huggingface.co/datasets/ankur-1232/dpo-runs/resolve/main/20260426_095235_dpo_8b/config.json>

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

---

## Sauda v3 — DPO training summary

Source: <https://huggingface.co/datasets/ankur-1232/dpo-runs/resolve/main/20260426_095235_dpo_8b/summary.json>

```json
{
  "train_runtime": 6.3588,
  "train_samples_per_second": 0.944,
  "train_steps_per_second": 0.157,
  "total_flos": 463433495003136.0,
  "train_loss": 0.6931471824645996
}
```

---

## Eval — scaling ladder, v2-tells injected at inference (3 tasks × 30 ep)

Source: <https://huggingface.co/datasets/PayMyBills/scaling-eval-runs/resolve/main/20260426_025930_scaling_eval/scaling_table.md>

| Buyer | Mean surplus | Deal rate | Mean rounds | n |
|---|---|---|---|---|
| hf_unsloth_Meta-Llama-3.1-8B-Instruct+PayMyBills_bestdealbot-v2_sauda_8b_v2_tells_on | 0.695 | 0.88 | 6.0 | 90 |

---

## Eval — Sauda v3 (per-task)

Source: <https://huggingface.co/datasets/ankur-1232/sauda-eval-runs/resolve/main/20260426_100451_ankur-1232-bestdealbot-v3/summary_hf_unsloth_Meta-Llama-3.1-8B-Instruct+ankur-1232_bestdealbot-v3_ankur-1232-bestdealbot-v3.json>

| task | n | mean_surplus | deal_rate | mean_rounds |
|---|---:|---:|---:|---:|
| single_deal | 10 | 0.8199 | 1.00 | 3.00 |
| asymmetric_pressure | 10 | 0.8070 | 1.00 | 3.70 |
| amazon_realistic | 10 | 0.4566 | 1.00 | 3.80 |

_meta: tag=`ankur-1232-bestdealbot-v3`, n_per_task=10, elapsed=304.7s, enable_nlp=False_

---

## Eval — Sauda v2-tells in-loop (per-task)

Source: <https://huggingface.co/datasets/ankur-1232/sauda-eval-runs/resolve/main/20260426_104614_ankur-1232-bestdealbot-v2-tells/summary_hf_unsloth_Meta-Llama-3.1-8B-Instruct+ankur-1232_bestdealbot-v2-tells_ankur-1232-bestdealbot-v2-tells.json>

| task | n | mean_surplus | deal_rate | mean_rounds |
|---|---:|---:|---:|---:|
| single_deal | 30 | 0.7920 | 1.00 | 3.00 |
| asymmetric_pressure | 30 | 0.7794 | 1.00 | 3.00 |
| amazon_realistic | 30 | 0.3888 | 1.00 | 2.90 |

_meta: tag=`ankur-1232-bestdealbot-v2-tells`, n_per_task=30, elapsed=400.0s, enable_nlp=True_

---

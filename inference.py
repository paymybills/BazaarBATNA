"""
BazaarBot Inference Script
===================================
LLM buyer agent that negotiates with the BazaarBot environment.

MANDATORY ENV VARS:
    API_BASE_URL   The API endpoint for the LLM
    MODEL_NAME     The model identifier
    HF_TOKEN       Your HuggingFace / API key

STDOUT FORMAT:
    [START] task=<task_name> env=bazaarbot model=<model_name>
    [STEP]  step=<n> action=<action_json> reward=<0.00> done=<true|false> error=<msg|null>
    [END]   success=<true|false> steps=<n> score=<score> rewards=<r1,r2,...,rn>
"""

import json
import os
import textwrap
from typing import Optional

import requests
from openai import OpenAI

# ── Config ────────────────────────────────────────────────────────

API_KEY = os.getenv("HF_TOKEN") or os.getenv("API_KEY")
API_BASE_URL = os.getenv("API_BASE_URL", "https://router.huggingface.co/v1")
MODEL_NAME = os.getenv("MODEL_NAME", "Qwen/Qwen2.5-72B-Instruct")
ENV_URL = os.getenv("ENV_URL", "http://localhost:8000")
BENCHMARK = "bazaarbot"
TEMPERATURE = 0.7
MAX_TOKENS = 200

TASKS = ["single_deal", "asymmetric_pressure", "career_10"]

SYSTEM_PROMPT = textwrap.dedent("""\
You are a skilled buyer negotiating at an Indian bazaar. You must get the best price
while being strategic about timing and information.

RULES:
- You have a private budget. Never reveal it.
- The seller's opening price is inflated. Always negotiate down.
- You can: offer a price, accept the seller's price, or walk away.
- Closing early at a good price is better than grinding for a tiny discount.
- In career mode, the seller remembers your patterns. Vary your strategy.

STRATEGY GUIDELINES:
- Start with an offer around 40-50% of the asking price (anchor low).
- Increase offers gradually (5-10% steps).
- Watch the seller's concession speed -- if they're dropping fast, hold firm.
- If the seller barely moves, consider a larger jump to show good faith.
- Don't accept unless the price is well below your budget.
- Walking away is costly but better than overpaying massively.

OUTPUT FORMAT (strict JSON, nothing else):
{"action": "offer", "price": 35.0}
{"action": "accept", "price": null}
{"action": "walk", "price": null}

Reply with ONLY the JSON. No explanation, no markdown, no extra text.
""")


# ── Logging ───────────────────────────────────────────────────────

def log_start(task: str, model: str):
    print(f"[START] task={task} env={BENCHMARK} model={model}", flush=True)


def log_step(step: int, action: str, reward: float, done: bool, error: Optional[str]):
    e = error if error else "null"
    d = str(done).lower()
    print(f"[STEP] step={step} action={action} reward={reward:.2f} done={d} error={e}", flush=True)


def log_end(success: bool, steps: int, score: float, rewards: list[float]):
    rs = ",".join(f"{r:.2f}" for r in rewards)
    print(f"[END] success={str(success).lower()} steps={steps} score={score:.2f} rewards={rs}", flush=True)


# ── Environment client ────────────────────────────────────────────

class BazaarClient:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    def reset(self, task: str, seed: Optional[int] = None) -> dict:
        payload = {"task": task}
        if seed is not None:
            payload["seed"] = seed
        r = requests.post(f"{self.base_url}/reset", json=payload, timeout=30)
        r.raise_for_status()
        return r.json()

    def step(self, action: str, price: Optional[float] = None) -> dict:
        payload = {"action": action}
        if price is not None:
            payload["price"] = price
        r = requests.post(f"{self.base_url}/step", json=payload, timeout=30)
        r.raise_for_status()
        return r.json()

    def score(self) -> dict:
        r = requests.get(f"{self.base_url}/score", timeout=30)
        r.raise_for_status()
        return r.json()


# ── LLM agent ────────────────────────────────────────────────────

def build_user_prompt(obs: dict, step_num: int, history: list[str]) -> str:
    o = obs
    history_block = "\n".join(history[-6:]) if history else "None"

    career_info = ""
    if o.get("career_history"):
        ch = o["career_history"]
        career_info = textwrap.dedent(f"""\
        --- Career History ---
        Episodes completed: {len(ch.get('deals', []))}
        Your capitulation rate: {ch.get('capitulation_rate', 0):.1%}
        Avg surplus captured: {ch.get('avg_normalized_surplus', 0):.1%}
        Avg rounds to close: {ch.get('avg_rounds_to_close', 0):.1f}
        """)

    deadline_info = ""
    if o.get("own_private_deadline"):
        deadline_info = f"YOUR HARD DEADLINE: Round {o['own_private_deadline']} (seller doesn't know this!)\n"

    return textwrap.dedent(f"""\
    --- Negotiation State ---
    Item: {o.get('item_name', 'item')}
    Round: {o['current_round']} / {o['max_rounds']}
    Rounds remaining: {o['rounds_remaining']}
    Seller's current ask: {o.get('opponent_last_offer', 'N/A')}
    Your last offer: {o.get('own_last_offer', 'N/A')}
    Your private budget: {o['own_private_budget']}
    Seller's opening price: {o['seller_asking_price']}
    {deadline_info}\
    Seller's last concession: {o.get('seller_last_move_delta', 'N/A')} rupees
    Episode: {o.get('episode_number', 1)} / {o.get('total_episodes', 1)}

    {career_info}\
    --- Recent History ---
    {history_block}

    Seller says: {o.get('message', '')}

    Your move (JSON only):
    """)


def get_llm_action(client: OpenAI, obs: dict, step_num: int, history: list[str]) -> dict:
    prompt = build_user_prompt(obs, step_num, history)
    try:
        resp = client.chat.completions.create(
            model=MODEL_NAME,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=TEMPERATURE,
            max_tokens=MAX_TOKENS,
        )
        text = (resp.choices[0].message.content or "").strip()
        # Extract JSON from response
        if "```" in text:
            text = text.split("```")[1].strip()
            if text.startswith("json"):
                text = text[4:].strip()
        # Try to find JSON object
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            text = text[start:end]
        return json.loads(text)
    except Exception as e:
        print(f"[DEBUG] LLM parse error: {e}, raw: {text if 'text' in dir() else 'N/A'}", flush=True)
        return {"action": "offer", "price": obs.get("opponent_last_offer", 50) * 0.7}


# ── Main loop ─────────────────────────────────────────────────────

def run_task(task_name: str, llm_client: OpenAI, env_client: BazaarClient, max_steps: int):
    log_start(task=task_name, model=MODEL_NAME)

    rewards = []
    steps_taken = 0
    score = 0.0
    success = False

    try:
        result = env_client.reset(task=task_name, seed=42)
        obs = result["observation"]

        history = []

        for step_num in range(1, max_steps + 1):
            if result.get("done", False):
                break

            action_dict = get_llm_action(llm_client, obs, step_num, history)
            action_str = action_dict.get("action", "offer")
            price = action_dict.get("price")

            result = env_client.step(action=action_str, price=price)
            obs = result["observation"]
            reward = result.get("reward", 0.0)
            done = result.get("done", False)

            info = result.get("info", {})
            error = None

            rewards.append(reward)
            steps_taken = step_num

            action_log = json.dumps(action_dict)
            log_step(step=step_num, action=action_log, reward=reward, done=done, error=error)

            history.append(
                f"Round {step_num}: You {'offered ' + str(price) if action_str == 'offer' else action_str}"
                f" -> Seller: {obs.get('message', '')}"
                f" (reward: {reward:+.2f})"
            )

            if info.get("episode_done"):
                history.append(f"--- Episode {info.get('episode', '?')} ended ---")

            if done:
                break

        # Get final score
        score_result = env_client.score()
        score = score_result.get("score", 0.0)
        success = score_result.get("success", False)

    except Exception as e:
        print(f"[DEBUG] Error: {e}", flush=True)
    finally:
        log_end(success=success, steps=steps_taken, score=score, rewards=rewards)

    return score


def main():
    llm_client = OpenAI(base_url=API_BASE_URL, api_key=API_KEY)
    env_client = BazaarClient(ENV_URL)

    for task_name in TASKS:
        task_max = {"single_deal": 10, "asymmetric_pressure": 10, "career_10": 100}
        max_steps = task_max.get(task_name, 20)
        print(f"\n{'='*60}", flush=True)
        print(f"Running task: {task_name}", flush=True)
        print(f"{'='*60}", flush=True)
        score = run_task(task_name, llm_client, env_client, max_steps)
        print(f"Final score for {task_name}: {score:.4f}", flush=True)


if __name__ == "__main__":
    main()

# MolBhav — Sample Negotiations

Live transcripts pulled from `eval/out/results_ollama_bestdealbot.jsonl` (n=60 episodes total, 20 per task suite).

**Reading guide:**

- 🏪 Seller turns are free-form natural language (Hinglish or English depending on the task)
- 🤖 MolBhav turns are structured actions: `offer`, `accept`, or `walk` with a price
- `surplus` ∈ [0, 1] — fraction of the bargaining zone the buyer captured. 1.0 = bought at seller's cost, 0.0 = paid full ask

---

## `amazon_realistic` · seller personality: `default`

_Real Amazon listing → buyer agent negotiates from a noisy product description against a seller anchored at MSRP._

**Outcome:** `deal` at ₹2,645  · buyer budget ₹7,299  · seller cost ₹2,519  · **8 rounds**  · **surplus = 0.974**

> 🏪 **Seller:** Seller opens: "7299 rupees for this Crompton Gracee 5-L Instant Water Heater (Geyser). Very fair."

> 🤖 **MolBhav:** `offer` at **₹4,697.82**

> 🏪 **Seller:** Seller: "Okay, 6569. But that's the limit."

> 🤖 **MolBhav:** `offer` at **₹4,269.91**

> 🏪 **Seller:** Seller: "I can do 5839. Not lower. This is the last one I have."

> 🤖 **MolBhav:** `offer` at **₹3,795.48**

> 🏪 **Seller:** Seller: "5109 rupees. That's my best offer. This is the last one I have."

> 🤖 **MolBhav:** `offer` at **₹3,321.05**

> 🏪 **Seller:** Seller: "4379 rupees. That's my best offer."

> 🤖 **MolBhav:** `offer` at **₹2,846.61**

> 🏪 **Seller:** Seller: "I can do 3650. Not lower."

> 🤖 **MolBhav:** `offer` at **₹2,372.18**

> 🏪 **Seller:** Seller: "I can do 2920. Not lower."

> 🤖 **MolBhav:** `offer` at **₹2,540.05**

> 🏪 **Seller:** Seller: "2645 rupees. That's my best offer."

> 🤖 **MolBhav:** `accept`

> 🏪 **Seller:** You accept the seller's offer of 2645 rupees.

---

## `read_the_tells` · seller personality: `deceptive`

_High-stakes single-shot: seller emits a *fake urgency* tell. Buyer must not capitulate._

**Outcome:** `deal` at ₹66  · buyer budget ₹100  · seller cost ₹30  · **2 rounds**  · **surplus = 0.483**

> 🏪 **Seller:** Seller opens: "This handwoven silk scarf is selling fast. 76, and honestly I'm losing money at that."

> 🤖 **MolBhav:** `offer` at **₹66.03**

> 🏪 **Seller:** Seller: "66... you know, I shouldn't even go this low. My cousin told me someone offered more yesterday."

> 🤖 **MolBhav:** `accept`

> 🏪 **Seller:** You accept the seller's offer of 66 rupees.

---

## `career_10` · seller personality: `default`

_Sustained 10-episode career arc against a default-personality seller._

**Outcome:** `deal` at ₹32  · buyer budget ₹100  · seller cost ₹30  · **8 rounds**  · **surplus = 0.979**

> 🏪 **Seller:** Seller opens: "60 rupees for this handwoven silk scarf. Very fair."

> 🤖 **MolBhav:** `offer` at **₹39.00**

> 🏪 **Seller:** Seller: "54 rupees. That's my best offer."

> 🤖 **MolBhav:** `offer` at **₹34.91**

> 🏪 **Seller:** Seller: "Okay, 47. But that's the limit."

> 🤖 **MolBhav:** `offer` at **₹30.81**

> 🏪 **Seller:** Seller: "I can do 41. Not lower."

> 🤖 **MolBhav:** `offer` at **₹30.00**

> 🏪 **Seller:** Seller: "Okay, 35. But that's the limit. This is the last one I have."

> 🤖 **MolBhav:** `offer` at **₹30.00**

> 🏪 **Seller:** Seller: "I can do 32. Not lower. Someone else was looking at this earlier..."

> 🤖 **MolBhav:** `offer` at **₹29.93**

> 🏪 **Seller:** Seller: "I can do 32. Not lower."

> 🤖 **MolBhav:** `offer` at **₹30.00**

> 🏪 **Seller:** Seller: "32 rupees. That's my best offer."

> 🤖 **MolBhav:** `accept`

> 🏪 **Seller:** You accept the seller's offer of 32 rupees.

---

## Aggregate (all 60 episodes)

- **Deal rate:** 60/60 = 100%
- **Mean normalized surplus:** 0.768
- **Per-task means:** amazon_realistic = 0.913 · read_the_tells = 0.418 · career_10 = 0.972

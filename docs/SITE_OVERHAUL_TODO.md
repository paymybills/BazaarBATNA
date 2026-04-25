# BazaarBATNA Site Overhaul — TODO

> **For: Gemini / Copilot / any LLM scaffolding the site work.**
> **From: paymybills (handing off solo to focus on buyer training + extractor eval).**
> **Deadline: tomorrow before 5pm venue.**
> **Repo: existing `ui/` directory in this project (Next.js 16 + React 19 + Tailwind 4 + app router).**

This doc is self-contained. Read it once, then build.

---

## Context

**BazaarBATNA** is an OpenEnv-compliant negotiation environment. We trained an agent
(Sauda / bestdealbot) that beats baselines by 3×. The existing `ui/` is functional but
demo-weak — judges land here and it doesn't sell the work. Your job: overhaul it into a
**demo-first platform site** that judges can hit, immediately understand, and play with.

**The product is the agent.** The env is the workshop where we built it. Site emphasis stays
on the agent, with the env as supporting evidence.

**Sister landing repo:** `paymybills/Sauda` is a separate static landing page on Vercel.
This site (`ui/`) is the **interactive platform** — where you actually play, watch replays,
see leaderboards. The two link to each other but serve different purposes.

---

## Architecture constraints (DO NOT BREAK)

The existing `ui/` already has these routes — keep them working:

```
ui/app/
├── page.tsx          ← dashboard (overhaul this)
├── arena/            ← multi-buyer competition (keep)
├── leaderboard/      ← agent rankings (keep, polish)
├── negotiate/        ← play as buyer (keep)
├── replay/           ← review past sessions (keep, polish)
├── sell/             ← play as seller (keep, this is where /play lives)
├── spectate/         ← watch AI vs seller (keep, polish)
├── components/
├── layout.tsx
├── globals.css
└── lib/api.ts        ← API client to FastAPI backend
```

**Tech stack (read `ui/AGENTS.md` first — it warns Next.js 16 has breaking changes from 15):**
- Next.js 16.2.3 with app router
- React 19.2.4
- Tailwind 4 (with `@theme inline` mapping in `globals.css`)
- TypeScript
- `lucide-react` for icons (already installed)
- `recharts` for charts (already installed)

**API backend** is a FastAPI server at `http://localhost:8000` (configurable via env var).
Existing endpoints: `/tasks`, `/reset`, `/step`, `/state`, `/score`. **Don't change the API
contract.** All UI work hits these existing routes.

---

## The new home page (highest priority)

The current home is a generic dashboard. Replace with a **demo-first hero** that does three things in order:

### 1. Hero section
- Tagline: "The negotiation agent that reads what the seller doesn't say."
- Subhead: 1-2 lines explaining BazaarBATNA = env, Sauda = agent.
- Two CTAs:
  - **"Try it →"** — links to `/sell` (user plays seller, Sauda plays buyer)
  - **"Watch a replay →"** — links to `/replay` with a pre-selected impressive one
- Animated background or subtle hero visual (no heavy 3D — keep it fast)

### 2. Headline numbers strip
Pull from `eval/out/summary_ollama_bestdealbot.json` (or hardcode initially):
- **+131%** surplus vs rule-based
- **+916%** on read_the_tells
- **100%** deal rate
- **7 GB** GPU footprint

Use the same `<Stat>` component pattern as `Sauda/app/page.tsx` (clone it).

### 3. The four pillars
Same content as Sauda landing page (NLP extractor, Bayesian steering, synthetic data, DPO),
but more compact — this is a platform site, not a marketing page.

### 4. "Try the playable demo" callout
Big card linking to `/sell` with a mini preview screenshot. This is the killer feature so it
gets prime real estate.

### 5. Eval table
Same table as Sauda: rule_based vs llama3.2:3b vs bestdealbot across 3 tasks. Highlight
bestdealbot row.

### 6. Footer
Links to: GitHub, Sauda landing, HF model card (`PayMyBills/bestdealbot`), HF blog (when written).

---

## The `/sell` page (the demo) — second priority

This is where users play seller against Sauda. **Mirror the Chicago HAI Kellogg study UX.**

### Layout

Two-column desktop, stacked mobile:

```
┌─────────────────────────────┬──────────────────────┐
│  Role brief (left)          │  Live tells (right)  │
│  - You're selling X         │  Per-turn extractor  │
│  - Asking price             │  output:             │
│  - Reservation: $Y (secret) │  - urgency: 0.7      │
│  - Bonus: $1/$100 above res │  - deception: 0.3    │
│  - Persona: firm            │  - condition: good   │
│                             │  ...                 │
│  Chat thread                │                      │
│  ┌──────────────────────┐   │                      │
│  │ Seller: I'm asking…  │   │                      │
│  │ Sauda: I can do…   │   │                      │
│  │ Seller: [input]      │   │                      │
│  └──────────────────────┘   │                      │
│  [send button]              │                      │
└─────────────────────────────┴──────────────────────┘
```

### Behavior
- On page load: fetch a random listing + role brief from API (`POST /reset` with `role=seller`)
- Show role brief on the left
- Sauda opens with a counter-offer (or user opens — match training distribution)
- User types in the textarea, hits send
- Send: POST to `/step` with the seller message + price (parsed from text)
- Response: Sauda's reply + tells extracted from user's last message + whether Sauda accepted/walked
- **Render extracted tells in the right panel after each user turn.** Static panel, NOT live overlay (per IMPLEMENTATION_PLAN.md).
- Show "buyer is thinking…" loading state during the API call (latency is real)

### Tells panel

For each tell signal, show:
- Bar/gauge showing 0-1 value
- Label and color (green=low, yellow=mid, red=high)
- Tooltip on hover: "what triggered this"

12 signals total. Group them visually:
- **Verbal:** urgency, confidence, deception_cue, speed
- **Behavioral (placeholder for future):** fidget, posture, eye_contact (mark these as "synthetic" — we don't have real signals)
- **Condition:** condition_label, condition_score, depreciation_score

### Stretch: artificial stakes for engagement

Show the user a fake leaderboard at the top: "Top human sellers this week: 0.78 / 0.71 /
0.65 (seller_share). Beat them?" This is engagement bait — they have no real incentive to
hold out without it.

After the negotiation ends, reveal:
- Their seller_share
- Sauda's buyer_share
- "You came in at the 67th percentile of human sellers" (fake, but motivating)

---

## The `/replay` page polish

Existing replay page works. Make it impressive:

- **Sharable URL per replay** — `/replay/[id]` deep-links to a specific transcript
- **Auto-play mode** — turn-by-turn with timing, like watching a chess game
- **Tells panel updates per turn** as you scrub through
- **Pre-curated "highlight reel"** — pick 3-5 impressive replays from `eval/out/results_ollama_bestdealbot.jsonl` (already in repo) and feature them on the home page

To find good replays:
- Sort `eval/out/results_ollama_bestdealbot.jsonl` by `normalized_surplus`
- Pick top deceptive-seller win (the money shot — agent didn't fall for fake urgency)
- Pick a long-haggle episode (8+ rounds)
- Pick a walk where Sauda correctly walked

---

## The `/leaderboard` page polish

- Live numbers from `eval/out/summary_*.json`
- One row per policy: rule_based, llama3.2:3b baseline, bestdealbot
- Per-task breakdown
- Confidence intervals when we have them (post symmetric scoring)
- "Submit your agent" CTA → links to GitHub README submission flow (doesn't have to work end-to-end, just look real)

---

## Visual direction

**Reference aesthetics:** Anthropic's claude.ai or Linear.app — clean editorial, lots of
whitespace, big readable type. Not Vercel-marketing-glitz, not HuggingFace-info-dense. The
existing site uses a dark-by-default theme with `--foreground` / `--background` CSS vars —
keep that.

**Don't add:**
- Glassmorphism / heavy blur
- Animated gradients in the hero
- Anything that requires a third-party animation library
- Scroll-driven hijack effects
- Auto-playing video

**Do add:**
- Subtle hover states (already in use: `hover:border-foreground/20`)
- Smooth transitions on state changes
- Loading skeletons for API calls
- Keyboard accessibility (focus states, ARIA labels)

---

## Concrete checklist

### Tier 1 — must ship
- [ ] Overhaul `ui/app/page.tsx` with hero + numbers + pillars + demo callout + eval table
- [ ] Build out `/sell` page with role brief + chat + tells panel layout
- [ ] Wire `/sell` to existing API endpoints (`/reset`, `/step`)
- [ ] Curate 3 highlight replays on the home page linking to `/replay/[id]`
- [ ] Polish `/replay` with sharable URLs + auto-play
- [ ] Polish `/leaderboard` to read from summary JSONs

### Tier 2 — strong to have
- [ ] Mobile responsive (stack columns on `/sell`)
- [ ] Loading skeletons for all API-dependent components
- [ ] OG image for social sharing (`public/og.png`)
- [ ] Keyboard shortcuts for `/sell` (Enter to send, Esc to walk)

### Tier 3 — only if time
- [ ] Artificial stakes leaderboard on `/sell`
- [ ] Tells gauges with smooth value transitions
- [ ] Replay highlight reel with annotations on key turns

### Out of scope
- Authentication / accounts
- Real-time websockets (HTTP-only is fine)
- Mobile-first redesign — desktop priority, mobile responsive enough
- Live floating Grammarly-style overlay on textarea
- Building any new API routes

---

## How to start

```bash
cd ui
npm install   # if not already
npm run dev   # localhost:3000

# inspect the existing routes to understand the pattern
ls app/
cat app/page.tsx
cat app/lib/api.ts

# read the warnings
cat AGENTS.md
```

Read `ui/AGENTS.md` first — it warns about Next.js 16 breaking changes. **Always check
`ui/node_modules/next/dist/docs/` before assuming an API works.** Don't trust your training
data on Next.js conventions.

---

## API reference (existing endpoints)

```
GET  /tasks                 → { task_id: TaskInfo }
POST /reset                 → starts new episode, returns initial state
POST /step                  → { action, price?, message? } → returns new state
GET  /state                 → current episode state
GET  /score                 → current episode score
GET  /health                → ping
```

Look at `ui/app/lib/api.ts` for the existing client wrapper. Use it. Don't reinvent.

---

## Acceptance — site is done when

- [ ] Home page in 1 sentence explains what BazaarBATNA + Sauda are
- [ ] First-time visitor finds and clicks "Try it" within 10 seconds
- [ ] `/sell` page lets a user play one full negotiation against Sauda with tells panel
- [ ] At least 3 curated replays are accessible from home
- [ ] Eval numbers are visible from home, accurate, and link to source data
- [ ] Site is responsive on a 13" laptop and a phone
- [ ] No console errors in browser
- [ ] Lighthouse performance score ≥ 80

When acceptance numbers pass, commit on a branch like `site/overhaul`, open a PR, ping
paymybills.

---

## If the LLM scaffolding this gets stuck

Common pitfalls:
1. **Don't assume Next.js 15 patterns** — read `node_modules/next/dist/docs/` for v16 behavior
2. **Don't add new API routes** — work through existing FastAPI endpoints
3. **Don't import from `ui/CLAUDE.md`'s training-data shape of Next** — it has explicit warnings
4. **Don't break the existing pages** — they work. Polish, don't rewrite.
5. **Use the existing `<Stat>` and `<Pillar>` patterns from `Sauda/app/page.tsx`** — clone the components rather than inventing new ones

If something is unclear, check IMPLEMENTATION_PLAN.md in the repo root — pinned sections
explain the framing, conversation realism rules, and demo plan.

---

## Time estimate

- Home overhaul: 2-3h
- `/sell` page (the demo): 3-4h
- Replay + leaderboard polish: 2h
- Mobile + a11y pass: 1h
- **~8 hours total.**

If you hit 12 hours, drop Tier 2 + Tier 3 and ship Tier 1 only.

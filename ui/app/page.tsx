"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ArrowRight } from "lucide-react";

/* ─────────────────────────────────────────────────────────
   Hero — GSAP entrance: chars stagger, accent rule draws
   ───────────────────────────────────────────────────────── */
function Hero() {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const subRef = useRef<HTMLParagraphElement>(null);
  const ruleRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const eyebrowRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const title = titleRef.current;
    if (!title) return;

    const text = title.textContent || "";
    title.innerHTML = text
      .split(" ")
      .map(
        (w) =>
          `<span class="inline-block opacity-0 translate-y-[40%]">${w}</span>`
      )
      .join(" ");

    const words = title.querySelectorAll("span");
    const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

    tl.to(eyebrowRef.current, { opacity: 1, y: 0, duration: 0.5 }, 0)
      .to(words, { opacity: 1, y: 0, duration: 0.9, stagger: 0.07 }, 0.1)
      .to(ruleRef.current, { scaleX: 1, duration: 1.0, ease: "power2.inOut" }, 0.4)
      .to(subRef.current, { opacity: 1, y: 0, duration: 0.6 }, 0.6)
      .to(stackRef.current, { opacity: 1, y: 0, duration: 0.5 }, 0.85)
      .to(ctaRef.current, { opacity: 1, y: 0, duration: 0.6 }, 1.0);
  }, []);

  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 bg-grid pointer-events-none" />
      <div className="relative max-w-7xl mx-auto px-6 pt-28 pb-32 md:pt-36 md:pb-44">
        <div
          ref={eyebrowRef}
          className="text-eyebrow opacity-0 translate-y-2 mb-6"
        >
          OpenEnv · Negotiation Playground
        </div>

        <h1 ref={titleRef} className="text-display max-w-5xl">
          Watch agents haggle. Step in yourself.
        </h1>

        <div
          ref={ruleRef}
          className="accent-line mt-10 origin-left scale-x-0 max-w-md"
        />

        <p
          ref={subRef}
          className="opacity-0 translate-y-3 max-w-2xl mt-8 text-fg2 text-lg leading-relaxed"
        >
          A negotiation environment with observable tells and hidden reservation
          prices. Buyer and seller are both LLMs — Sauda on the buy side,
          Gemma-4-E4B on the sell side. Strategy improves through self-play;
          drop in as a seller, watch the arena, or scrub a replay.
        </p>
        <div
          ref={stackRef}
          className="opacity-0 translate-y-3 mt-5 flex flex-wrap items-center gap-2"
        >
          <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-[11px] font-mono tracking-wide text-accent">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" aria-hidden />
            Powered by RLAIF
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2/40 px-3 py-1 text-[11px] font-mono tracking-wide text-fg2">
            OpenEnv-compliant
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2/40 px-3 py-1 text-[11px] font-mono tracking-wide text-fg2">
            8B · QLoRA
          </span>
        </div>

        <div
          ref={ctaRef}
          className="opacity-0 translate-y-3 mt-10 flex flex-wrap gap-3"
        >
          <Link
            href="/sell"
            className="inline-flex items-center gap-2 rounded-md bg-accent text-background px-5 py-3 text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Play as seller
            <ArrowRight size={16} />
          </Link>
          <Link
            href="/spectate"
            className="inline-flex items-center gap-2 rounded-md border border-border-2 px-5 py-3 text-sm text-foreground hover:border-foreground/40 transition-colors"
          >
            Watch a live arena
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────
   Routes — 4 big tiles. The site IS the routes.
   ───────────────────────────────────────────────────────── */
type Route = {
  href: string;
  label: string;
  desc: string;
  badge?: string;
  accent?: string;
};

const ROUTES: Route[] = [
  {
    href: "/sell",
    label: "Play",
    desc: "You're the seller. Sauda haggles you down.",
    badge: "interactive",
    accent: "accent",
  },
  {
    href: "/spectate",
    label: "Spectate",
    desc: "Watch the agent vs a scripted seller, turn by turn.",
    badge: "live",
    accent: "accent",
  },
  {
    href: "/arena",
    label: "Arena",
    desc: "Multiple buyers compete for the same listing.",
    badge: "experimental",
    accent: "accent-2",
  },
  {
    href: "/replay",
    label: "Replay",
    desc: "60 logged episodes. Scrub through any of them.",
    accent: "accent-2",
  },
];

function RouteCard({ route, index }: { route: Route; index: number }) {
  const ref = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let cleanup = () => {};
    (async () => {
      const { ScrollTrigger } = await import("gsap/ScrollTrigger");
      gsap.registerPlugin(ScrollTrigger);
      const tween = gsap.fromTo(
        el,
        { opacity: 0, y: 30 },
        {
          opacity: 1,
          y: 0,
          duration: 0.7,
          delay: 0.05 * index,
          ease: "power3.out",
          scrollTrigger: {
            trigger: el,
            start: "top 90%",
            toggleActions: "play none none none",
          },
        }
      );
      cleanup = () => {
        tween.scrollTrigger?.kill();
        tween.kill();
      };
    })();

    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      gsap.to(el, {
        rotateY: x * 4,
        rotateX: -y * 4,
        duration: 0.4,
        ease: "power2.out",
      });
    };
    const onLeave = () => {
      gsap.to(el, { rotateY: 0, rotateX: 0, duration: 0.6, ease: "power3.out" });
    };
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
      cleanup();
    };
  }, [index]);

  const accentColor =
    route.accent === "accent-2" ? "var(--accent-2)" : "var(--accent)";

  return (
    <Link
      ref={ref}
      href={route.href}
      className="group relative block rounded-xl border border-border bg-surface p-6 md:p-8 overflow-hidden card-hover"
      style={{ transformStyle: "preserve-3d" }}
    >
      <div
        className="absolute inset-x-0 top-0 h-px opacity-50"
        style={{
          background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)`,
        }}
      />
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col">
          <div className="text-3xl md:text-4xl font-semibold tracking-tight text-foreground">
            {route.label}
          </div>
          <p className="text-fg2 text-sm md:text-base mt-2 max-w-xs leading-relaxed">
            {route.desc}
          </p>
        </div>
        {route.badge && (
          <span
            className="text-eyebrow mt-1.5"
            style={{ color: accentColor, opacity: 0.85 }}
          >
            {route.badge}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 mt-10 text-fg2 text-sm group-hover:text-foreground transition-colors">
        Open
        <ArrowRight
          size={14}
          className="transition-transform group-hover:translate-x-1"
        />
      </div>
    </Link>
  );
}

function Routes() {
  return (
    <section className="max-w-7xl mx-auto px-6 py-24" id="routes">
      <div className="flex items-baseline justify-between mb-10">
        <h2 className="text-h1">Pick a way in</h2>
        <Link
          href="/replay"
          className="text-meta hover:text-foreground transition-colors"
        >
          replays →
        </Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {ROUTES.map((r, i) => (
          <RouteCard key={r.href} route={r} index={i} />
        ))}
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────
   State of the playground — receipts, not marketing
   ───────────────────────────────────────────────────────── */
type Row = {
  policy: string;
  share: number;
  win: number;
  loss: number;
  rounds: number;
  highlight?: boolean;
};

// Sauda v2 — fresh scaling-ladder eval against the hardened seller
// (Gemma-4-E4B, post-`ef753a6`). 90 episodes per policy across
// single_deal / asymmetric_pressure / amazon_realistic. n=30 per task.
// Source: PayMyBills/scaling-eval-runs on HF.
const ROWS_V2: Row[] = [
  { policy: "llama-3.2-3b base", share: 0.570, win: 0.67, loss: 0.00, rounds: 2.2 },
  { policy: "llama-3.1-8b base", share: 0.686, win: 0.73, loss: 0.01, rounds: 3.1 },
  {
    policy: "sauda v2 (8b sft+grpo)",
    share: 0.799,
    win: 0.64,
    loss: 0.09,
    rounds: 6.0,
    highlight: true,
  },
];

// Sauda v1 — earlier eval against the leaky-seller (pre-`ef753a6`).
// Kept for transparency. Numbers look better because the seller didn't
// enforce its own reservation. 60 episodes per policy across
// amazon_realistic / read_the_tells / career_10. n=20 per task.
const ROWS_V1: Row[] = [
  { policy: "rule_based", share: 0.621, win: 0.37, loss: 0.33, rounds: 3.2 },
  { policy: "baseline:llama3.2:3b", share: 0.471, win: 0.33, loss: 0.12, rounds: 2.0 },
  {
    policy: "ollama:bestdealbot (v1)",
    share: 0.767,
    win: 0.67,
    loss: 0.0,
    rounds: 5.8,
    highlight: true,
  },
];

type TabId = "v2" | "v1";

const TABS: { id: TabId; label: string; eyebrow: string; sub: string }[] = [
  {
    id: "v2",
    label: "Sauda v2",
    eyebrow: "current build",
    sub: "Llama-3.1-8B QLoRA · SFT + GRPO · 90 ep × 3 tasks · hardened seller",
  },
  {
    id: "v1",
    label: "Sauda v1",
    eyebrow: "earlier build",
    sub: "Llama-3.2-3B QLoRA · 60 ep × 3 tasks · leaky seller (pre-fix)",
  },
];

function ReceiptsTable({ rows }: { rows: Row[] }) {
  return (
    <table className="w-full text-sm font-mono">
      <thead className="bg-surface-2/50">
        <tr>
          <th className="text-left px-5 py-3 text-fg3 font-normal">policy</th>
          <th className="text-right px-5 py-3 text-fg3 font-normal">buyer_share</th>
          <th className="text-right px-5 py-3 text-fg3 font-normal">win_rate</th>
          <th className="text-right px-5 py-3 text-fg3 font-normal">mutual_loss</th>
          <th className="text-right px-5 py-3 text-fg3 font-normal">rounds</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.policy}
            className={`border-t border-border/60 ${r.highlight ? "bg-accent/5" : ""}`}
          >
            <td
              className={`px-5 py-3.5 ${r.highlight ? "text-foreground font-semibold" : "text-fg2"}`}
            >
              {r.policy}
            </td>
            <td
              className={`text-right px-5 py-3.5 tabular-nums ${r.highlight ? "text-accent" : "text-foreground"}`}
            >
              {r.share.toFixed(3)}
            </td>
            <td className="text-right px-5 py-3.5 tabular-nums text-foreground">
              {(r.win * 100).toFixed(0)}%
            </td>
            <td
              className={`text-right px-5 py-3.5 tabular-nums ${
                r.loss === 0 ? "text-good" : r.loss > 0.2 ? "text-bad" : "text-foreground"
              }`}
            >
              {(r.loss * 100).toFixed(0)}%
            </td>
            <td className="text-right px-5 py-3.5 tabular-nums text-fg2">
              {r.rounds.toFixed(1)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StateOfPlayground() {
  const [tab, setTab] = useState<TabId>("v2");
  const active = TABS.find((t) => t.id === tab) ?? TABS[0];
  const rows = tab === "v2" ? ROWS_V2 : ROWS_V1;

  return (
    <section className="max-w-7xl mx-auto px-6 py-24 border-t border-border/60">
      <div className="grid md:grid-cols-[1fr_2fr] gap-10 md:gap-16">
        <div>
          <div className="text-eyebrow mb-4">State of the playground</div>
          <h2 className="text-h2 max-w-md">Three policies. Three task suites. Receipts on file.</h2>
          <p className="text-fg2 mt-5 text-sm leading-relaxed max-w-md">
            Buyer-share is the fraction of bargaining surplus the agent
            captured. Mutual-loss is how often it walked away from a
            winnable deal. Sauda v2 captures the most surplus per close;
            it&apos;s also the only buyer that walks when the deal is bad.
          </p>
          <Link
            href="/replay"
            className="inline-flex items-center gap-2 text-meta hover:text-foreground mt-6 transition-colors"
          >
            see all replays <ArrowRight size={14} />
          </Link>
        </div>

        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          <div className="flex border-b border-border/60 bg-surface-2/30">
            {TABS.map((t) => {
              const isActive = t.id === tab;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`flex-1 px-5 py-3.5 text-left transition-colors border-r border-border/60 last:border-r-0 ${
                    isActive
                      ? "bg-surface text-foreground"
                      : "text-fg3 hover:bg-surface-2/60 hover:text-fg2"
                  }`}
                  aria-pressed={isActive}
                >
                  <div className="flex items-baseline gap-2">
                    <span className={`text-eyebrow ${isActive ? "text-accent" : "text-fg3"}`}>
                      {t.eyebrow}
                    </span>
                    <span
                      className={`text-sm font-mono ${
                        isActive ? "text-foreground font-semibold" : "text-fg2"
                      }`}
                    >
                      {t.label}
                    </span>
                  </div>
                  <div className="text-meta mt-1 text-xs">{t.sub}</div>
                </button>
              );
            })}
          </div>
          <ReceiptsTable rows={rows} />
          {tab === "v1" ? (
            <div className="px-5 py-3 border-t border-border/60 bg-surface-2/40 text-meta text-xs leading-relaxed">
              Caveat: v1 ran against an earlier seller that didn&apos;t auto-accept
              at reservation. Numbers look great because the seller leaked
              surplus. After hardening the seller, Sauda v2 is the canonical
              comparison.{" "}
              <a
                href="https://github.com/paymybills/BazaarBATNA/blob/main/docs/BLOG.md"
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:text-foreground underline-offset-4 hover:underline transition-colors"
              >
                full story →
              </a>
            </div>
          ) : (
            <div className="px-5 py-3 border-t border-border/60 bg-surface-2/40 text-meta text-xs leading-relaxed">
              {active.sub}.{" "}
              <a
                href="https://huggingface.co/datasets/PayMyBills/scaling-eval-runs"
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:text-foreground underline-offset-4 hover:underline transition-colors"
              >
                raw eval data →
              </a>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────
   Why this exists — the story, kept tight
   ───────────────────────────────────────────────────────── */
function Story() {
  return (
    <section className="max-w-7xl mx-auto px-6 py-24 border-t border-border/60">
      <div className="text-eyebrow mb-6">Why this exists</div>
      <div className="grid md:grid-cols-3 gap-10 md:gap-14">
        <div>
          <div className="text-h2 mb-3">Tells are noisy and observable.</div>
          <p className="text-fg2 leading-relaxed text-sm">
            Real bargaining isn&apos;t about price alone. Sellers fidget,
            anchor early, claim outside pressure. Most negotiation envs throw
            those signals away. Ours surfaces twelve of them as first-class
            observations.
          </p>
        </div>
        <div>
          <div className="text-h2 mb-3">Information is asymmetric.</div>
          <p className="text-fg2 leading-relaxed text-sm">
            The buyer never sees the seller&apos;s reservation. The seller
            never sees the budget. Both sides infer. The whole point of the
            agent is to do that inference better than rules can.
          </p>
        </div>
        <div>
          <div className="text-h2 mb-3">Strategy is trained, not prompted.</div>
          <p className="text-fg2 leading-relaxed text-sm">
            The buyer was trained on this env through SFT, GRPO, and RLAIF/DPO.
            That&apos;s why it negotiates twice as long as base models and
            captures more surplus per close — the env&apos;s reward shape made
            it. The repo is public if you want to train your own.{" "}
            <a
              href="#training"
              className="text-accent hover:text-foreground underline-offset-4 hover:underline transition-colors"
            >
              How it&apos;s trained →
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────
   How it works — overview + dual-LLM + RLAIF intro
   ───────────────────────────────────────────────────────── */
function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="max-w-7xl mx-auto px-6 py-24 border-t border-border/60 scroll-mt-20"
    >
      <div className="text-eyebrow mb-6">How it works</div>
      <h2 className="text-h1 max-w-3xl mb-10">
        Two LLMs negotiate. One of them learned how through RLAIF.
      </h2>

      <div className="grid md:grid-cols-2 gap-10 md:gap-16 mb-16">
        <div>
          <p className="text-fg2 leading-relaxed text-base">
            BazaarBATNA is an OpenEnv-compliant environment where buyer and
            seller are both language models. The buyer is{" "}
            <span className="text-foreground font-mono text-sm bg-surface-2/60 px-1.5 py-0.5 rounded">
              Sauda
            </span>{" "}
            (Llama-3.1-8B + LoRA, trained on this env). The seller is{" "}
            <span className="text-foreground font-mono text-sm bg-surface-2/60 px-1.5 py-0.5 rounded">
              Gemma-4-E4B
            </span>{" "}
            with persona instructions and four hard rules baked into code:
            never accept below reservation, never leak it in messages, counter
            monotonically toward the buyer, anchor with item details.
          </p>
          <p className="text-fg2 leading-relaxed text-base mt-5">
            Both sides infer through asymmetric information. The buyer never
            sees the seller&apos;s reservation. The seller never sees the
            buyer&apos;s budget. The whole system tests whether trained
            behaviour beats prompted behaviour at this game.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-6 md:p-8">
          <SystemDiagram />
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <FactCard
          eyebrow="env"
          title="OpenEnv FastAPI"
          body="/reset, /step, /state, /score, /tasks. Eight task suites, four seller personas, real Amazon listings as price anchors."
        />
        <FactCard
          eyebrow="buyer"
          title="Sauda — Llama-3.1-8B + LoRA"
          body="Trained on this env through SFT → GRPO → RLAIF/DPO. Outputs structured JSON action plus a Hinglish/English message."
        />
        <FactCard
          eyebrow="seller"
          title="Gemma-4-E4B"
          body="Persona-prompted. Four code-enforced rules. Auto-accepts at reservation. 50-ep quality eval passes 5 of 6 acceptance criteria."
        />
      </div>
    </section>
  );
}

function FactCard({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="text-eyebrow mb-3" style={{ color: "var(--accent)" }}>
        {eyebrow}
      </div>
      <div className="text-foreground font-semibold text-base mb-2">{title}</div>
      <p className="text-fg2 text-sm leading-relaxed">{body}</p>
    </div>
  );
}

function SystemDiagram() {
  // Horizontal lanes: buyer (left) ↔ env (centre) ↔ seller (right).
  // Top lane: action / offer  (request)
  // Bottom lane: obs+tells / message (response)
  return (
    <svg
      viewBox="0 0 480 260"
      className="w-full h-auto"
      role="img"
      aria-label="BazaarBATNA system architecture"
    >
      <defs>
        <marker
          id="arrowSys"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0,0 L10,5 L0,10 z" fill="var(--fg3)" />
        </marker>
      </defs>

      {/* Buyer */}
      <rect x="14" y="80" width="120" height="80" rx="8" fill="var(--surface-2)" stroke="var(--accent)" strokeWidth="1.5" />
      <text x="74" y="103" textAnchor="middle" fontSize="10" fontFamily="monospace" fill="var(--accent)">BUYER</text>
      <text x="74" y="123" textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--foreground)">Sauda</text>
      <text x="74" y="140" textAnchor="middle" fontSize="9" fontFamily="monospace" fill="var(--fg2)">Llama-3.1-8B</text>
      <text x="74" y="152" textAnchor="middle" fontSize="9" fontFamily="monospace" fill="var(--fg3)">+ LoRA + steering</text>

      {/* Env (centre) */}
      <rect x="180" y="60" width="120" height="120" rx="8" fill="var(--surface)" stroke="var(--fg2)" strokeWidth="1.5" />
      <text x="240" y="83" textAnchor="middle" fontSize="10" fontFamily="monospace" fill="var(--fg2)">OPENENV</text>
      <text x="240" y="103" textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--foreground)">BazaarBATNA</text>
      <text x="240" y="118" textAnchor="middle" fontSize="9" fontFamily="monospace" fill="var(--fg3)">FastAPI</text>
      <line x1="195" y1="128" x2="285" y2="128" stroke="var(--border)" strokeWidth="0.8" />
      <text x="240" y="142" textAnchor="middle" fontSize="9" fontFamily="monospace" fill="var(--fg3)">/reset /step</text>
      <text x="240" y="155" textAnchor="middle" fontSize="9" fontFamily="monospace" fill="var(--fg3)">/state /score</text>
      <text x="240" y="168" textAnchor="middle" fontSize="9" fontFamily="monospace" fill="var(--fg3)">/tasks /health</text>

      {/* Seller */}
      <rect x="346" y="80" width="120" height="80" rx="8" fill="var(--surface-2)" stroke="var(--accent-2)" strokeWidth="1.5" />
      <text x="406" y="103" textAnchor="middle" fontSize="10" fontFamily="monospace" fill="var(--accent-2)">SELLER</text>
      <text x="406" y="123" textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--foreground)">Gemma-4-E4B</text>
      <text x="406" y="140" textAnchor="middle" fontSize="9" fontFamily="monospace" fill="var(--fg2)">persona prompt</text>
      <text x="406" y="152" textAnchor="middle" fontSize="9" fontFamily="monospace" fill="var(--fg3)">+ 4 hard rules</text>

      {/* Buyer → Env (top) */}
      <line x1="134" y1="100" x2="180" y2="100" stroke="var(--fg3)" strokeWidth="1.2" markerEnd="url(#arrowSys)" />
      <text x="157" y="93" fontSize="9" fontFamily="monospace" fill="var(--fg3)" textAnchor="middle">action</text>

      {/* Env → Buyer (bottom) */}
      <line x1="180" y1="140" x2="134" y2="140" stroke="var(--fg3)" strokeWidth="1.2" markerEnd="url(#arrowSys)" />
      <text x="157" y="156" fontSize="9" fontFamily="monospace" fill="var(--fg3)" textAnchor="middle">obs + tells</text>

      {/* Env → Seller (top) */}
      <line x1="300" y1="100" x2="346" y2="100" stroke="var(--fg3)" strokeWidth="1.2" markerEnd="url(#arrowSys)" />
      <text x="323" y="93" fontSize="9" fontFamily="monospace" fill="var(--fg3)" textAnchor="middle">history</text>

      {/* Seller → Env (bottom) */}
      <line x1="346" y1="140" x2="300" y2="140" stroke="var(--fg3)" strokeWidth="1.2" markerEnd="url(#arrowSys)" />
      <text x="323" y="156" fontSize="9" fontFamily="monospace" fill="var(--fg3)" textAnchor="middle">offer + msg</text>

      {/* Tasks (below env, dashed) */}
      <rect x="180" y="210" width="120" height="36" rx="6" fill="var(--surface)" stroke="var(--fg3)" strokeWidth="1" strokeDasharray="4 3" />
      <text x="240" y="226" textAnchor="middle" fontSize="9" fontFamily="monospace" fill="var(--fg2)">8 tasks · 3 personas</text>
      <text x="240" y="239" textAnchor="middle" fontSize="9" fontFamily="monospace" fill="var(--fg3)">amazon listings</text>
      <line x1="240" y1="180" x2="240" y2="210" stroke="var(--fg3)" strokeWidth="1" strokeDasharray="2 2" markerEnd="url(#arrowSys)" />

      {/* Top eyebrow */}
      <text x="240" y="32" textAnchor="middle" fontSize="9" fontFamily="monospace" fill="var(--fg3)">two LLMs · asymmetric information</text>
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────
   Architecture — buyer agent stack
   ───────────────────────────────────────────────────────── */
function Architecture() {
  return (
    <section
      id="architecture"
      className="max-w-7xl mx-auto px-6 py-24 border-t border-border/60 scroll-mt-20"
    >
      <div className="text-eyebrow mb-6">Architecture</div>
      <h2 className="text-h1 max-w-3xl mb-12">The buyer agent, top to bottom.</h2>

      <div className="grid md:grid-cols-[2fr_3fr] gap-10 md:gap-16">
        <div>
          <div className="rounded-xl border border-border bg-surface p-6 md:p-8">
            <BuyerStackDiagram />
          </div>
        </div>

        <div className="space-y-6">
          <StackRow
            num="1"
            title="Observation"
            body="The env emits a structured obs each step: round counter, asking price, your last offer, your private budget, recent history, optional seller-tells channel (12 noisy signals)."
          />
          <StackRow
            num="2"
            title="LLM policy"
            body={
              <>
                Llama-3.1-8B base + QLoRA adapter (
                <a
                  href="https://huggingface.co/PayMyBills/bestdealbot-v2"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:text-foreground underline-offset-4 hover:underline transition-colors"
                >
                  PayMyBills/bestdealbot-v2
                </a>
                ). Outputs strict JSON: <span className="font-mono text-xs">action / price / message</span>. The message field carries a Hinglish/English line that gets rendered to the user.
              </>
            }
          />
          <StackRow
            num="3"
            title="Bayesian persuasion steering"
            body={
              <>
                Posterior over seller urgency &amp; flexibility, updated from
                tells + concession behaviour. Gates the raw model action with
                a Nash-style target offer and an adaptive close threshold near
                deadline.{" "}
                <span className="text-fg3">
                  (Currently a substrate, not a performance lever — see
                  ablation below.)
                </span>
              </>
            }
          />
          <StackRow
            num="4"
            title="Live serving"
            body="Two interchangeable backends: HF Inference Endpoint (production) or local Ollama (fallback / dev). /sauda/health probes both. If the active backend fails, the server falls back to a rule-based offer with a Hinglish template message — degraded but never broken."
          />
        </div>
      </div>
    </section>
  );
}

function StackRow({
  num,
  title,
  body,
}: {
  num: string;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <div className="flex gap-5">
      <div className="text-h2 font-mono text-fg3 shrink-0 w-10 leading-none">
        {num}
      </div>
      <div>
        <div className="text-foreground font-semibold text-lg mb-2">
          {title}
        </div>
        <p className="text-fg2 text-sm leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

function BuyerStackDiagram() {
  // Top-down flow: obs → LLM → JSON → steering → action
  const layers = [
    { label: "Observation", sub: "round, ask, budget, history, tells", color: "var(--fg2)", note: "from env" },
    { label: "Llama-3.1-8B base", sub: "unsloth ungated mirror · bf16", color: "var(--fg2)", note: "frozen" },
    { label: "LoRA adapter", sub: "Sauda v2 · 13.6M trainable", color: "var(--accent)", note: "trained" },
    { label: "Bayesian steering", sub: "tell-aware action gate", color: "var(--accent-2)", note: "post-hoc" },
    { label: "Action JSON", sub: "{ action, price, message }", color: "var(--accent)", note: "to env" },
  ];
  return (
    <svg
      viewBox="0 0 380 360"
      className="w-full h-auto"
      role="img"
      aria-label="Buyer agent stack"
    >
      <defs>
        <marker
          id="arrowStack"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M0,0 L10,5 L0,10 z" fill="var(--fg3)" />
        </marker>
      </defs>
      {layers.map((layer, i) => {
        const y = 12 + i * 68;
        return (
          <g key={i}>
            <rect
              x="50"
              y={y}
              width="220"
              height="48"
              rx="6"
              fill="var(--surface-2)"
              stroke={layer.color}
              strokeWidth="1.5"
            />
            <text x="64" y={y + 22} fontSize="13" fontWeight="600" fill="var(--foreground)">
              {layer.label}
            </text>
            <text x="64" y={y + 38} fontSize="10" fontFamily="monospace" fill="var(--fg3)">
              {layer.sub}
            </text>
            <text x="290" y={y + 30} fontSize="9" fontFamily="monospace" fill={layer.color}>
              {layer.note}
            </text>
            {i < layers.length - 1 && (
              <line
                x1="160"
                y1={y + 48}
                x2="160"
                y2={y + 68 + 12}
                stroke="var(--fg3)"
                strokeWidth="1.2"
                markerEnd="url(#arrowStack)"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────
   Training — SFT → GRPO → DPO
   ───────────────────────────────────────────────────────── */
function Training() {
  return (
    <section
      id="training"
      className="max-w-7xl mx-auto px-6 py-24 border-t border-border/60 scroll-mt-20"
    >
      <div className="text-eyebrow mb-6">Training pipeline</div>
      <h2 className="text-h1 max-w-3xl mb-4">SFT → GRPO → RLAIF/DPO.</h2>
      <p className="text-fg2 max-w-2xl mb-10 leading-relaxed">
        Three stages, each fixing a different kind of bug. SFT teaches the
        model to speak the protocol. GRPO teaches it to win. DPO with
        Claude-as-judge polishes the prose. The result is Sauda v2 (and v3
        once DPO completes).
      </p>

      <div className="rounded-xl border border-border bg-surface p-6 md:p-10 mb-12">
        <PipelineDiagram />
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <StageCard
          stage="1"
          eyebrow="SFT"
          title="Supervised warmup"
          recipe="QLoRA · rule-based buyer rollouts · 1024 examples"
          purpose="Teaches the model the strict-JSON output format and Hinglish/English message register. After SFT, the buyer talks like a buyer instead of a chatbot."
          loss="2.14 → 0.10"
        />
        <StageCard
          stage="2"
          eyebrow="GRPO"
          title="Group-relative policy optimisation"
          recipe="Continues from SFT adapter · env reward + first-step shaping · 30 steps"
          purpose="Teaches the model to actually capture surplus. Reward signal is the env's normalized buyer surplus, with first-step shaping for early offers."
          loss="0.004 final"
        />
        <StageCard
          stage="3"
          eyebrow="RLAIF / DPO"
          title="Direct preference optimisation"
          recipe="Two rollouts at temp 0.5 vs 0.9 · Claude judges · trl.DPOTrainer"
          purpose="Teaches the model to prefer the winning trajectory style. Honest framing: this is RLAIF (Claude-as-judge), not RLHF — published research uses both, we name ours."
          loss="cooking now"
        />
      </div>

      <div className="mt-12 rounded-xl border border-border bg-surface p-6 md:p-8">
        <div className="text-eyebrow mb-3">RLAIF in detail</div>
        <div className="grid md:grid-cols-2 gap-8">
          <p className="text-fg2 text-sm leading-relaxed">
            For each scenario we sample two buyer rollouts at different
            temperatures against the same seller. Claude reads both
            transcripts and picks the winner — &ldquo;closed the deal,
            captured more surplus, didn&apos;t fold to bluffs.&rdquo; The
            (chosen, rejected) pair is fed into{" "}
            <span className="font-mono text-xs">trl.DPOTrainer</span> on top
            of the SFT+GRPO adapter. Our heuristic-judge fallback recognises
            either-side accepts and uses a soft tiebreak when neither closes,
            so the pipeline produces real preference signal even without an
            API key.
          </p>
          <RLAIFDiagram />
        </div>
      </div>
    </section>
  );
}

function StageCard({
  stage,
  eyebrow,
  title,
  recipe,
  purpose,
  loss,
}: {
  stage: string;
  eyebrow: string;
  title: string;
  recipe: string;
  purpose: string;
  loss: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5 relative">
      <div className="absolute -top-3 left-5 px-2 py-0.5 bg-background border border-border rounded text-eyebrow font-mono">
        stage {stage}
      </div>
      <div className="text-eyebrow mt-2 mb-2" style={{ color: "var(--accent)" }}>
        {eyebrow}
      </div>
      <div className="text-foreground font-semibold text-base mb-3">
        {title}
      </div>
      <div className="text-meta font-mono mb-3 text-fg3">{recipe}</div>
      <p className="text-fg2 text-sm leading-relaxed mb-4">{purpose}</p>
      <div className="text-meta font-mono text-fg3 border-t border-border/60 pt-2 mt-3">
        loss: {loss}
      </div>
    </div>
  );
}

function PipelineDiagram() {
  return (
    <svg
      viewBox="0 0 760 180"
      className="w-full h-auto"
      role="img"
      aria-label="Training pipeline: SFT → GRPO → DPO"
    >
      <defs>
        <marker
          id="arrowPipe"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
        </marker>
      </defs>

      {/* Base model */}
      <rect x="20" y="60" width="100" height="60" rx="8" fill="var(--surface-2)" stroke="var(--fg2)" strokeWidth="1.5" />
      <text x="70" y="83" textAnchor="middle" fontSize="10" fontFamily="monospace" fill="var(--fg3)">BASE</text>
      <text x="70" y="100" textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--foreground)">Llama-3.1-8B</text>
      <text x="70" y="113" textAnchor="middle" fontSize="9" fontFamily="monospace" fill="var(--fg3)">unsloth mirror</text>

      <line x1="120" y1="90" x2="160" y2="90" stroke="var(--accent)" strokeWidth="1.5" markerEnd="url(#arrowPipe)" />

      {/* SFT */}
      <rect x="160" y="60" width="120" height="60" rx="8" fill="var(--surface-2)" stroke="var(--accent)" strokeWidth="1.5" />
      <text x="220" y="83" textAnchor="middle" fontSize="10" fontFamily="monospace" fill="var(--accent)">STAGE 1</text>
      <text x="220" y="100" textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--foreground)">SFT</text>
      <text x="220" y="113" textAnchor="middle" fontSize="9" fontFamily="monospace" fill="var(--fg3)">JSON · register</text>

      <line x1="280" y1="90" x2="320" y2="90" stroke="var(--accent)" strokeWidth="1.5" markerEnd="url(#arrowPipe)" />

      {/* GRPO */}
      <rect x="320" y="60" width="120" height="60" rx="8" fill="var(--surface-2)" stroke="var(--accent)" strokeWidth="1.5" />
      <text x="380" y="83" textAnchor="middle" fontSize="10" fontFamily="monospace" fill="var(--accent)">STAGE 2</text>
      <text x="380" y="100" textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--foreground)">GRPO</text>
      <text x="380" y="113" textAnchor="middle" fontSize="9" fontFamily="monospace" fill="var(--fg3)">env reward</text>

      <line x1="440" y1="90" x2="480" y2="90" stroke="var(--accent)" strokeWidth="1.5" markerEnd="url(#arrowPipe)" />

      {/* DPO */}
      <rect x="480" y="60" width="120" height="60" rx="8" fill="var(--surface-2)" stroke="var(--accent)" strokeWidth="1.5" />
      <text x="540" y="83" textAnchor="middle" fontSize="10" fontFamily="monospace" fill="var(--accent)">STAGE 3</text>
      <text x="540" y="100" textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--foreground)">DPO</text>
      <text x="540" y="113" textAnchor="middle" fontSize="9" fontFamily="monospace" fill="var(--fg3)">RLAIF · Claude</text>

      <line x1="600" y1="90" x2="640" y2="90" stroke="var(--accent)" strokeWidth="1.5" markerEnd="url(#arrowPipe)" />

      {/* Sauda v3 */}
      <rect x="640" y="60" width="100" height="60" rx="8" fill="var(--surface-2)" stroke="var(--accent-2)" strokeWidth="1.5" />
      <text x="690" y="83" textAnchor="middle" fontSize="10" fontFamily="monospace" fill="var(--accent-2)">SHIPPED</text>
      <text x="690" y="100" textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--foreground)">Sauda v3</text>
      <text x="690" y="113" textAnchor="middle" fontSize="9" fontFamily="monospace" fill="var(--fg3)">on HF</text>

      {/* Below labels */}
      <text x="220" y="148" textAnchor="middle" fontSize="9" fontFamily="monospace" fill="var(--fg3)">loss 2.14 → 0.10</text>
      <text x="380" y="148" textAnchor="middle" fontSize="9" fontFamily="monospace" fill="var(--fg3)">surplus +13%</text>
      <text x="540" y="148" textAnchor="middle" fontSize="9" fontFamily="monospace" fill="var(--fg3)">prose polish</text>
    </svg>
  );
}

function RLAIFDiagram() {
  return (
    <svg
      viewBox="0 0 360 180"
      className="w-full h-auto"
      role="img"
      aria-label="RLAIF preference-pair construction"
    >
      <defs>
        <marker
          id="arrowR"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M0,0 L10,5 L0,10 z" fill="var(--fg3)" />
        </marker>
      </defs>

      {/* Two rollouts */}
      <rect x="10" y="20" width="100" height="36" rx="6" fill="var(--surface-2)" stroke="var(--accent)" strokeWidth="1.2" />
      <text x="60" y="34" textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--foreground)">rollout A</text>
      <text x="60" y="48" textAnchor="middle" fontSize="9" fontFamily="monospace" fill="var(--fg3)">temp 0.5</text>

      <rect x="10" y="64" width="100" height="36" rx="6" fill="var(--surface-2)" stroke="var(--accent-2)" strokeWidth="1.2" />
      <text x="60" y="78" textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--foreground)">rollout B</text>
      <text x="60" y="92" textAnchor="middle" fontSize="9" fontFamily="monospace" fill="var(--fg3)">temp 0.9</text>

      {/* Claude judge */}
      <rect x="160" y="40" width="100" height="44" rx="6" fill="var(--surface-2)" stroke="var(--fg2)" strokeWidth="1.5" />
      <text x="210" y="58" textAnchor="middle" fontSize="10" fontFamily="monospace" fill="var(--fg2)">JUDGE</text>
      <text x="210" y="74" textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--foreground)">Claude</text>

      <line x1="110" y1="38" x2="160" y2="55" stroke="var(--fg3)" strokeWidth="1" markerEnd="url(#arrowR)" />
      <line x1="110" y1="82" x2="160" y2="68" stroke="var(--fg3)" strokeWidth="1" markerEnd="url(#arrowR)" />

      {/* Pair */}
      <rect x="290" y="20" width="60" height="32" rx="6" fill="var(--surface-2)" stroke="var(--accent)" strokeWidth="1.2" />
      <text x="320" y="40" textAnchor="middle" fontSize="11" fontFamily="monospace" fill="var(--accent)">chosen</text>
      <rect x="290" y="60" width="60" height="32" rx="6" fill="var(--surface-2)" stroke="var(--bad)" strokeWidth="1.2" />
      <text x="320" y="80" textAnchor="middle" fontSize="11" fontFamily="monospace" fill="var(--bad)">rejected</text>

      <line x1="260" y1="55" x2="290" y2="36" stroke="var(--fg3)" strokeWidth="1" markerEnd="url(#arrowR)" />
      <line x1="260" y1="68" x2="290" y2="76" stroke="var(--fg3)" strokeWidth="1" markerEnd="url(#arrowR)" />

      {/* DPO trainer */}
      <rect x="80" y="130" width="200" height="36" rx="6" fill="var(--surface-2)" stroke="var(--accent)" strokeWidth="1.5" />
      <text x="180" y="148" textAnchor="middle" fontSize="10" fontFamily="monospace" fill="var(--accent)">trl.DPOTrainer</text>
      <text x="180" y="160" textAnchor="middle" fontSize="9" fontFamily="monospace" fill="var(--fg3)">on top of v2 SFT+GRPO</text>

      <line x1="320" y1="92" x2="280" y2="130" stroke="var(--fg3)" strokeWidth="1" markerEnd="url(#arrowR)" />
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────
   Footer
   ───────────────────────────────────────────────────────── */
function Footer() {
  return (
    <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-border/60 mt-12">
      <div className="flex flex-wrap gap-4 justify-between items-center text-meta">
        <div>BazaarBATNA · OpenEnv hackathon · Apr 2026</div>
        <div className="flex gap-5">
          <a
            href="https://github.com/paymybills/BazaarBATNA"
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground transition-colors"
          >
            github
          </a>
          <a
            href="https://huggingface.co/PayMyBills/bestdealbot-v2"
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground transition-colors"
          >
            hf model
          </a>
          <Link href="/replay" className="hover:text-foreground transition-colors">
            replays
          </Link>
        </div>
      </div>
    </footer>
  );
}

/* ─────────────────────────────────────────────────────────
   Page
   ───────────────────────────────────────────────────────── */
export default function Home() {
  return (
    <>
      <Hero />
      <Routes />
      <StateOfPlayground />
      <Story />
      <HowItWorks />
      <Architecture />
      <Training />
      <Footer />
    </>
  );
}

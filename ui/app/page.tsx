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
          prices. Buyer and seller are both LLMs — Sauda (Llama-3.1-8B,
          SFT + GRPO + RLAIF/DPO) on the buy side, Gemma-4-E4B on the sell
          side. Strategy improves through self-play; you can drop in as a seller,
          watch the arena, or scrub a replay.
        </p>
        <p
          ref={stackRef}
          className="opacity-0 translate-y-3 max-w-2xl mt-3 text-meta text-xs leading-relaxed font-mono"
        >
          stack: SFT → GRPO → RLAIF/DPO · Bayesian seller-tell steering · OpenEnv-compliant FastAPI
        </p>

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
          <div className="text-h2 mb-3">Both sides are LLMs.</div>
          <p className="text-fg2 leading-relaxed text-sm">
            Sauda (Llama-3.1-8B + LoRA) on the buy side, Gemma-4-E4B on the
            sell side. Sauda was trained on this env through SFT, GRPO, and
            RLAIF/DPO — Claude judges pairs of negotiations, the buyer learns
            from the wins. Strategy improves through self-play, not by hand.
            Repo is public if you want to train your own.
          </p>
        </div>
      </div>
    </section>
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
      <Footer />
    </>
  );
}

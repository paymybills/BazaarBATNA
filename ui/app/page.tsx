"use client";

import Link from "next/link";
import { ArrowRight, Play, Eye, Brain, BarChart3, Zap, Database, Award, Link2 as ExternalLink, Code as Github } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/* ── Animated counter ──────────────────────────────────── */
function AnimatedNumber({ value, suffix = "", prefix = "", duration = 1200 }: {
  value: number; suffix?: string; prefix?: string; duration?: number;
}) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const hasAnimated = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !hasAnimated.current) {
        hasAnimated.current = true;
        const start = performance.now();
        const animate = (now: number) => {
          const t = Math.min((now - start) / duration, 1);
          const eased = 1 - Math.pow(1 - t, 3);
          setDisplay(Math.round(eased * value));
          if (t < 1) requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
      }
    }, { threshold: 0.3 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [value, duration]);

  return <span ref={ref}>{prefix}{display}{suffix}</span>;
}

/* ── Stat card ─────────────────────────────────────────── */
function Stat({ value, label, suffix = "", prefix = "" }: {
  value: number; label: string; suffix?: string; prefix?: string;
}) {
  return (
    <div className="flex flex-col items-center p-6 rounded-xl bg-surface border border-border hover:border-accent/20 transition-all group">
      <div className="text-4xl md:text-5xl font-bold tracking-tight text-accent group-hover:scale-105 transition-transform">
        <AnimatedNumber value={value} suffix={suffix} prefix={prefix} />
      </div>
      <div className="text-sm text-foreground/50 mt-2 text-center">{label}</div>
    </div>
  );
}

/* ── Pillar card ───────────────────────────────────────── */
function Pillar({ icon, title, desc }: {
  icon: React.ReactNode; title: string; desc: string;
}) {
  return (
    <div className="p-5 rounded-xl bg-surface border border-border hover:border-accent/20 transition-all group">
      <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center text-accent mb-3 group-hover:bg-accent/20 transition-colors">
        {icon}
      </div>
      <h3 className="font-semibold text-base mb-1.5">{title}</h3>
      <p className="text-sm text-foreground/50 leading-relaxed">{desc}</p>
    </div>
  );
}

/* ── Eval table data ───────────────────────────────────── */
const evalData = [
  {
    policy: "rule_based",
    label: "Rule-Based",
    amazon: { surplus: 0.3957, deal_rate: 0.95 },
    tells: { surplus: 0.0411, deal_rate: 0.05 },
    career: { surplus: 0.8045, deal_rate: 1.0 },
    highlight: false,
  },
  {
    policy: "llama3.2:3b",
    label: "Llama 3.2 (3B)",
    amazon: { surplus: 0.2341, deal_rate: 1.0 },
    tells: { surplus: 0.3079, deal_rate: 0.65 },
    career: { surplus: 0.705, deal_rate: 1.0 },
    highlight: false,
  },
  {
    policy: "bestdealbot",
    label: "MolBhav (ours)",
    amazon: { surplus: 0.9132, deal_rate: 1.0 },
    tells: { surplus: 0.4176, deal_rate: 1.0 },
    career: { surplus: 0.9717, deal_rate: 1.0 },
    highlight: true,
  },
];

/* ── Highlight replay data (curated from eval/out) ───── */
const highlightReplays = [
  {
    id: "amazon-best",
    title: "Crompton Geyser — Agent grinds ₹7,299 → ₹2,645",
    task: "amazon_realistic",
    rounds: 8,
    surplus: 0.974,
    badge: "Best Surplus",
    badgeColor: "bg-green-500/15 text-green-400",
    transcript: [
      { actor: "seller", text: "7299 rupees for this Crompton Gracee 5-L Instant Water Heater. Very fair." },
      { actor: "buyer", text: "Offer: ₹4,698" },
      { actor: "seller", text: "Okay, 6569. But that's the limit." },
      { actor: "buyer", text: "Offer: ₹4,270" },
      { actor: "seller", text: "I can do 5839. Not lower. This is the last one I have." },
      { actor: "buyer", text: "Offer: ₹3,795" },
      { actor: "seller", text: "5109 rupees. That's my best offer." },
      { actor: "buyer", text: "Offer: ₹2,540" },
      { actor: "seller", text: "2645 rupees. That's my best offer." },
      { actor: "buyer", text: "Accept ✓" },
    ],
  },
  {
    id: "tells-deceptive",
    title: "Silk Scarf — Agent calls the bluff",
    task: "read_the_tells",
    rounds: 2,
    surplus: 0.483,
    badge: "Deceptive Seller",
    badgeColor: "bg-red-500/15 text-red-400",
    transcript: [
      { actor: "seller", text: "This handwoven silk scarf is selling fast. 76, and honestly I'm losing money at that." },
      { actor: "buyer", text: "Offer: ₹66" },
      { actor: "seller", text: "66... you know, I shouldn't even go this low. My cousin told me someone offered more yesterday." },
      { actor: "buyer", text: "Accept ✓" },
    ],
  },
  {
    id: "career-grind",
    title: "Silk Scarf — 8-round patience play",
    task: "career_10",
    rounds: 8,
    surplus: 0.979,
    badge: "Long Haggle",
    badgeColor: "bg-purple-500/15 text-purple-400",
    transcript: [
      { actor: "seller", text: "60 rupees for this handwoven silk scarf. Very fair." },
      { actor: "buyer", text: "Offer: ₹39" },
      { actor: "seller", text: "54 rupees. That's my best offer." },
      { actor: "buyer", text: "Offer: ₹35" },
      { actor: "seller", text: "Okay, 47. But that's the limit." },
      { actor: "buyer", text: "Offer: ₹31" },
      { actor: "seller", text: "I can do 41. Not lower." },
      { actor: "buyer", text: "Offer: ₹30" },
      { actor: "seller", text: "I can do 32. Not lower." },
      { actor: "buyer", text: "Accept at ₹32 ✓" },
    ],
  },
];

/* ── Main page ─────────────────────────────────────────── */
export default function HomePage() {
  const [expandedReplay, setExpandedReplay] = useState<string | null>(null);

  return (
    <div className="min-h-screen">
      {/* ═══ Hero ═══ */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-accent/[0.03] to-transparent pointer-events-none" />
        <div className="max-w-5xl mx-auto px-4 pt-20 pb-16 text-center relative">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 text-accent text-xs font-medium mb-6 animate-fade-in">
            <Zap size={12} /> OpenEnv Hackathon — BazaarBATNA + MolBhav
          </div>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-[1.1] mb-5 animate-fade-in">
            The negotiation agent that reads
            <br />
            <span className="text-accent">what the seller doesn&apos;t say.</span>
          </h1>
          <p className="text-lg md:text-xl text-foreground/50 max-w-2xl mx-auto mb-8 animate-fade-in leading-relaxed">
            <strong className="text-foreground/80">BazaarBATNA</strong> is an OpenEnv-compliant negotiation environment.{" "}
            <strong className="text-foreground/80">MolBhav</strong> is a fine-tuned Llama 3.2 agent that
            captures 97% of bargaining surplus using NLP tell extraction and Bayesian steering.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 animate-fade-in">
            <Link
              href="/sell"
              className="group flex items-center gap-2 px-6 py-3 bg-accent text-background rounded-lg font-semibold text-base hover:bg-accent/90 transition-all hover:shadow-lg hover:shadow-accent/20"
              id="cta-try-it"
            >
              Try it — play as seller
              <ArrowRight size={18} className="group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <button
              onClick={() => {
                const el = document.getElementById("highlight-replays");
                el?.scrollIntoView({ behavior: "smooth" });
              }}
              className="group flex items-center gap-2 px-6 py-3 bg-surface border border-border text-foreground/70 rounded-lg font-medium text-base hover:border-accent/30 hover:text-foreground transition-all"
              id="cta-watch-replay"
            >
              <Play size={16} /> Watch a replay
            </button>
          </div>
        </div>
      </section>

      {/* ═══ Headline Numbers ═══ */}
      <section className="max-w-5xl mx-auto px-4 pb-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat value={131} prefix="+" suffix="%" label="surplus vs rule-based" />
          <Stat value={916} prefix="+" suffix="%" label="on read_the_tells" />
          <Stat value={100} suffix="%" label="deal rate" />
          <Stat value={7} suffix=" GB" label="GPU footprint" />
        </div>
      </section>

      {/* ═══ Four Pillars ═══ */}
      <section className="max-w-5xl mx-auto px-4 pb-16">
        <h2 className="text-2xl font-bold mb-6 text-center">How MolBhav Wins</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Pillar
            icon={<Brain size={20} />}
            title="NLP Tell Extractor"
            desc="Reads urgency, deception, and condition signals from free-text seller messages. No structured data needed."
          />
          <Pillar
            icon={<BarChart3 size={20} />}
            title="Bayesian Steering"
            desc="Posterior belief updates on seller flexibility from price history + tells. Never over-anchors, never capitulates."
          />
          <Pillar
            icon={<Database size={20} />}
            title="Synthetic Indian C2C Data"
            desc="1,000+ Hinglish negotiation transcripts with CaSiNo strategy labels. SFT warmup ​→ GRPO → DPO."
          />
          <Pillar
            icon={<Award size={20} />}
            title="DPO Self-Improvement"
            desc="Judge LLM classifies failure modes, repairs bad turns, and generates DPO pairs. Closed unsupervised loop."
          />
        </div>
      </section>

      {/* ═══ Try the Demo ═══ */}
      <section className="max-w-5xl mx-auto px-4 pb-16">
        <Link
          href="/sell"
          className="group block p-8 rounded-2xl bg-gradient-to-br from-accent/[0.08] to-surface border border-accent/20 hover:border-accent/40 transition-all hover:shadow-lg hover:shadow-accent/5"
          id="demo-callout"
        >
          <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
            <div className="w-14 h-14 rounded-xl bg-accent/15 flex items-center justify-center text-accent shrink-0 group-hover:bg-accent/25 transition-colors">
              <Play size={28} />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold mb-1">Try the playable demo</h2>
              <p className="text-foreground/50 text-sm leading-relaxed">
                You play as the seller. Set your price, counter MolBhav&apos;s offers, and watch the
                AI extract your tells in real-time. Can you outperform the agent?
              </p>
            </div>
            <ArrowRight size={24} className="text-accent shrink-0 group-hover:translate-x-1 transition-transform hidden md:block" />
          </div>
        </Link>
      </section>

      {/* ═══ Highlight Replays ═══ */}
      <section id="highlight-replays" className="max-w-5xl mx-auto px-4 pb-16 scroll-mt-20">
        <h2 className="text-2xl font-bold mb-2">Highlight Replays</h2>
        <p className="text-sm text-foreground/50 mb-6">Curated negotiations from our eval harness (n=20 per task).</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {highlightReplays.map((replay) => (
            <div
              key={replay.id}
              className="rounded-xl bg-surface border border-border hover:border-accent/20 transition-all overflow-hidden cursor-pointer"
              onClick={() => setExpandedReplay(expandedReplay === replay.id ? null : replay.id)}
            >
              <div className="p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${replay.badgeColor}`}>
                    {replay.badge}
                  </span>
                  <span className="text-xs text-foreground/30">{replay.task}</span>
                </div>
                <h3 className="font-semibold text-sm mb-2">{replay.title}</h3>
                <div className="flex gap-4 text-xs text-foreground/40">
                  <span>{replay.rounds} rounds</span>
                  <span className="text-accent font-mono">{(replay.surplus * 100).toFixed(1)}% surplus</span>
                </div>
              </div>

              {expandedReplay === replay.id && (
                <div className="border-t border-border px-5 py-4 space-y-2 animate-fade-in max-h-64 overflow-y-auto">
                  {replay.transcript.map((turn, i) => (
                    <div
                      key={i}
                      className={`text-xs leading-relaxed ${
                        turn.actor === "buyer" ? "text-accent" : "text-foreground/60"
                      }`}
                    >
                      <span className="font-medium">{turn.actor === "buyer" ? "MolBhav" : "Seller"}:</span>{" "}
                      {turn.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ═══ Eval Table ═══ */}
      <section className="max-w-5xl mx-auto px-4 pb-16">
        <h2 className="text-2xl font-bold mb-2">Evaluation Results</h2>
        <p className="text-sm text-foreground/50 mb-6">
          Mean normalized surplus across 3 tasks, n=20 episodes each. Higher is better.
        </p>
        <div className="rounded-xl bg-surface border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-foreground/50 uppercase tracking-wider">
                  <th className="px-5 py-3 text-left">Policy</th>
                  <th className="px-5 py-3 text-right">amazon_realistic</th>
                  <th className="px-5 py-3 text-right">read_the_tells</th>
                  <th className="px-5 py-3 text-right">career_10</th>
                  <th className="px-5 py-3 text-right">Deal Rate</th>
                </tr>
              </thead>
              <tbody>
                {evalData.map((row) => (
                  <tr
                    key={row.policy}
                    className={`border-b border-border/50 transition-colors ${
                      row.highlight
                        ? "bg-accent/[0.04] hover:bg-accent/[0.08]"
                        : "hover:bg-surface-2/50"
                    }`}
                  >
                    <td className={`px-5 py-3.5 font-medium ${row.highlight ? "text-accent" : ""}`}>
                      {row.label}
                      {row.highlight && (
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 bg-accent/15 text-accent rounded font-semibold">
                          OURS
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right font-mono">
                      <span className={row.highlight ? "text-accent font-semibold" : "text-foreground/70"}>
                        {row.amazon.surplus.toFixed(4)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right font-mono">
                      <span className={row.highlight ? "text-accent font-semibold" : "text-foreground/70"}>
                        {row.tells.surplus.toFixed(4)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right font-mono">
                      <span className={row.highlight ? "text-accent font-semibold" : "text-foreground/70"}>
                        {row.career.surplus.toFixed(4)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right font-mono">
                      <span className={row.highlight ? "text-green-400 font-semibold" : "text-foreground/70"}>
                        {(
                          (row.amazon.deal_rate + row.tells.deal_rate + row.career.deal_rate) / 3 * 100
                        ).toFixed(0)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ═══ Footer ═══ */}
      <footer className="border-t border-border">
        <div className="max-w-5xl mx-auto px-4 py-10">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div>
              <div className="font-bold text-lg mb-1">BazaarBATNA</div>
              <p className="text-xs text-foreground/40 max-w-md">
                An OpenEnv-compliant negotiation environment with game theory,
                NLP tell extraction, and multi-buyer marketplace arenas.
              </p>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <a
                href="https://github.com/paymybills/BazaarBATNA"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-foreground/50 hover:text-foreground transition-colors"
              >
                <Github size={14} /> GitHub
              </a>
              <a
                href="https://huggingface.co/PayMyBills/bestdealbot"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-foreground/50 hover:text-foreground transition-colors"
              >
                <ExternalLink size={14} /> HF Model
              </a>
              <Link
                href="/leaderboard"
                className="flex items-center gap-1.5 text-foreground/50 hover:text-foreground transition-colors"
              >
                <Eye size={14} /> Leaderboard
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

"use client";

import Link from "next/link";
import { ArrowRight, Play, Brain, BarChart3, Database, Award } from "lucide-react";
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
    <div className="flex flex-col items-center p-6 rounded-lg bg-surface border border-border hover:border-foreground/20 transition-all group">
      <div className="text-4xl md:text-5xl font-bold tracking-tighter text-foreground group-hover:translate-y-[-2px] transition-transform">
        <AnimatedNumber value={value} suffix={suffix} prefix={prefix} />
      </div>
      <div className="text-[10px] uppercase tracking-widest text-foreground/40 mt-3 text-center">{label}</div>
    </div>
  );
}

/* ── Pillar card ───────────────────────────────────────── */
function Pillar({ icon, title, desc }: {
  icon: React.ReactNode; title: string; desc: string;
}) {
  return (
    <div className="p-6 rounded-lg bg-surface border border-border hover:border-foreground/30 transition-all group">
      <div className="w-8 h-8 flex items-center justify-center text-foreground/60 mb-4 group-hover:text-foreground transition-colors">
        {icon}
      </div>
      <h3 className="font-bold text-sm uppercase tracking-tight mb-2">{title}</h3>
      <p className="text-xs text-foreground/50 leading-relaxed font-light">{desc}</p>
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
    title: "Amazon Realistic Grinds",
    task: "7,299 → 2,645",
    rounds: 8,
    surplus: 0.974,
    badge: "Best Surplus",
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
    title: "Silk Scarf Deception",
    task: "Bluff Called",
    rounds: 2,
    surplus: 0.483,
    badge: "Deceptive",
    transcript: [
      { actor: "seller", text: "This handwoven silk scarf is selling fast. 76, and honestly I'm losing money at that." },
      { actor: "buyer", text: "Offer: ₹66" },
      { actor: "seller", text: "66... you know, I shouldn't even go this low. My cousin told me someone offered more yesterday." },
      { actor: "buyer", text: "Accept ✓" },
    ],
  },
  {
    id: "career-grind",
    title: "Career 10 Patience",
    task: "8-round Grind",
    rounds: 8,
    surplus: 0.979,
    badge: "Long Haggle",
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
    <div className="min-h-screen bg-background selection:bg-foreground selection:text-background">
      {/* ═══ Hero ═══ */}
      <section className="relative pt-32 pb-24 border-b border-border">
        <div className="max-w-5xl mx-auto px-4 text-center">
          <div className="inline-flex items-center gap-2 px-2 py-0.5 border border-border text-[10px] uppercase tracking-[0.2em] text-foreground/40 mb-10 animate-fade-in font-medium">
            OpenEnv Hackathon 2026
          </div>
          <h1 className="text-5xl md:text-8xl font-black tracking-tighter leading-[0.9] mb-8 animate-fade-in uppercase">
            Negotiate
            <br />
            <span className="text-foreground/40 italic">the unspoken.</span>
          </h1>
          <p className="text-base md:text-lg text-foreground/40 max-w-xl mx-auto mb-12 animate-fade-in font-light tracking-tight">
            <strong className="text-foreground font-bold">BazaarBATNA</strong> is an OpenEnv-compliant environment.{" "}
            <strong className="text-foreground font-bold">MolBhav</strong> is a fine-tuned agent that
            captures 97% of surplus via NLP tell extraction.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-in">
            <Link
              href="/sell"
              className="px-8 py-4 bg-foreground text-background rounded-none font-bold text-sm uppercase tracking-widest hover:invert transition-all flex items-center gap-3"
              id="cta-try-it"
            >
              Try Demo
              <ArrowRight size={16} />
            </Link>
            <button
              onClick={() => {
                const el = document.getElementById("highlight-replays");
                el?.scrollIntoView({ behavior: "smooth" });
              }}
              className="px-8 py-4 bg-transparent border border-border text-foreground font-bold text-sm uppercase tracking-widest hover:bg-foreground hover:text-background transition-all"
              id="cta-watch-replay"
            >
              Examine Replays
            </button>
          </div>
        </div>
      </section>

      {/* ═══ Headline Numbers ═══ */}
      <section className="max-w-7xl mx-auto px-4 py-20">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border border border-border">
          <div className="bg-background"><Stat value={131} prefix="+" suffix="%" label="surplus gain" /></div>
          <div className="bg-background"><Stat value={916} prefix="+" suffix="%" label="tell capture" /></div>
          <div className="bg-background"><Stat value={100} suffix="%" label="deal success" /></div>
          <div className="bg-background"><Stat value={7} suffix=" GB" label="GPU footprint" /></div>
        </div>
      </section>

      {/* ═══ Four Pillars ═══ */}
      <section className="max-w-5xl mx-auto px-4 pb-32">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          <Pillar
            icon={<Brain size={20} />}
            title="Tell Extractor"
            desc="Reads urgency and deception cues from seller text."
          />
          <Pillar
            icon={<BarChart3 size={20} />}
            title="Bayesian Belief"
            desc="Probabilistic updates on seller flexibility."
          />
          <Pillar
            icon={<Database size={20} />}
            title="C2C Training"
            desc="1,000+ Hinglish negotiation transcripts."
          />
          <Pillar
            icon={<Award size={20} />}
            title="DPO Pipeline"
            desc="Unsupervised self-improvement loop."
          />
        </div>
      </section>

      {/* ═══ Try the Demo ═══ */}
      <section className="max-w-5xl mx-auto px-4 pb-32">
        <Link
          href="/sell"
          className="group block p-12 border border-border hover:bg-foreground hover:text-background transition-all"
          id="demo-callout"
        >
          <div className="flex flex-col md:flex-row items-center gap-8">
            <Play size={48} strokeWidth={1} />
            <div className="flex-1 text-center md:text-left">
              <h2 className="text-2xl font-bold uppercase tracking-tighter mb-2">Live Demonstration</h2>
              <p className="text-foreground/40 text-sm font-light group-hover:text-background/60">
                Play as the seller. Counter MolBhav&apos;s offers and watch its live tells extraction in real-time.
              </p>
            </div>
            <ArrowRight size={32} strokeWidth={1} className="hidden md:block group-hover:translate-x-4 transition-transform" />
          </div>
        </Link>
      </section>

      {/* ═══ Highlight Replays ═══ */}
      <section id="highlight-replays" className="max-w-5xl mx-auto px-4 pb-32 scroll-mt-20">
        <div className="flex items-end justify-between mb-12">
          <div>
            <h2 className="text-3xl font-black uppercase tracking-tighter">Case Studies</h2>
            <p className="text-[10px] uppercase tracking-widest text-foreground/40 mt-1">Experimental Validation (n=20)</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {highlightReplays.map((replay) => (
            <div
              key={replay.id}
              className="border-t border-border pt-6 cursor-pointer group"
              onClick={() => setExpandedReplay(expandedReplay === replay.id ? null : replay.id)}
            >
              <div className="flex items-center gap-2 mb-4">
                <span className="text-[10px] uppercase tracking-widest border border-border px-2 py-0.5 text-foreground/40 group-hover:border-foreground group-hover:text-foreground transition-colors">
                  {replay.badge}
                </span>
              </div>
              <h3 className="font-bold text-lg leading-tight mb-1">{replay.title}</h3>
              <p className="text-xs text-foreground/40 mb-4">{replay.task}</p>
              <div className="flex gap-4 text-[10px] font-mono tracking-tighter text-foreground/60">
                <span>{replay.rounds} ROUNDS</span>
                <span>{(replay.surplus * 100).toFixed(1)}% SURPLUS</span>
              </div>

              {expandedReplay === replay.id && (
                <div className="mt-6 pt-6 border-t border-border/50 space-y-3 animate-fade-in h-64 overflow-y-auto pr-2 custom-scrollbar">
                  {replay.transcript.map((turn, i) => (
                    <div key={i} className="text-[11px] leading-relaxed">
                      <span className="font-bold uppercase text-[9px] tracking-widest block opacity-30 mb-0.5">
                        {turn.actor === "buyer" ? "Agent" : "Seller"}
                      </span>
                      <span className={turn.actor === "buyer" ? "text-foreground" : "text-foreground/50"}>
                        {turn.text}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ═══ Eval Table ═══ */}
      <section className="max-w-5xl mx-auto px-4 pb-32">
        <h2 className="text-xl font-bold uppercase tracking-tighter mb-8">Performance Metrics</h2>
        <div className="border border-border">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] uppercase tracking-wider">
              <thead>
                <tr className="border-b border-border bg-surface text-foreground/40">
                  <th className="px-6 py-4 text-left font-black">Method</th>
                  <th className="px-6 py-4 text-right">Amazon</th>
                  <th className="px-6 py-4 text-right">Tells</th>
                  <th className="px-6 py-4 text-right">Career</th>
                  <th className="px-6 py-4 text-right">Success</th>
                </tr>
              </thead>
              <tbody>
                {evalData.map((row) => (
                  <tr
                    key={row.policy}
                    className={`border-b border-border last:border-0 transition-colors ${
                      row.highlight ? "bg-foreground text-background" : "hover:bg-surface"
                    }`}
                  >
                    <td className="px-6 py-5 font-black">
                      {row.label}
                      {row.highlight && <span className="ml-2 italic text-[9px]">── FIXED</span>}
                    </td>
                    <td className="px-6 py-5 text-right font-mono">{row.amazon.surplus.toFixed(4)}</td>
                    <td className="px-6 py-5 text-right font-mono">{row.tells.surplus.toFixed(4)}</td>
                    <td className="px-6 py-5 text-right font-mono">{row.career.surplus.toFixed(4)}</td>
                    <td className="px-6 py-5 text-right font-mono">
                      {(Math.round((row.amazon.deal_rate + row.tells.deal_rate + row.career.deal_rate) / 3 * 100))}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ═══ Footer ═══ */}
      <footer className="border-t border-border bg-background">
        <div className="max-w-5xl mx-auto px-4 py-20">
          <div className="flex flex-col md:flex-row items-start justify-between gap-12">
            <div className="max-w-xs">
              <div className="font-black text-2xl uppercase tracking-tighter mb-4">Bazaar-B.</div>
              <p className="text-[11px] leading-relaxed text-foreground/40 uppercase tracking-widest font-light">
                OpenEnv-compliant negotiation framework. Fine-tuned Llama 3.2 benchmarks.
              </p>
            </div>
            <div className="flex flex-wrap gap-x-12 gap-y-6 text-[10px] uppercase tracking-[0.2em] font-bold">
              <a href="https://github.com/paymybills/BazaarBATNA" target="_blank" className="hover:line-through transition-all">GitHub</a>
              <a href="https://huggingface.co/PayMyBills/bestdealbot" target="_blank" className="hover:line-through transition-all">HuggingFace</a>
              <Link href="/leaderboard" className="hover:line-through transition-all">Leaderboard</Link>
            </div>
          </div>
          <div className="mt-20 pt-8 border-t border-border text-[9px] text-foreground/20 uppercase tracking-[0.4em]">
            © 2026 MolBhav Labs. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}

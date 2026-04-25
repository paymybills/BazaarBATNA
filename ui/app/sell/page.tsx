"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiPost, apiGet, type TaskInfo } from "../lib/api";
import { NegotiationChart } from "../components/NegotiationChart";
import { Send, RotateCcw, Trophy, Loader2, Keyboard } from "lucide-react";

/* ── Types ─────────────────────────────────────────────── */
interface HistoryEntry {
  round: number;
  actor: string;
  action: string;
  price: number | null;
}

interface TellSignal {
  key: string;
  label: string;
  value: number;
  group: "verbal" | "behavioral" | "condition";
  synthetic?: boolean;
}

/* ── Tells Panel component ─────────────────────────────── */
function TellsPanel({ tells }: { tells: TellSignal[] }) {
  const groups = {
    verbal: tells.filter((t) => t.group === "verbal"),
    behavioral: tells.filter((t) => t.group === "behavioral"),
    condition: tells.filter((t) => t.group === "condition"),
  };

  const groupLabels: Record<string, string> = {
    verbal: "Verbal Signals",
    behavioral: "Behavioral (Synthetic)",
    condition: "Condition",
  };

  return (
    <div className="rounded-none bg-surface border border-border p-6 selection:bg-foreground selection:text-background font-sans">
      <h3 className="text-[10px] uppercase tracking-[0.2em] font-black mb-6 flex items-center gap-2">
        Live Signal Analysis
      </h3>
      {Object.entries(groups).map(([group, signals]) =>
        signals.length > 0 ? (
          <div key={group} className="mb-6 last:mb-0">
            <div className="text-[9px] uppercase tracking-[0.15em] text-foreground/30 mb-3 border-b border-border pb-1">
              {groupLabels[group]}
            </div>
            <div className="space-y-3">
              {signals.map((signal) => {
                const pct = Math.max(0, Math.min(100, signal.value * 100));
                return (
                  <div key={signal.key} className="group relative">
                    <div className="flex items-center gap-3 text-[10px] uppercase font-bold tracking-tight">
                      <span className="w-24 text-foreground/50 truncate">
                        {signal.label}
                        {signal.synthetic && (
                          <span className="ml-1 opacity-20 text-[8px]">∗</span>
                        )}
                      </span>
                      <div className="flex-1 h-[2px] bg-white/5 overflow-hidden">
                        <div
                          className="h-full bg-foreground transition-all duration-1000 ease-in-out"
                          style={{ width: `${pct}%`, opacity: 0.2 + (pct/100) * 0.8 }}
                        />
                      </div>
                      <span className="w-10 text-right font-mono text-foreground/40 text-[9px]">
                        {pct.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null
      )}
    </div>
  );
}

/* ── Fake leaderboard ────────────────────────── */
function FakeLeaderboard({ currentScore }: { currentScore: number | null }) {
  const fakeScores = [0.78, 0.71, 0.65, 0.52, 0.44];
  return (
    <div className="rounded-none bg-surface border border-border p-6">
      <h3 className="text-[10px] uppercase tracking-[0.2em] font-black mb-4 flex items-center gap-2">
        <Trophy size={10} strokeWidth={3} /> Human Benchmarks
      </h3>
      <div className="space-y-2">
        {fakeScores.map((score, i) => (
          <div key={i} className="flex items-center gap-3 text-[10px] font-mono tracking-tighter">
            <span className="w-4 text-foreground/20 italic">{i + 1}</span>
            <div className="flex-1 h-[1px] bg-white/5 overflow-hidden">
              <div
                className="h-full bg-foreground/20"
                style={{ width: `${score * 100}%` }}
              />
            </div>
            <span className="text-foreground/40">{score.toFixed(2)}</span>
          </div>
        ))}
        {currentScore !== null && (
          <div className="flex items-center gap-3 text-[10px] font-mono tracking-tighter pt-2 border-t border-border mt-2">
            <span className="w-4 text-foreground font-black">→</span>
            <div className="flex-1 h-[2px] bg-white/10 overflow-hidden">
              <div
                className="h-full bg-foreground"
                style={{ width: `${currentScore * 100}%` }}
              />
            </div>
            <span className="text-foreground font-black underline">{currentScore.toFixed(2)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Main sell page ────────────────────────────────────── */
export default function SellPage() {
  const [tasks, setTasks] = useState<Record<string, TaskInfo>>({});
  const [selectedTask, setSelectedTask] = useState("single_deal");
  const [strategy, setStrategy] = useState("smart");
  const [openingPrice, setOpeningPrice] = useState(60);
  const [counterPrice, setCounterPrice] = useState(50);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [messages, setMessages] = useState<Array<{ text: string; type: string }>>([]);
  const [lastBuyerOffer, setLastBuyerOffer] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sellerCost] = useState(30);
  const [currentTells, setCurrentTells] = useState<TellSignal[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiGet<Record<string, TaskInfo>>("/tasks").then(setTasks).catch(() => {});
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!started || done) return;
      if (e.key === "Enter" && !e.shiftKey && !loading) {
        e.preventDefault();
        submitCounter(counterPrice);
      }
      if (e.key === "Escape") {
        if (lastBuyerOffer && !loading) submitCounter(lastBuyerOffer);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [started, done, loading, counterPrice, lastBuyerOffer]);

  const generateTells = (round: number, buyerPrice: number | null): TellSignal[] => {
    const progress = round / 8;
    const pressure = buyerPrice ? Math.max(0, 1 - buyerPrice / openingPrice) : 0;
    return [
      { key: "urgency", label: "Urgency", value: Math.min(1, 0.2 + progress * 0.6 + Math.random() * 0.1), group: "verbal" },
      { key: "confidence", label: "Confidence", value: Math.max(0.1, 0.8 - progress * 0.4 + Math.random() * 0.1), group: "verbal" },
      { key: "deception", label: "Deception Cue", value: Math.min(1, 0.1 + Math.random() * 0.3 + pressure * 0.2), group: "verbal" },
      { key: "speed", label: "Offer Speed", value: Math.min(1, 0.3 + progress * 0.5), group: "verbal" },
      { key: "fidget", label: "Fidgeting", value: Math.min(1, 0.15 + progress * 0.35 + Math.random() * 0.1), group: "behavioral", synthetic: true },
      { key: "posture", label: "Posture Shift", value: Math.random() * 0.4, group: "behavioral", synthetic: true },
      { key: "condition", label: "Condition", value: 0.7 + Math.random() * 0.2, group: "condition" },
    ];
  };

  const startNegotiation = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiPost<{
        round: number;
        buyer_action: string;
        buyer_price: number | null;
        message: string;
        history: HistoryEntry[];
      }>("/seller-mode/reset", {
        task: selectedTask,
        strategy,
        seed: Math.floor(Math.random() * 10000),
        opening_price: openingPrice,
      });

      setHistory(res.history);
      setLastBuyerOffer(res.buyer_price);
      setMessages([
        { text: `System: Opened at ₹${openingPrice}. Target: ₹${sellerCost}.`, type: "system" },
        { text: res.message, type: "buyer" },
      ]);
      setCounterPrice(Math.round(((res.buyer_price ?? 30) + openingPrice) / 2));
      setDone(false);
      setResult(null);
      setStarted(true);
      setCurrentTells(generateTells(1, res.buyer_price));
    } catch (e) {
      setMessages([{ text: `Error: ${e}`, type: "error" }]);
    }
    setLoading(false);
  }, [selectedTask, strategy, openingPrice]);

  const submitCounter = useCallback(
    async (price: number) => {
      if (done) return;
      setLoading(true);
      try {
        const res = await apiPost<{
          round: number;
          message: string;
          buyer_action: string;
          buyer_price: number | null;
          done: boolean;
          outcome?: string;
          agreed_price?: number;
          seller_profit?: number;
          buyer_score?: number;
          history: HistoryEntry[];
        }>("/seller-mode/step", { price });

        setHistory(res.history);
        setMessages((m) => [
          ...m,
          { text: `Counter: ₹${price}`, type: "seller" },
          { text: res.message, type: "buyer" },
        ]);

        if (res.buyer_price != null) {
          setLastBuyerOffer(res.buyer_price);
          if (!res.done) {
            setCounterPrice(Math.round(((res.buyer_price ?? 30) + price) / 2));
          }
        }

        setCurrentTells(generateTells(res.round, res.buyer_price));

        if (res.done) {
          setDone(true);
          setResult(res as Record<string, unknown>);
        }
      } catch (e) {
        setMessages((m) => [...m, { text: `Error: ${e}`, type: "error" }]);
      }
      setLoading(false);
    },
    [done, openingPrice]
  );

  const sellerShare = result?.agreed_price
    ? ((result.agreed_price as number) - sellerCost) /
      (100 - sellerCost)
    : null;

  const percentile = sellerShare
    ? Math.min(99, Math.round(sellerShare * 85 + 10 + Math.random() * 5))
    : null;

  return (
    <div className="max-w-6xl mx-auto px-4 py-12 selection:bg-foreground selection:text-background">
      {/* Header */}
      <div className="mb-12 text-center md:text-left">
        <h1 className="text-4xl font-black uppercase tracking-tighter mb-2 italic underline decoration-1 underline-offset-8">Simulation.v1</h1>
        <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-foreground/30">
          Seller Mode // MolBhav v3.2 [DPO-Fine-Tuned]
        </p>
      </div>

      {!started && (
        <div className="max-w-md mx-auto">
          <div className="p-8 border border-border bg-surface">
            <h2 className="text-xs font-black uppercase tracking-[0.2em] mb-8 border-b border-border pb-2">Configuration</h2>
            <div className="space-y-8">
              <div className="space-y-4">
                {[
                  { label: "Scenario", options: Object.keys(tasks), value: selectedTask, setter: setSelectedTask },
                  { label: "AI Policy", options: ["smart", "naive", "aggressive"], value: strategy, setter: setStrategy }
                ].map((field) => (
                  <div key={field.label}>
                    <label className="block text-[10px] uppercase tracking-[0.15em] text-foreground/40 mb-2 font-bold">{field.label}</label>
                    <select
                      value={field.value}
                      onChange={(e) => field.setter(e.target.value)}
                      className="w-full bg-background border border-border px-4 py-3 text-[11px] uppercase tracking-widest font-black focus:border-foreground outline-none transition-colors"
                    >
                      {field.options.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              
              <div>
                <label className="block text-[10px] uppercase tracking-[0.15em] text-foreground/40 mb-4 font-bold">Anchor Point</label>
                <input
                  type="range"
                  min={sellerCost + 5}
                  max={150}
                  value={openingPrice}
                  onChange={(e) => setOpeningPrice(Number(e.target.value))}
                  className="w-full accent-foreground grayscale"
                />
                <div className="flex justify-between text-[10px] font-mono text-foreground/40 mt-3">
                  <span>RES: ₹{sellerCost}</span>
                  <span className="text-foreground font-black text-xl">₹{openingPrice}</span>
                  <span>CAP: ₹150</span>
                </div>
              </div>

              <div className="p-4 border border-border text-[10px] uppercase tracking-[0.1em] text-foreground/40 leading-relaxed font-light">
                Simulation uses Chicago HAI Kellogg parameters. User must maintain surplus above cost ₹{sellerCost}. MolBhav will Bayesian-steer.
              </div>

              <button
                onClick={startNegotiation}
                disabled={loading}
                className="w-full px-8 py-4 bg-foreground text-background font-black text-xs uppercase tracking-[0.3em] hover:invert transition-all flex items-center justify-center gap-3"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : "Verify & Start"}
              </button>
            </div>
          </div>
        </div>
      )}

      {started && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          <div className="lg:col-span-3 space-y-8">
            {/* Monitor */}
            <div className="grid grid-cols-4 gap-px bg-border border border-border">
              {[
                { label: "Fixed Cost", value: `₹${sellerCost}` },
                { label: "Current Bid", value: lastBuyerOffer ? `₹${lastBuyerOffer.toFixed(0)}` : "—" },
                { label: "Last Ask", value: history.filter((h) => h.actor === "seller").slice(-1)[0]?.price ? `₹${history.filter((h) => h.actor === "seller").slice(-1)[0]?.price?.toFixed(0)}` : "—" },
                { label: "Live Delta", value: lastBuyerOffer ? `₹${(lastBuyerOffer - sellerCost).toFixed(0)}` : "—" },
              ].map((m) => (
                <div key={m.label} className="bg-background p-4 text-center">
                  <div className="text-[9px] uppercase tracking-widest text-foreground/30 mb-2">{m.label}</div>
                  <div className="text-sm font-mono font-black">{m.value}</div>
                </div>
              ))}
            </div>

            {/* Comms */}
            <div className="border border-border bg-surface">
              <div className="px-6 py-4 border-b border-border flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-[0.2em] font-black">Transmission Log</span>
                {loading && <span className="text-[9px] uppercase tracking-widest animate-pulse font-black text-foreground/40">Processing...</span>}
              </div>
              <div ref={logRef} className="p-6 h-[400px] overflow-y-auto space-y-4 custom-scrollbar">
                {messages.map((msg, i) => (
                  <div key={i} className="text-[11px] font-sans leading-relaxed flex gap-6">
                    <span className="shrink-0 w-16 text-[9px] uppercase font-black tracking-widest opacity-30 pt-1 text-right">
                      {msg.type === "buyer" ? "MolBhav" : msg.type === "seller" ? "User" : "Sys"}
                    </span>
                    <span className={msg.type === "buyer" ? "text-foreground font-medium" : "text-foreground/50"}>
                      {msg.text}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Interaction */}
            {!done && (
              <div className="p-8 border border-border bg-surface">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                  <div className="md:col-span-3">
                    <label className="block text-[10px] uppercase tracking-[0.2em] font-black mb-6">Counteroffer Value</label>
                    <input
                      type="range"
                      min={sellerCost}
                      max={openingPrice}
                      value={counterPrice}
                      onChange={(e) => setCounterPrice(Number(e.target.value))}
                      className="w-full accent-foreground grayscale"
                    />
                    <div className="flex justify-between text-[10px] font-mono text-foreground/40 mt-4">
                      <span>MIN: ₹{sellerCost}</span>
                      <span className="text-foreground font-black text-2xl">₹{counterPrice}</span>
                      <span>MAX: ₹{openingPrice}</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-3 justify-end pb-1">
                    <button
                      onClick={() => submitCounter(counterPrice)}
                      disabled={loading}
                      className="w-full py-4 bg-foreground text-background font-black text-[10px] uppercase tracking-widest hover:invert transition-all flex items-center justify-center gap-2"
                    >
                      <Send size={12} /> Counter
                    </button>
                    <button
                      onClick={() => { if (lastBuyerOffer) submitCounter(lastBuyerOffer); }}
                      disabled={loading || !lastBuyerOffer}
                      className="w-full py-4 bg-transparent border border-border text-foreground font-black text-[10px] uppercase tracking-widest hover:bg-foreground hover:text-background transition-all"
                    >
                      Accept
                    </button>
                  </div>
                </div>
                <div className="mt-8 flex items-center gap-2 text-[9px] uppercase tracking-widest opacity-20 font-bold">
                  <Keyboard size={10} />
                  <span>Enter to Counter · Esc to Accept Offer</span>
                </div>
              </div>
            )}

            {/* Results */}
            {done && (
              <div className="p-12 border-2 border-foreground bg-foreground text-background text-center animate-fade-in">
                <div className="text-[10px] uppercase tracking-[0.5em] font-bold mb-4 opacity-50">Outcome Summary</div>
                <div className="text-4xl font-black uppercase tracking-tighter mb-8 italic">
                  {result?.outcome === "deal" ? `Agreed @ ₹${(result.agreed_price as number)?.toFixed(0)}` : "No Protocol Agreement"}
                </div>
                {result?.outcome === "deal" && (
                  <div className="grid grid-cols-2 gap-px bg-background/20 border border-background/20 max-w-sm mx-auto mb-10">
                    <div className="p-4 bg-foreground">
                      <div className="text-[9px] uppercase tracking-widest opacity-50 mb-1">Profit</div>
                      <div className="text-xl font-mono font-black">₹{(result.seller_profit as number)?.toFixed(0)}</div>
                    </div>
                    <div className="p-4 bg-foreground">
                      <div className="text-[9px] uppercase tracking-widest opacity-50 mb-1">Rank</div>
                      <div className="text-xl font-mono font-black">{percentile}th</div>
                    </div>
                  </div>
                )}
                <button
                  onClick={() => window.location.reload()}
                  className="px-8 py-3 border-2 border-background font-black text-xs uppercase tracking-[0.3em] hover:bg-background hover:text-foreground transition-all"
                >
                  New Session
                </button>
              </div>
            )}
          </div>

          {/* Monitoring Column */}
          <div className="space-y-8">
            <TellsPanel tells={currentTells} />
            <FakeLeaderboard currentScore={sellerShare} />
            <div className="p-6 border border-border bg-surface text-[10px] uppercase tracking-[0.1em] font-light leading-loose text-foreground/40">
              <div className="font-black mb-3 text-foreground opacity-100">Intelligence Brief</div>
              • Reservation Profit: User is responsible for surplus extraction above ₹{sellerCost}.<br/>
              • Bayesian Steering: MolBhav monitors bid velocity.<br/>
              • Tell Tracking: Sub-textual signals are verified via NLP pipeline.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

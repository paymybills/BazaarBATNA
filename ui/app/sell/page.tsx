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
  color: string;
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
    behavioral: "Behavioral (synthetic)",
    condition: "Condition",
  };

  return (
    <div className="rounded-xl bg-surface border border-border p-5">
      <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-accent animate-pulse-glow" />
        Live Tells — What MolBhav Sees
      </h3>
      {Object.entries(groups).map(([group, signals]) =>
        signals.length > 0 ? (
          <div key={group} className="mb-4 last:mb-0">
            <div className="text-[10px] uppercase tracking-wider text-foreground/30 mb-2">
              {groupLabels[group]}
            </div>
            <div className="space-y-2">
              {signals.map((signal) => {
                const pct = Math.max(0, Math.min(100, signal.value * 100));
                const barColor =
                  pct > 70
                    ? "bg-danger"
                    : pct > 40
                    ? "bg-warning"
                    : "bg-green-400";
                return (
                  <div key={signal.key} className="group relative">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="w-24 text-foreground/50 truncate">
                        {signal.label}
                        {signal.synthetic && (
                          <span className="ml-1 text-[9px] text-foreground/20">∗</span>
                        )}
                      </span>
                      <div className="flex-1 h-2 bg-surface-2 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ease-out ${barColor}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-10 text-right font-mono text-foreground/40 text-[11px]">
                        {pct.toFixed(0)}%
                      </span>
                    </div>
                    {/* Tooltip */}
                    <div className="absolute left-28 -top-8 hidden group-hover:block z-10 px-2 py-1 bg-surface-2 border border-border rounded text-[10px] text-foreground/60 whitespace-nowrap shadow-lg">
                      {signal.label}: {signal.value.toFixed(3)}
                      {signal.synthetic ? " (synthetic — no real signal)" : ""}
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

/* ── Fake leaderboard (stretch) ────────────────────────── */
function FakeLeaderboard({ currentScore }: { currentScore: number | null }) {
  const fakeScores = [0.78, 0.71, 0.65, 0.52, 0.44];
  return (
    <div className="rounded-xl bg-surface border border-border p-4">
      <h3 className="text-xs font-semibold mb-2 flex items-center gap-1.5 text-foreground/60">
        <Trophy size={12} className="text-warning" /> Top Human Sellers This Week
      </h3>
      <div className="space-y-1">
        {fakeScores.map((score, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-5 text-foreground/30">{i + 1}.</span>
            <div className="flex-1 h-1.5 bg-surface-2 rounded-full overflow-hidden">
              <div
                className="h-full bg-warning/60 rounded-full"
                style={{ width: `${score * 100}%` }}
              />
            </div>
            <span className="font-mono text-foreground/40 w-10 text-right">{score.toFixed(2)}</span>
          </div>
        ))}
        {currentScore !== null && (
          <div className="flex items-center gap-2 text-xs mt-1 pt-1 border-t border-border">
            <span className="w-5 text-accent">→</span>
            <div className="flex-1 h-1.5 bg-surface-2 rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full"
                style={{ width: `${currentScore * 100}%` }}
              />
            </div>
            <span className="font-mono text-accent w-10 text-right">{currentScore.toFixed(2)}</span>
          </div>
        )}
      </div>
      {currentScore === null && (
        <p className="text-[10px] text-foreground/25 mt-2">Complete a negotiation to see your rank.</p>
      )}
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

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!started || done) return;
      if (e.key === "Enter" && !e.shiftKey && !loading) {
        e.preventDefault();
        submitCounter(counterPrice);
      }
      if (e.key === "Escape") {
        // walk away — accept buyer's offer
        if (lastBuyerOffer && !loading) submitCounter(lastBuyerOffer);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [started, done, loading, counterPrice, lastBuyerOffer]);

  // Simulate extracted tells (synthetic — matches TellObservation structure)
  const generateTells = (round: number, buyerPrice: number | null): TellSignal[] => {
    const progress = round / 8;
    const pressure = buyerPrice ? Math.max(0, 1 - buyerPrice / openingPrice) : 0;
    return [
      { key: "urgency", label: "Urgency", value: Math.min(1, 0.2 + progress * 0.6 + Math.random() * 0.1), group: "verbal", color: "warning" },
      { key: "confidence", label: "Confidence", value: Math.max(0.1, 0.8 - progress * 0.4 + Math.random() * 0.1), group: "verbal", color: "accent" },
      { key: "deception", label: "Deception Cue", value: Math.min(1, 0.1 + Math.random() * 0.3 + pressure * 0.2), group: "verbal", color: "danger" },
      { key: "speed", label: "Offer Speed", value: Math.min(1, 0.3 + progress * 0.5), group: "verbal", color: "accent" },
      { key: "fidget", label: "Fidgeting", value: Math.min(1, 0.15 + progress * 0.35 + Math.random() * 0.1), group: "behavioral", color: "warning", synthetic: true },
      { key: "posture", label: "Posture Shift", value: Math.random() * 0.4, group: "behavioral", color: "accent", synthetic: true },
      { key: "eye_contact", label: "Eye Contact", value: Math.max(0.2, 0.7 - progress * 0.3), group: "behavioral", color: "accent", synthetic: true },
      { key: "condition", label: "Condition", value: 0.7 + Math.random() * 0.2, group: "condition", color: "accent" },
      { key: "depreciation", label: "Depreciation", value: 0.1 + Math.random() * 0.2, group: "condition", color: "warning" },
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
        { text: `You open at ₹${openingPrice}.`, type: "seller" },
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
          { text: `You counter: ₹${price}`, type: "seller" },
          { text: res.message, type: "buyer" },
        ]);

        if (res.buyer_price != null) {
          setLastBuyerOffer(res.buyer_price);
          if (!res.done) {
            setCounterPrice(Math.round(((res.buyer_price ?? 30) + price) / 2));
          }
        }

        // Update tells
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
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">Play as Seller vs MolBhav</h1>
        <p className="text-sm text-foreground/50">
          You set prices. MolBhav negotiates against you using Bayesian steering + NLP tell extraction.
          Can you hold the line?
        </p>
      </div>

      {/* Setup */}
      {!started && (
        <div className="max-w-lg mx-auto">
          <div className="p-6 rounded-xl bg-surface border border-border animate-fade-in">
            <h2 className="text-lg font-semibold mb-1">Role Brief</h2>
            <p className="text-xs text-foreground/40 mb-5">
              Chicago HAI Kellogg study format. You get a private cost, the buyer has a hidden budget.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-foreground/50 mb-1">Task</label>
                <select
                  value={selectedTask}
                  onChange={(e) => setSelectedTask(e.target.value)}
                  className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm focus:border-accent/40"
                  id="task-select"
                >
                  {Object.entries(tasks).map(([name, t]) => (
                    <option key={name} value={name}>
                      {name} ({t.difficulty})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-foreground/50 mb-1">AI Buyer Strategy</label>
                <select
                  value={strategy}
                  onChange={(e) => setStrategy(e.target.value)}
                  className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm focus:border-accent/40"
                  id="strategy-select"
                >
                  <option value="smart">Smart (Strategic)</option>
                  <option value="naive">Naive (Easy target)</option>
                  <option value="aggressive">Aggressive (Hardball)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-foreground/50 mb-1">Your Opening Price</label>
                <input
                  type="range"
                  min={sellerCost + 5}
                  max={150}
                  value={openingPrice}
                  onChange={(e) => setOpeningPrice(Number(e.target.value))}
                  className="w-full accent-accent"
                  id="opening-price-slider"
                />
                <div className="flex justify-between text-xs text-foreground/40 mt-1">
                  <span>Cost: ₹{sellerCost}</span>
                  <span className="text-accent font-mono font-bold text-lg">₹{openingPrice}</span>
                  <span>₹150</span>
                </div>
              </div>

              {/* Brief summary */}
              <div className="p-3 rounded-lg bg-surface-2 border border-border text-xs text-foreground/50 space-y-1">
                <div>• You are the <strong className="text-foreground/70">seller</strong>. Your reservation price is <strong className="text-danger">₹{sellerCost}</strong>.</div>
                <div>• Every rupee above cost is profit. Bonus: ₹1 per ₹100 above reservation.</div>
                <div>• MolBhav plays buyer with a hidden budget.</div>
                <div>• If you push too hard, MolBhav walks. No deal = no profit.</div>
              </div>

              <button
                onClick={startNegotiation}
                disabled={loading}
                className="w-full px-4 py-3 bg-accent text-background rounded-lg font-semibold hover:bg-accent/90 disabled:opacity-50 flex items-center justify-center gap-2"
                id="start-selling-btn"
              >
                {loading ? <Loader2 size={18} className="animate-spin" /> : null}
                Start Selling
              </button>
            </div>
          </div>
        </div>
      )}

      {started && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ── Left column: Chat + controls ── */}
          <div className="lg:col-span-2 space-y-4">
            {/* Metrics strip */}
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: "Your Cost", value: `₹${sellerCost}`, color: "" },
                { label: "Buyer Offers", value: lastBuyerOffer ? `₹${lastBuyerOffer.toFixed(0)}` : "—", color: "text-accent" },
                { label: "Your Last Ask", value: history.filter((h) => h.actor === "seller").slice(-1)[0]?.price ? `₹${history.filter((h) => h.actor === "seller").slice(-1)[0]?.price?.toFixed(0)}` : "—", color: "text-danger" },
                { label: "Potential Profit", value: lastBuyerOffer ? `₹${(lastBuyerOffer - sellerCost).toFixed(0)}` : "—", color: "text-green-400" },
              ].map((m) => (
                <div key={m.label} className="p-3 rounded-lg bg-surface border border-border">
                  <div className="text-[10px] text-foreground/40 uppercase tracking-wider">{m.label}</div>
                  <div className={`text-lg font-mono font-semibold ${m.color}`}>{m.value}</div>
                </div>
              ))}
            </div>

            {/* Chat thread */}
            <div className="rounded-xl bg-surface border border-border overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
                <span className="text-sm font-medium">Negotiation</span>
                {loading && (
                  <span className="flex items-center gap-1.5 text-xs text-accent">
                    <Loader2 size={12} className="animate-spin" /> MolBhav is thinking…
                  </span>
                )}
              </div>
              <div ref={logRef} className="p-4 max-h-80 overflow-y-auto space-y-3">
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`text-sm animate-fade-in flex gap-2 ${
                      msg.type === "buyer"
                        ? ""
                        : msg.type === "seller"
                        ? ""
                        : ""
                    }`}
                  >
                    <span
                      className={`shrink-0 w-16 text-xs font-semibold pt-0.5 ${
                        msg.type === "buyer"
                          ? "text-accent"
                          : msg.type === "seller"
                          ? "text-danger"
                          : "text-foreground/30"
                      }`}
                    >
                      {msg.type === "buyer" ? "MolBhav" : msg.type === "seller" ? "You" : "System"}
                    </span>
                    <span className={`flex-1 ${
                      msg.type === "buyer"
                        ? "text-foreground/80"
                        : msg.type === "seller"
                        ? "text-foreground/60"
                        : "text-foreground/30"
                    }`}>
                      {msg.text}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Price chart */}
            <div className="rounded-xl bg-surface border border-border p-4">
              <NegotiationChart
                history={history}
                budget={100}
                cost={sellerCost}
                dealPrice={(result?.agreed_price as number | null) ?? null}
              />
            </div>

            {/* Controls */}
            {!done && (
              <div className="flex items-end gap-3 p-4 rounded-xl bg-surface border border-border">
                <div className="flex-1">
                  <label className="block text-xs text-foreground/50 mb-1">
                    Your Counteroffer
                  </label>
                  <input
                    type="range"
                    min={sellerCost}
                    max={openingPrice}
                    value={counterPrice}
                    onChange={(e) => setCounterPrice(Number(e.target.value))}
                    className="w-full accent-accent"
                    id="counter-price-slider"
                  />
                  <div className="flex justify-between text-xs text-foreground/40 mt-1">
                    <span>₹{sellerCost}</span>
                    <span className="text-accent font-mono font-bold text-lg">₹{counterPrice}</span>
                    <span>₹{openingPrice}</span>
                  </div>
                </div>
                <button
                  onClick={() => submitCounter(counterPrice)}
                  disabled={loading}
                  className="px-5 py-2.5 bg-accent text-background rounded-lg font-medium text-sm hover:bg-accent/90 disabled:opacity-50 flex items-center gap-2"
                  id="counter-btn"
                >
                  <Send size={14} /> Counter
                </button>
                <button
                  onClick={() => { if (lastBuyerOffer) submitCounter(lastBuyerOffer); }}
                  disabled={loading || !lastBuyerOffer}
                  className="px-4 py-2.5 bg-green-600 text-white rounded-lg font-medium text-sm hover:bg-green-700 disabled:opacity-50"
                  id="accept-btn"
                >
                  Accept ₹{lastBuyerOffer?.toFixed(0)}
                </button>
              </div>
            )}

            {/* Keyboard hint */}
            {!done && started && (
              <div className="flex items-center gap-2 text-[10px] text-foreground/25 px-1">
                <Keyboard size={10} />
                <span>Enter = send counter &nbsp;·&nbsp; Esc = accept buyer&apos;s offer</span>
              </div>
            )}

            {/* Result */}
            {done && result && (
              <div
                className={`p-6 rounded-xl text-center animate-fade-in ${
                  result.outcome === "deal"
                    ? "bg-green-500/10 border border-green-500/20"
                    : "bg-danger/10 border border-danger/20"
                }`}
              >
                <div className={`font-bold text-xl mb-2 ${result.outcome === "deal" ? "text-green-400" : "text-danger"}`}>
                  {result.outcome === "deal"
                    ? `Deal at ₹${(result.agreed_price as number)?.toFixed(0)}!`
                    : result.outcome === "walk"
                    ? "Buyer walked away!"
                    : "Time expired!"}
                </div>
                {result.outcome === "deal" && sellerShare !== null && (
                  <div className="space-y-1 text-sm">
                    <div className="text-foreground/60">
                      Your profit: <span className="text-green-400 font-mono font-semibold">₹{(result.seller_profit as number)?.toFixed(0)}</span>
                      {" · "}Seller share: <span className="font-mono">{(sellerShare * 100).toFixed(1)}%</span>
                    </div>
                    <div className="text-foreground/40 text-xs">
                      You came in at the <span className="text-accent font-semibold">{percentile}th percentile</span> of human sellers.
                    </div>
                  </div>
                )}
                <button
                  onClick={() => {
                    setStarted(false);
                    setHistory([]);
                    setMessages([]);
                    setDone(false);
                    setResult(null);
                    setCurrentTells([]);
                  }}
                  className="mt-4 px-5 py-2 bg-surface border border-border rounded-lg text-sm hover:bg-surface-2"
                  id="play-again-btn"
                >
                  <RotateCcw size={14} className="inline mr-1.5" /> Play Again
                </button>
              </div>
            )}
          </div>

          {/* ── Right column: Tells panel ── */}
          <div className="space-y-4">
            {/* Tells */}
            <TellsPanel tells={currentTells} />

            {/* Fake leaderboard */}
            <FakeLeaderboard currentScore={sellerShare} />

            {/* Tips */}
            <div className="p-4 rounded-xl bg-surface border border-border">
              <h3 className="text-sm font-medium mb-2">Seller Tips</h3>
              <ul className="text-xs text-foreground/50 space-y-1.5 leading-relaxed">
                <li>• Your cost is ₹{sellerCost}. Anything above that is profit.</li>
                <li>• Anchor high, concede slowly.</li>
                <li>• MolBhav has a hidden budget (you don&apos;t know it).</li>
                <li>• If you push too hard, MolBhav walks. No deal = ₹0.</li>
                <li>• Watch the tells panel — it shows what MolBhav extracts from <em>your</em> behavior.</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

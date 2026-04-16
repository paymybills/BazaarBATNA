"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiPost, apiGet, type TaskInfo } from "../lib/api";
import { NegotiationChart } from "../components/NegotiationChart";

interface HistoryEntry {
  round: number;
  actor: string;
  action: string;
  price: number | null;
}

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
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiGet<Record<string, TaskInfo>>("/tasks").then(setTasks).catch(() => {});
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages]);

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
        { text: `You open at ${openingPrice} rupees.`, type: "seller" },
        { text: res.message, type: "buyer" },
      ]);
      setCounterPrice(Math.round(((res.buyer_price ?? 30) + openingPrice) / 2));
      setDone(false);
      setResult(null);
      setStarted(true);
    } catch (e) {
      setMessages([{ text: `Error: ${e}`, type: "error" }]);
    }
    setLoading(false);
  }, [selectedTask, strategy, openingPrice]);

  const submitCounter = useCallback(async (price: number) => {
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
        { text: `You counter: ${price} rupees`, type: "seller" },
        { text: res.message, type: "buyer" },
      ]);

      if (res.buyer_price != null) {
        setLastBuyerOffer(res.buyer_price);
        if (!res.done) {
          setCounterPrice(Math.round(((res.buyer_price ?? 30) + price) / 2));
        }
      }

      if (res.done) {
        setDone(true);
        setResult(res as Record<string, unknown>);
      }
    } catch (e) {
      setMessages((m) => [...m, { text: `Error: ${e}`, type: "error" }]);
    }
    setLoading(false);
  }, [done]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-2">Play as Seller</h1>
      <p className="text-sm text-foreground/50 mb-6">
        You set prices. An AI buyer negotiates against you.
        Can you maximize your profit without losing the deal?
      </p>

      {/* Setup */}
      {!started && (
        <div className="max-w-lg mx-auto p-6 rounded-xl bg-surface border border-border">
          <h2 className="text-lg font-semibold mb-4">Setup</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-foreground/50 mb-1">Task</label>
              <select
                value={selectedTask}
                onChange={(e) => setSelectedTask(e.target.value)}
                className="w-full bg-surface-2 border border-border rounded px-3 py-1.5 text-sm"
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
                className="w-full bg-surface-2 border border-border rounded px-3 py-1.5 text-sm"
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
                className="w-full accent-danger"
              />
              <div className="flex justify-between text-xs text-foreground/40">
                <span>Cost: {sellerCost}</span>
                <span className="text-danger font-mono font-bold text-base">{openingPrice}</span>
                <span>150</span>
              </div>
            </div>
            <button
              onClick={startNegotiation}
              disabled={loading}
              className="w-full px-4 py-2 bg-danger text-white rounded font-medium hover:bg-danger/90 disabled:opacity-50"
            >
              Start Selling
            </button>
          </div>
        </div>
      )}

      {started && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Chart + controls */}
          <div className="lg:col-span-2 space-y-4">
            {/* Metrics */}
            <div className="grid grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-surface border border-border">
                <div className="text-xs text-foreground/50">Your Cost</div>
                <div className="text-lg font-mono font-semibold">{sellerCost}</div>
              </div>
              <div className="p-3 rounded-lg bg-surface border border-border">
                <div className="text-xs text-foreground/50">Buyer Offers</div>
                <div className="text-lg font-mono font-semibold text-accent">
                  {lastBuyerOffer?.toFixed(0) ?? "-"}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-surface border border-border">
                <div className="text-xs text-foreground/50">Your Last Ask</div>
                <div className="text-lg font-mono font-semibold text-danger">
                  {history.filter((h) => h.actor === "seller").slice(-1)[0]?.price?.toFixed(0) ?? "-"}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-surface border border-border">
                <div className="text-xs text-foreground/50">Potential Profit</div>
                <div className="text-lg font-mono font-semibold text-green-400">
                  {lastBuyerOffer ? (lastBuyerOffer - sellerCost).toFixed(0) : "-"}
                </div>
              </div>
            </div>

            {/* Chart */}
            <div className="rounded-xl bg-surface border border-border p-4">
              <NegotiationChart
                history={history}
                budget={100}
                cost={sellerCost}
                dealPrice={result?.agreed_price as number | null ?? null}
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
                    className="w-full accent-danger"
                  />
                  <div className="flex justify-between text-xs text-foreground/40 mt-1">
                    <span>{sellerCost}</span>
                    <span className="text-danger font-mono font-bold text-base">{counterPrice}</span>
                    <span>{openingPrice}</span>
                  </div>
                </div>
                <button
                  onClick={() => submitCounter(counterPrice)}
                  disabled={loading}
                  className="px-5 py-2 bg-danger text-white rounded font-medium text-sm hover:bg-danger/90 disabled:opacity-50"
                >
                  Counter
                </button>
                <button
                  onClick={() => {
                    if (lastBuyerOffer) submitCounter(lastBuyerOffer);
                  }}
                  disabled={loading || !lastBuyerOffer}
                  className="px-4 py-2 bg-green-600 text-white rounded font-medium text-sm hover:bg-green-700 disabled:opacity-50"
                >
                  Accept {lastBuyerOffer?.toFixed(0)}
                </button>
              </div>
            )}

            {/* Result */}
            {done && result && (
              <div
                className={`p-4 rounded-xl text-center animate-fade-in ${
                  result.outcome === "deal"
                    ? "bg-green-500/10 border border-green-500/20 text-green-400"
                    : "bg-danger/10 border border-danger/20 text-danger"
                }`}
              >
                <div className="font-semibold text-lg">
                  {result.outcome === "deal"
                    ? `Deal at ${(result.agreed_price as number)?.toFixed(0)} rupees!`
                    : result.outcome === "walk"
                    ? "Buyer walked away!"
                    : "Time expired!"}
                </div>
                {result.outcome === "deal" && (
                  <div className="text-sm mt-1">
                    Your profit: {(result.seller_profit as number)?.toFixed(0)} | Buyer score: {(result.buyer_score as number)?.toFixed(4)}
                  </div>
                )}
                <button
                  onClick={() => { setStarted(false); setHistory([]); setMessages([]); setDone(false); setResult(null); }}
                  className="mt-3 px-4 py-1.5 bg-surface border border-border rounded text-sm hover:bg-surface-2"
                >
                  Play Again
                </button>
              </div>
            )}
          </div>

          {/* Right: Chat log */}
          <div>
            <div className="rounded-xl bg-surface border border-border">
              <div className="px-4 py-2 border-b border-border text-sm font-medium">
                Negotiation Log
              </div>
              <div ref={logRef} className="p-3 max-h-96 overflow-y-auto space-y-2">
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`text-sm animate-fade-in ${
                      msg.type === "buyer"
                        ? "text-accent"
                        : msg.type === "seller"
                        ? "text-danger"
                        : "text-foreground/40"
                    }`}
                  >
                    {msg.text}
                  </div>
                ))}
              </div>
            </div>

            {/* Strategy hint */}
            <div className="mt-4 p-4 rounded-xl bg-surface border border-border">
              <h3 className="text-sm font-medium mb-2">Seller Tips</h3>
              <ul className="text-xs text-foreground/50 space-y-1">
                <li>Your cost is {sellerCost}. Anything above that is profit.</li>
                <li>Anchor high, concede slowly.</li>
                <li>The AI buyer has a budget of 100 (hidden from you in real play).</li>
                <li>If you push too hard, the buyer walks.</li>
                <li>The sweet spot is usually 40-60% above cost.</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

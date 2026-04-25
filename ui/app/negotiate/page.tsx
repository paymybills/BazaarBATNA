"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  apiGet,
  apiPost,
  type BazaarObservation,
  type ResetResponse,
  type StepResponse,
  type TaskInfo,
} from "../lib/api";
import { NegotiationChart } from "../components/NegotiationChart";
import { TellsDisplay } from "../components/TellsDisplay";
import { Send, User, Brain, AlertCircle, RefreshCw } from "lucide-react";

interface HistoryEntry {
  round: number;
  actor: string;
  action: string;
  price: number | null;
}

export default function NegotiatePage() {
  const [tasks, setTasks] = useState<Record<string, TaskInfo>>({});
  const [selectedTask, setSelectedTask] = useState("single_deal");
  const [personality, setPersonality] = useState<string>("");
  const [obs, setObs] = useState<BazaarObservation | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [messages, setMessages] = useState<Array<{ round: number; text: string; type: string }>>([]);
  const [totalReward, setTotalReward] = useState(0);
  const [offerPrice, setOfferPrice] = useState(30);
  const [done, setDone] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiGet<Record<string, TaskInfo>>("/tasks").then(setTasks).catch(() => {});
  }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages]);

  const startNegotiation = useCallback(async () => {
    setLoading(true);
    try {
      const body: Record<string, unknown> = { task: selectedTask };
      if (personality) body.seller_personality = personality;
      const res = await apiPost<ResetResponse>("/reset", body);
      setObs(res.observation);
      setHistory([
        {
          round: 0,
          actor: "seller",
          action: "open",
          price: res.observation.seller_asking_price,
        },
      ]);
      setMessages([
        { round: 0, text: res.observation.message, type: "seller" },
      ]);
      setTotalReward(0);
      setDone(false);
      setScore(null);
      setOfferPrice(Math.round(res.observation.seller_asking_price * 0.5));
    } catch (e) {
      setMessages([{ round: 0, text: `Protocol Error: ${e}`, type: "error" }]);
    }
    setLoading(false);
  }, [selectedTask, personality]);

  const submitAction = useCallback(
    async (action: string, price?: number) => {
      if (!obs || done) return;
      setLoading(true);
      try {
        const body: Record<string, unknown> = { action };
        if (price !== undefined) body.price = price;
        const res = await apiPost<StepResponse>("/step", body);
        const newObs = res.observation;
        const info = (res.info || {}) as {
          episode_done?: boolean;
          episode?: number;
          next_episode?: number;
        };

        const invalidAccept = action === "accept" && typeof newObs.message === "string" && newObs.message.toLowerCase().includes("no seller offer to accept");
        const episodeRolled = Boolean(info.episode_done);

        const newHistory = [...history];
        if (!invalidAccept) {
          if (action === "offer" && price !== undefined) {
            newHistory.push({ round: newObs.current_round, actor: "buyer", action: "offer", price });
          }
          if (action === "accept") {
            newHistory.push({ round: newObs.current_round, actor: "buyer", action: "accept", price: obs.opponent_last_offer });
          }
          if (action === "walk") {
            newHistory.push({ round: newObs.current_round, actor: "buyer", action: "walk", price: null });
          }
          if (!episodeRolled && newObs.opponent_last_offer !== obs.opponent_last_offer) {
            newHistory.push({ round: newObs.current_round, actor: "seller", action: newObs.deal_outcome === "deal" ? "accept" : "counter", price: newObs.opponent_last_offer });
          }
        }

        setHistory(newHistory);
        setObs(newObs);
        setTotalReward((r) => r + res.reward);

        setMessages((m) => {
          const next = [...m];
          if (invalidAccept) {
            next.push({ round: newObs.current_round, text: `Violation: ${newObs.message}`, type: "error" });
            return next;
          }
          const actionLabel = action === "offer" ? `Offer Submitted: ₹${price?.toFixed(0)}` : action === "accept" ? "Acceptance Protocol Sent" : "Exit Sequence Initiated";
          next.push({ round: newObs.current_round, text: actionLabel, type: "buyer" });
          if (episodeRolled) {
            next.push({ round: newObs.current_round, text: `E${info.episode} Complete // E${info.next_episode || newObs.episode_number} Initialized (${newObs.item_name})`, type: "divider" });
          }
          next.push({ round: newObs.current_round, text: newObs.message, type: "seller" });
          return next;
        });

        if (res.done) {
          setDone(true);
          try {
            const scoreRes = await apiGet<{ score: number }>("/score");
            setScore(scoreRes.score);
          } catch {}
        }
      } catch (e) {
        setMessages((m) => [...m, { round: 0, text: `Runtime Error: ${e}`, type: "error" }]);
      }
      setLoading(false);
    },
    [obs, done, history]
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-16 selection:bg-foreground selection:text-background font-sans">
      <div className="flex flex-col md:flex-row items-baseline justify-between gap-6 mb-12 border-b border-border pb-8">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-tighter mb-2 italic">Operation.Manual</h1>
          <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-foreground/30">
            Buyer Mode // Manual Steering Control
          </p>
        </div>
        <div className="flex gap-4">
          <div className="space-y-1">
             <label className="block text-[8px] uppercase tracking-widest text-foreground/40 font-black">Scenario</label>
             <select
               value={selectedTask}
               onChange={(e) => setSelectedTask(e.target.value)}
               className="bg-background border border-border px-3 py-1.5 text-[10px] uppercase tracking-tighter font-black focus:border-foreground outline-none"
             >
               {Object.entries(tasks).map(([name, t]) => (
                 <option key={name} value={name}>{name}</option>
               ))}
             </select>
          </div>
          <div className="space-y-1">
             <label className="block text-[8px] uppercase tracking-widest text-foreground/40 font-black">Persona</label>
             <select
               value={personality}
               onChange={(e) => setPersonality(e.target.value)}
               className="bg-background border border-border px-3 py-1.5 text-[10px] uppercase tracking-tighter font-black focus:border-foreground outline-none"
             >
              <option value="">Default</option>
              <option value="deceptive">Deceptive</option>
              <option value="impatient">Impatient</option>
              <option value="collaborative">Collaborative</option>
             </select>
          </div>
          <button
            onClick={startNegotiation}
            disabled={loading}
            className="self-end px-6 py-2 bg-foreground text-background text-[10px] uppercase tracking-widest font-black hover:invert transition-all"
          >
            {obs ? <RefreshCw size={12} strokeWidth={3} /> : "Initialize"}
          </button>
        </div>
      </div>

      {!obs ? (
        <div className="border border-border bg-surface p-24 text-center">
          <div className="text-[10px] uppercase tracking-[0.4em] text-foreground/20 font-black">Waiting for Session Initialization...</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          <div className="lg:col-span-3 space-y-8">
            {/* Monitor */}
            <div className="grid grid-cols-4 gap-px bg-border border border-border">
              {[
                { label: "Temporal", value: `${obs.current_round} / ${obs.max_rounds}` },
                { label: "Cap", value: `₹${obs.own_private_budget.toFixed(0)}` },
                { label: "Current Bid", value: obs.opponent_last_offer ? `₹${obs.opponent_last_offer.toFixed(0)}` : "—" },
                { label: "Reward", value: totalReward.toFixed(3) },
              ].map((m) => (
                <div key={m.label} className="bg-background p-4 text-center">
                  <div className="text-[9px] uppercase tracking-widest text-foreground/30 mb-2 font-black">{m.label}</div>
                  <div className="text-sm font-mono font-black">{m.value}</div>
                </div>
              ))}
            </div>

            {/* Visualize */}
            <div className="border border-border p-8 bg-surface">
              <NegotiationChart
                history={history}
                budget={obs.own_private_budget}
                cost={30}
                dealPrice={obs.deal_outcome === "deal" ? obs.opponent_last_offer : null}
              />
            </div>

            {/* Interaction */}
            {!done && (
              <div className="p-8 border border-border bg-surface">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                  <div className="md:col-span-2">
                    <label className="block text-[10px] uppercase tracking-[0.2em] font-black mb-6">Injected Offer</label>
                    <input
                      type="range"
                      min={1}
                      max={obs.own_private_budget}
                      value={offerPrice}
                      onChange={(e) => setOfferPrice(Number(e.target.value))}
                      className="w-full accent-foreground grayscale"
                    />
                    <div className="flex justify-between text-[10px] font-mono text-foreground/40 mt-4 font-bold">
                      <span>MIN: ₹1</span>
                      <span className="text-foreground font-black text-2xl">₹{offerPrice}</span>
                      <span>CAP: {obs.own_private_budget}</span>
                    </div>
                  </div>
                  <div className="md:col-span-2 flex flex-col gap-2 justify-end">
                    <button
                      onClick={() => submitAction("offer", offerPrice)}
                      disabled={loading}
                      className="w-full py-4 bg-foreground text-background font-black text-[10px] uppercase tracking-widest hover:invert transition-all flex items-center justify-center gap-2"
                    >
                      <Send size={12} strokeWidth={3} /> Submit Offer
                    </button>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => submitAction("accept")}
                        disabled={loading}
                        className="py-3 border border-border text-foreground font-black text-[9px] uppercase tracking-widest hover:bg-foreground hover:text-background transition-all"
                      >
                        Accept Bid
                      </button>
                      <button
                        onClick={() => submitAction("walk")}
                        disabled={loading}
                        className="py-3 border border-border text-foreground font-black text-[9px] uppercase tracking-widest hover:bg-foreground hover:text-background transition-all"
                      >
                        Exit
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {done && score !== null && (
              <div className="p-12 border-2 border-foreground bg-foreground text-background text-center animate-fade-in">
                <div className="text-[10px] uppercase tracking-[0.5em] font-bold mb-4 opacity-50">Session Finalized</div>
                <div className="text-4xl font-black uppercase tracking-tighter mb-4 italic italic">
                  Surplus Rank: {score.toFixed(4)}
                </div>
                <p className="text-[10px] uppercase tracking-widest opacity-50 mb-8 font-black">
                  {score >= 0.3 ? "VERIFICATION SUCCESSFUL" : "SUB-OPTIMAL SURPLUS DETECTED"}
                </p>
                <button
                  onClick={() => window.location.reload()}
                  className="px-8 py-3 border-2 border-background font-black text-xs uppercase tracking-[0.3em] hover:bg-background hover:text-foreground transition-all"
                >
                  Restart Buffer
                </button>
              </div>
            )}
          </div>

          {/* Comms */}
          <div className="space-y-8">
            <TellsDisplay
              tells={obs.tells}
              personality={obs.seller_personality}
            />

            <div className="border border-border bg-surface overflow-hidden">
              <div className="px-6 py-4 border-b border-border text-[9px] uppercase tracking-[0.2em] font-black opacity-30">
                Transmission Buffer
              </div>
              <div ref={logRef} className="p-6 h-[400px] overflow-y-auto space-y-4 custom-scrollbar">
                {messages.map((msg, i) => {
                  if (msg.type === "divider") {
                    return (
                      <div key={i} className="text-[9px] uppercase tracking-widest text-foreground/20 text-center py-4 border-t border-white/5 font-black">
                        {msg.text}
                      </div>
                    );
                  }
                  return (
                    <div key={i} className={`flex gap-4 text-[10px] font-sans leading-relaxed animate-fade-in ${msg.type === 'error' ? 'text-red-500' : ''}`}>
                      <span className="shrink-0 w-8 text-[8px] font-mono opacity-20 pt-1 italic">[{String(msg.round).padStart(2, '0')}]</span>
                      <span className={msg.type === "buyer" ? "text-foreground font-black uppercase tracking-widest text-[8px] shrink-0" : "text-foreground/50"}>
                        {msg.type === "error" ? <AlertCircle size={10} className="inline mr-1" /> : ""}
                        {msg.text}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

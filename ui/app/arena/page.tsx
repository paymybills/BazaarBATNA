"use client";

import { useCallback, useState } from "react";
import { apiPost, apiGet } from "../lib/api";
import { Users, Info, ArrowRight, Zap, Target } from "lucide-react";

interface ArenaInfo {
  arena_id: string;
  num_buyers: number;
}

interface BuyerObs {
  buyer_id: string;
  negotiation: {
    current_round: number;
    max_rounds: number;
    opponent_last_offer: number | null;
    own_last_offer: number | null;
    own_private_budget: number;
    seller_asking_price: number;
    seller_personality: string;
    rounds_remaining: number;
    done: boolean;
    deal_outcome: string | null;
    message: string;
    tells: Record<string, unknown> | null;
  };
  other_buyers_visible: Array<{
    buyer_id: string;
    name: string;
    status: string;
    rounds_active?: number;
  }>;
  coalition_signals: Array<{
    round: number;
    buyer_id: string;
    signal: string;
  }>;
  seller_attention: string;
}

interface ArenaState {
  arena_id: string;
  current_round: number;
  max_rounds: number;
  done: boolean;
  winner: string | null;
  deal_price: number | null;
  buyer_states: Record<string, { offers: unknown[]; total_offers: number; last_price: number | null }>;
}

export default function ArenaPage() {
  const [arena, setArena] = useState<ArenaInfo | null>(null);
  const [numBuyers, setNumBuyers] = useState(3);
  const [buyers, setBuyers] = useState<string[]>([]);
  const [observations, setObservations] = useState<Record<string, BuyerObs>>({});
  const [arenaState, setArenaState] = useState<ArenaState | null>(null);
  const [offers, setOffers] = useState<Record<string, number>>({});
  const [signals, setSignals] = useState<Record<string, string>>({});
  const [log, setLog] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const createArena = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiPost<ArenaInfo>("/arena/create", {
        task: "marketplace_arena",
        seed: Math.floor(Math.random() * 10000),
        num_buyers: numBuyers,
      });
      setArena(res);
      setLog([`Arena Created: ${res.arena_id}`]);

      const buyerIds: string[] = [];
      const names = ["Alice", "Bob", "Carol", "Dave", "Eve"];
      for (let i = 0; i < numBuyers; i++) {
        const bid = `buyer_${i}`;
        await apiPost(`/arena/${res.arena_id}/join`, {
          buyer_id: bid,
          name: names[i] || `Buyer ${i}`,
          is_human: i === 0,
        });
        buyerIds.push(bid);
      }
      setBuyers(buyerIds);

      const obs = await apiPost<Record<string, BuyerObs>>(`/arena/${res.arena_id}/reset`, {});
      setObservations(obs);

      const initOffers: Record<string, number> = {};
      for (const bid of buyerIds) {
        initOffers[bid] = Math.round((obs[bid]?.negotiation?.seller_asking_price ?? 60) * 0.5);
      }
      setOffers(initOffers);
      setLog((l) => [...l, "Session Active. Sequential bidding protocols engaged."]);
    } catch (e) {
      setLog((l) => [...l, `Protocol Error: ${e}`]);
    }
    setLoading(false);
  }, [numBuyers]);

  const submitRound = useCallback(async () => {
    if (!arena) return;
    setLoading(true);
    try {
      const actions: Record<string, Record<string, unknown>> = {};
      for (const bid of buyers) {
        const isHuman = bid === "buyer_0";
        if (isHuman) {
          actions[bid] = { action: "offer", price: offers[bid], signal: signals[bid] || null };
        } else {
          const obs = observations[bid];
          if (!obs) continue;
          const ask = obs.negotiation.opponent_last_offer ?? obs.negotiation.seller_asking_price;
          const budget = obs.negotiation.own_private_budget;
          const round = obs.negotiation.current_round;
          const aiOffer = Math.min(budget * 0.7, ask * (0.5 + round * 0.06) + (Math.random() * 5 - 2.5));
          actions[bid] = { action: "offer", price: Math.round(aiOffer) };
        }
      }

      const result = await apiPost<Record<string, BuyerObs>>(`/arena/${arena.arena_id}/step`, { actions });
      setObservations(result);

      const state = await apiGet<ArenaState>(`/arena/${arena.arena_id}/state`);
      setArenaState(state);

      const msgs: string[] = [];
      for (const [bid, obs] of Object.entries(result)) {
        const name = bid === "buyer_0" ? "USER" : bid.toUpperCase();
        msgs.push(`${name} // ${obs.negotiation.message}`);
      }
      setLog((l) => [...l, `[T=${state.current_round}]`, ...msgs]);

      if (state.done) {
        const winner = state.winner === "buyer_0" ? "USER" : state.winner?.toUpperCase();
        setLog((l) => [...l, state.winner ? `COMPLETED: SOLD TO ${winner} @ ₹${state.deal_price?.toFixed(0)}` : "TERMINATED: NO DEAL"]);
      }
    } catch (e) {
      setLog((l) => [...l, `Runtime Error: ${e}`]);
    }
    setLoading(false);
  }, [arena, buyers, offers, signals, observations]);

  const myObs = observations["buyer_0"];
  const isDone = arenaState?.done ?? false;

  return (
    <div className="max-w-6xl mx-auto px-4 py-16 selection:bg-foreground selection:text-background font-sans">
      <div className="flex flex-col md:flex-row items-baseline justify-between gap-6 mb-12 border-b border-border pb-8">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-tighter mb-2 italic">Arena.v1</h1>
          <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-foreground/30">
            Multi-Agent Collision Environment // Marketplace Metrics
          </p>
        </div>
      </div>

      {!arena ? (
        <div className="max-w-md mx-auto">
          <div className="p-12 border border-border bg-surface">
            <h2 className="text-xs font-black uppercase tracking-[0.2em] mb-12 border-b border-border pb-2">Deployment</h2>
            <div className="space-y-12">
               <div className="space-y-6">
                <label className="block text-[10px] uppercase tracking-[0.15em] text-foreground/40 font-black">Node Count</label>
                <input
                  type="range"
                  min={2}
                  max={5}
                  value={numBuyers}
                  onChange={(e) => setNumBuyers(Number(e.target.value))}
                  className="w-full accent-foreground grayscale"
                />
                <div className="text-center text-[10px] uppercase tracking-widest font-black opacity-30 italic">{numBuyers} Active Buyers</div>
              </div>

              <div className="p-4 border border-border text-[10px] uppercase tracking-[0.1em] text-foreground/40 leading-relaxed font-light">
                Simulation replicates Facebook Marketplace dynamics. User occupies Node_0. Counter-agents utilize stochastic Concession strategies.
              </div>

              <button
                onClick={createArena}
                disabled={loading}
                className="w-full px-8 py-4 bg-foreground text-background font-black text-xs uppercase tracking-[0.3em] hover:invert transition-all"
              >
                {loading ? "Initializing..." : "Mount Environment"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          <div className="lg:col-span-3 space-y-8">
            {/* Monitor */}
            <div className="grid grid-cols-4 gap-px bg-border border border-border">
              {[
                { label: "Temporal", value: `${arenaState?.current_round ?? 0} / ${arenaState?.max_rounds ?? 12}` },
                { label: "Active Bid", value: myObs?.negotiation.opponent_last_offer?.toFixed(0) ?? "—" },
                { label: "Allocation", value: `₹${myObs?.negotiation.own_private_budget ?? 100}` },
                { label: "Priority", value: myObs?.seller_attention === "buyer_0" ? "HIGH" : "LOW" },
              ].map((m) => (
                <div key={m.label} className="bg-background p-4 text-center">
                  <div className="text-[9px] uppercase tracking-widest text-foreground/30 mb-2 font-black">{m.label}</div>
                  <div className="text-xs font-mono font-black">{m.value}</div>
                </div>
              ))}
            </div>

            {/* Nodes */}
            <div className="p-8 border border-border bg-surface">
              <h3 className="text-[10px] uppercase tracking-[0.2em] font-black mb-8 italic opacity-30">Network Nodes</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {myObs?.other_buyers_visible.map((b) => (
                  <div
                    key={b.buyer_id}
                    className={`p-6 border transition-all ${
                      myObs.seller_attention === b.buyer_id
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-background text-foreground/30"
                    }`}
                  >
                    <div className="font-black text-[10px] uppercase tracking-tighter mb-2 italic">
                       {myObs.seller_attention === b.buyer_id && <Zap size={10} className="inline mr-2 fill-current" />}
                       {b.name}
                    </div>
                    <div className="text-[8px] uppercase tracking-widest font-bold">
                      {b.status} // {b.rounds_active ?? 0}T
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Interaction */}
            {!isDone && (
              <div className="p-8 border border-border bg-surface">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                  <div className="md:col-span-2">
                    <label className="block text-[10px] uppercase tracking-[0.2em] font-black mb-6">Injected Proposal</label>
                    <input
                      type="range"
                      min={1}
                      max={myObs?.negotiation.own_private_budget ?? 100}
                      value={offers["buyer_0"] ?? 30}
                      onChange={(e) => setOffers({ ...offers, buyer_0: Number(e.target.value) })}
                      className="w-full accent-foreground grayscale"
                    />
                    <div className="flex justify-between text-[10px] font-mono text-foreground/40 mt-4 font-bold">
                      <span>MIN: ₹1</span>
                      <span className="text-foreground font-black text-2xl">₹{offers["buyer_0"] ?? 30}</span>
                      <span>CAP: {myObs?.negotiation.own_private_budget}</span>
                    </div>
                  </div>
                  <div className="space-y-6">
                    <label className="block text-[10px] uppercase tracking-[0.2em] font-black mb-1">Signal Mode</label>
                    <select
                      value={signals["buyer_0"] || ""}
                      onChange={(e) => setSignals({ ...signals, buyer_0: e.target.value })}
                      className="w-full bg-background border border-border px-4 py-3 text-[10px] uppercase tracking-tighter font-black focus:border-foreground outline-none"
                    >
                      <option value="">Linear</option>
                      <option value="cooperate">Cooperative</option>
                      <option value="compete">Competitive</option>
                      <option value="bluff">Deceptive</option>
                    </select>
                  </div>
                  <div className="flex flex-col justify-end">
                    <button
                      onClick={submitRound}
                      disabled={loading}
                      className="w-full py-4 bg-foreground text-background font-black text-[10px] uppercase tracking-widest hover:invert transition-all"
                    >
                      Submit Sequential
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isDone && arenaState && (
              <div className="p-12 border-2 border-foreground bg-foreground text-background text-center animate-fade-in font-sans">
                <div className="text-[10px] uppercase tracking-[0.5em] font-bold mb-4 opacity-50">Transfer Protocol Finalized</div>
                <div className="text-4xl font-black uppercase tracking-tighter mb-4 italic">
                  {arenaState.winner === "buyer_0" ? "USER DECLARED WINNER" : `${arenaState.winner?.toUpperCase()} DECLARED WINNER`}
                </div>
                <div className="text-xl font-mono font-black italic opacity-60 mb-10 underline underline-offset-8">
                  ₹{arenaState.deal_price?.toFixed(0)} Surrendered
                </div>
                <button
                  onClick={() => window.location.reload()}
                  className="px-8 py-3 border-2 border-background font-black text-xs uppercase tracking-[0.3em] hover:bg-background hover:text-foreground transition-all"
                >
                  Restart Simulation
                </button>
              </div>
            )}
          </div>

          {/* Monitoring */}
          <div className="space-y-8">
            <div className="border border-border bg-surface p-6 font-mono">
               <div className="text-[10px] uppercase tracking-[0.2em] font-black italic mb-6 opacity-30">Network Buffer</div>
               <div className="h-[500px] overflow-y-auto space-y-4 custom-scrollbar">
                {log.map((msg, i) => (
                  <div key={i} className={`text-[9px] leading-relaxed animate-fade-in ${msg.startsWith('[T=') ? 'text-foreground font-black border-t border-white/5 pt-3 mt-3' : 'text-foreground/40'}`}>
                    {msg}
                  </div>
                ))}
               </div>
            </div>
            
            {myObs?.coalition_signals && myObs.coalition_signals.length > 0 && (
              <div className="border border-border bg-surface p-6">
                <h3 className="text-[10px] uppercase tracking-[0.2em] font-black mb-4 italic opacity-30">Tactical Signals</h3>
                <div className="space-y-2">
                  {myObs.coalition_signals.map((s, i) => (
                    <div key={i} className="text-[10px] uppercase tracking-widest font-black italic">
                      <span className="opacity-30">{s.buyer_id} //</span> <span className="underline decoration-1">{s.signal}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

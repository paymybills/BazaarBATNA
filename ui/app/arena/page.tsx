"use client";

import { useCallback, useState } from "react";
import { apiPost, apiGet } from "../lib/api";

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
      setLog([`Arena created: ${res.arena_id}`]);

      // Auto-join AI buyers
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
      setLog((l) => [...l, `${numBuyers} buyers joined`]);

      // Reset
      const obs = await apiPost<Record<string, BuyerObs>>(`/arena/${res.arena_id}/reset`, {});
      setObservations(obs);

      // Init offers
      const initOffers: Record<string, number> = {};
      for (const bid of buyerIds) {
        initOffers[bid] = Math.round((obs[bid]?.negotiation?.seller_asking_price ?? 60) * 0.5);
      }
      setOffers(initOffers);
      setLog((l) => [...l, "Arena started. Seller opens bidding."]);
    } catch (e) {
      setLog((l) => [...l, `Error: ${e}`]);
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
          actions[bid] = {
            action: "offer",
            price: offers[bid],
            signal: signals[bid] || null,
          };
        } else {
          // Simple AI strategy for other buyers
          const obs = observations[bid];
          if (!obs) continue;
          const ask = obs.negotiation.opponent_last_offer ?? obs.negotiation.seller_asking_price;
          const budget = obs.negotiation.own_private_budget;
          const round = obs.negotiation.current_round;
          const aiOffer = Math.min(
            budget * 0.7,
            ask * (0.5 + round * 0.06) + (Math.random() * 5 - 2.5)
          );
          actions[bid] = {
            action: "offer",
            price: Math.round(aiOffer),
          };
        }
      }

      const result = await apiPost<Record<string, BuyerObs>>(
        `/arena/${arena.arena_id}/step`,
        { actions }
      );
      setObservations(result);

      // Get state
      const state = await apiGet<ArenaState>(`/arena/${arena.arena_id}/state`);
      setArenaState(state);

      // Log
      const msgs: string[] = [];
      for (const [bid, obs] of Object.entries(result)) {
        const name = bid === "buyer_0" ? "You" : bid.replace("_", " ");
        msgs.push(`${name}: ${obs.negotiation.message}`);
      }
      setLog((l) => [...l, `--- Round ${state.current_round} ---`, ...msgs]);

      if (state.done) {
        const winner = state.winner === "buyer_0" ? "You" : state.winner;
        setLog((l) => [
          ...l,
          state.winner
            ? `SOLD to ${winner} for ${state.deal_price?.toFixed(0)} rupees!`
            : "No deal reached.",
        ]);
      }
    } catch (e) {
      setLog((l) => [...l, `Error: ${e}`]);
    }
    setLoading(false);
  }, [arena, buyers, offers, signals, observations]);

  const myObs = observations["buyer_0"];
  const isDone = arenaState?.done ?? false;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-2">Multi-Buyer Arena</h1>
      <p className="text-sm text-foreground/50 mb-6">
        Facebook Marketplace dynamics: multiple buyers, one seller, imperfect information.
      </p>

      {!arena ? (
        <div className="max-w-md mx-auto p-6 rounded-xl bg-surface border border-border">
          <h2 className="text-lg font-semibold mb-4">Create Arena</h2>
          <div className="mb-4">
            <label className="block text-xs text-foreground/50 mb-1">Number of Buyers</label>
            <input
              type="range"
              min={2}
              max={5}
              value={numBuyers}
              onChange={(e) => setNumBuyers(Number(e.target.value))}
              className="w-full accent-accent"
            />
            <div className="text-center text-sm font-mono">{numBuyers} buyers</div>
          </div>
          <p className="text-xs text-foreground/40 mb-4">
            You play as Buyer 0 (human). Others are AI agents with simple strategies.
          </p>
          <button
            onClick={createArena}
            disabled={loading}
            className="w-full px-4 py-2 bg-accent text-background rounded font-medium hover:bg-accent/90 disabled:opacity-50"
          >
            Create & Start
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Your controls */}
          <div className="lg:col-span-2 space-y-4">
            {/* Status */}
            <div className="grid grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-surface border border-border">
                <div className="text-xs text-foreground/50">Round</div>
                <div className="text-lg font-mono font-semibold">
                  {arenaState?.current_round ?? 0} / {arenaState?.max_rounds ?? 12}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-surface border border-border">
                <div className="text-xs text-foreground/50">Seller Ask</div>
                <div className="text-lg font-mono font-semibold">
                  {myObs?.negotiation.opponent_last_offer?.toFixed(0) ?? "-"}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-surface border border-border">
                <div className="text-xs text-foreground/50">Your Budget</div>
                <div className="text-lg font-mono font-semibold">
                  {myObs?.negotiation.own_private_budget ?? 100}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-surface border border-border">
                <div className="text-xs text-foreground/50">Seller Attention</div>
                <div className="text-sm font-semibold">
                  {myObs?.seller_attention === "buyer_0" ? "ON YOU" : myObs?.seller_attention ?? "all"}
                </div>
              </div>
            </div>

            {/* Other buyers */}
            <div className="rounded-xl bg-surface border border-border p-4">
              <h3 className="text-sm font-medium mb-3">Other Buyers</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {myObs?.other_buyers_visible.map((b) => (
                  <div
                    key={b.buyer_id}
                    className={`p-3 rounded-lg border ${
                      myObs.seller_attention === b.buyer_id
                        ? "border-warning bg-warning/5"
                        : "border-border bg-surface-2"
                    }`}
                  >
                    <div className="font-medium text-sm">{b.name}</div>
                    <div className="text-xs text-foreground/50">
                      {b.status} ({b.rounds_active ?? 0} rounds)
                    </div>
                    {myObs.seller_attention === b.buyer_id && (
                      <div className="text-xs text-warning mt-1">Seller focused here</div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Your action */}
            {!isDone && (
              <div className="rounded-xl bg-surface border border-border p-4">
                <h3 className="text-sm font-medium mb-3">Your Move</h3>
                <div className="flex items-end gap-4">
                  <div className="flex-1">
                    <label className="block text-xs text-foreground/50 mb-1">Offer Price</label>
                    <input
                      type="range"
                      min={1}
                      max={myObs?.negotiation.own_private_budget ?? 100}
                      value={offers["buyer_0"] ?? 30}
                      onChange={(e) =>
                        setOffers({ ...offers, buyer_0: Number(e.target.value) })
                      }
                      className="w-full accent-accent"
                    />
                    <div className="text-center font-mono text-accent font-bold">
                      {offers["buyer_0"] ?? 30}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-foreground/50 mb-1">Signal</label>
                    <select
                      value={signals["buyer_0"] || ""}
                      onChange={(e) =>
                        setSignals({ ...signals, buyer_0: e.target.value })
                      }
                      className="bg-surface-2 border border-border rounded px-2 py-1.5 text-sm"
                    >
                      <option value="">None</option>
                      <option value="cooperate">Cooperate</option>
                      <option value="compete">Compete</option>
                      <option value="bluff">Bluff</option>
                    </select>
                  </div>
                  <button
                    onClick={submitRound}
                    disabled={loading}
                    className="px-5 py-2 bg-accent text-background rounded font-medium hover:bg-accent/90 disabled:opacity-50"
                  >
                    Submit Round
                  </button>
                </div>
              </div>
            )}

            {/* Result */}
            {isDone && arenaState && (
              <div
                className={`p-4 rounded-xl text-center font-semibold animate-fade-in ${
                  arenaState.winner === "buyer_0"
                    ? "bg-green-500/10 border border-green-500/20 text-green-400"
                    : "bg-danger/10 border border-danger/20 text-danger"
                }`}
              >
                {arenaState.winner === "buyer_0"
                  ? `You won! Deal at ${arenaState.deal_price?.toFixed(0)} rupees`
                  : arenaState.winner
                  ? `${arenaState.winner} won at ${arenaState.deal_price?.toFixed(0)} rupees`
                  : "No deal reached"}
              </div>
            )}
          </div>

          {/* Right: Log + Signals */}
          <div className="space-y-4">
            {/* Coalition signals */}
            {myObs?.coalition_signals && myObs.coalition_signals.length > 0 && (
              <div className="rounded-xl bg-surface border border-border p-4">
                <h3 className="text-sm font-medium mb-2">Coalition Signals</h3>
                {myObs.coalition_signals.map((s, i) => (
                  <div key={i} className="text-xs text-foreground/60">
                    <span className="font-medium">{s.buyer_id}</span> signals{" "}
                    <span
                      className={
                        s.signal === "cooperate"
                          ? "text-green-400"
                          : s.signal === "compete"
                          ? "text-danger"
                          : "text-warning"
                      }
                    >
                      {s.signal}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Live log */}
            <div className="rounded-xl bg-surface border border-border">
              <div className="px-4 py-2 border-b border-border text-sm font-medium">
                Arena Log
              </div>
              <div className="p-3 max-h-96 overflow-y-auto space-y-1">
                {log.map((msg, i) => (
                  <div
                    key={i}
                    className={`text-xs animate-fade-in ${
                      msg.startsWith("---")
                        ? "font-medium text-foreground/50 mt-2"
                        : msg.startsWith("SOLD") || msg.startsWith("No deal")
                        ? "font-bold text-accent"
                        : "text-foreground/70"
                    }`}
                  >
                    {msg}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

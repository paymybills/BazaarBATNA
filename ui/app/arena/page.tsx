"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, ChevronRight, ChevronLeft, RotateCcw, Trophy } from "lucide-react";

interface BuyerAction {
  buyer: string;
  label: string;
  action: "offer" | "accept" | "walk";
  price: number | null;
  message: string;
}

interface ArenaRound {
  round: number;
  actions: BuyerAction[];
  seller_message: string;
}

interface ArenaScenario {
  id: string;
  title: string;
  subtitle: string;
  listing_price: number;
  seller_reservation: number;
  rounds: ArenaRound[];
  outcome: {
    winner: string;
    price: number;
    comment: string;
  };
}

const BUYER_COLORS: Record<string, string> = {
  rule_aggressive: "var(--bad)",
  rule_smart: "var(--accent-2)",
  llama32_baseline: "var(--warn)",
  bestdealbot: "var(--accent)",
};

export default function ArenaPage() {
  const [replays, setReplays] = useState<ArenaScenario[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [round, setRound] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/arena_replays.json")
      .then((r) => r.json())
      .then(setReplays)
      .catch(() => {});
  }, []);

  const scenario = replays[activeIdx];
  const totalRounds = scenario?.rounds.length ?? 0;

  useEffect(() => {
    if (!playing) return;
    timerRef.current = setInterval(() => {
      setRound((r) => {
        if (r >= totalRounds - 1) {
          setPlaying(false);
          return r;
        }
        return r + 1;
      });
    }, 1800);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [playing, totalRounds]);

  useEffect(() => {
    setRound(0);
    setPlaying(false);
  }, [activeIdx]);

  const visibleRounds = scenario?.rounds.slice(0, round + 1) ?? [];
  const isFinal = scenario && round >= totalRounds - 1;

  // Aggregate per-buyer trace for the chart-strip. Each segment carries
  // both the price (if any) and the action so the renderer can show
  // walked/accepted lifecycles correctly — otherwise every buyer's bar
  // looks identical because all scenarios are the same number of rounds.
  type Seg = { price: number | null; action: string | null };
  const buyerLines = useMemo(() => {
    if (!scenario) return [] as { id: string; label: string; color: string; segs: Seg[]; finalRound: number; finalAction: string | null }[];
    const buyerIds = Array.from(
      new Set(scenario.rounds.flatMap((r) => r.actions.map((a) => a.buyer)))
    );
    return buyerIds.map((bid) => {
      const sample = scenario.rounds[0].actions.find((a) => a.buyer === bid);
      const label = sample?.label ?? bid;
      const segs: Seg[] = scenario.rounds.map((r) => {
        const a = r.actions.find((act) => act.buyer === bid);
        return {
          price: a?.price ?? null,
          action: (a?.action ?? null) as string | null,
        };
      });
      // Find the buyer's final live round (the one where they accepted/walked,
      // or the last offer if they survived to the end). Subsequent rounds get
      // rendered as "out of game".
      let finalRound = segs.length - 1;
      let finalAction: string | null = null;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (s.action === "accept" || s.action === "walk") {
          finalRound = i;
          finalAction = s.action;
          break;
        }
      }
      return { id: bid, label, color: BUYER_COLORS[bid] ?? "var(--foreground)", segs, finalRound, finalAction };
    });
  }, [scenario]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      <div className="mb-10">
        <h1 className="text-h1 mb-2">Arena</h1>
        <p className="text-meta">
          Pre-computed multi-buyer rollouts. Each agent competes for the same listing.
        </p>
      </div>

      {/* Scenario picker */}
      <div className="rounded-xl border border-border bg-surface p-2 mb-6 flex flex-wrap gap-2">
        {replays.map((r, i) => (
          <button
            key={r.id}
            onClick={() => setActiveIdx(i)}
            className={`flex-1 min-w-[180px] px-4 py-3 rounded-lg text-left transition-colors ${
              i === activeIdx
                ? "bg-surface-2 border border-border-2"
                : "border border-transparent hover:bg-surface-2/50"
            }`}
          >
            <div className="text-foreground text-sm font-medium leading-tight">
              {r.title}
            </div>
            <div className="text-meta mt-0.5">{r.subtitle}</div>
          </button>
        ))}
      </div>

      {scenario && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-5">
            {/* Listing strip */}
            <div className="rounded-xl border border-border bg-surface px-5 py-4 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-4">
                <div className="text-eyebrow">listing</div>
                <div className="text-foreground font-medium text-sm">{scenario.title}</div>
              </div>
              <div className="flex items-center gap-5 text-sm font-mono tabular-nums">
                <span className="text-fg3">res ${scenario.seller_reservation.toLocaleString()}</span>
                <span className="text-fg2">listed ${scenario.listing_price.toLocaleString()}</span>
              </div>
            </div>

            {/* Buyer table */}
            <div className="rounded-xl border border-border bg-surface overflow-hidden">
              <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                <div className="text-eyebrow">Buyers · round {round + 1} / {totalRounds}</div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setRound((r) => Math.max(0, r - 1))}
                    className="p-1.5 rounded hover:bg-surface-2 transition-colors"
                    aria-label="prev"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    onClick={() => setPlaying((p) => !p)}
                    className="p-1.5 rounded hover:bg-surface-2 transition-colors"
                    aria-label={playing ? "pause" : "play"}
                  >
                    {playing ? <Pause size={14} /> : <Play size={14} />}
                  </button>
                  <button
                    onClick={() => setRound((r) => Math.min(totalRounds - 1, r + 1))}
                    className="p-1.5 rounded hover:bg-surface-2 transition-colors"
                    aria-label="next"
                  >
                    <ChevronRight size={14} />
                  </button>
                  <button
                    onClick={() => { setRound(0); setPlaying(false); }}
                    className="p-1.5 rounded hover:bg-surface-2 transition-colors"
                    aria-label="reset"
                  >
                    <RotateCcw size={14} />
                  </button>
                </div>
              </div>

              <div className="divide-y divide-border">
                {scenario.rounds[round].actions.map((action) => (
                  <BuyerRow
                    key={action.buyer}
                    action={action}
                    color={BUYER_COLORS[action.buyer] ?? "var(--foreground)"}
                  />
                ))}
              </div>

              {/* Seller response */}
              <div className="bg-surface-2/40 border-t border-border px-5 py-4">
                <div className="text-eyebrow mb-2">Seller</div>
                <div className="text-foreground text-sm italic">
                  {scenario.rounds[round].seller_message}
                </div>
              </div>
            </div>

            {/* Outcome reveal */}
            {isFinal && (
              <div className="rounded-xl border border-accent/30 bg-accent/5 p-6 animate-fade-up">
                <div className="flex items-center gap-3 mb-4">
                  <Trophy size={18} className="text-accent" />
                  <div className="text-eyebrow" style={{ color: "var(--accent)" }}>
                    Outcome
                  </div>
                </div>
                <div className="text-h2 mb-3">
                  {labelForBuyer(scenario, scenario.outcome.winner)} won at $
                  {scenario.outcome.price.toLocaleString()}
                </div>
                <p className="text-fg2 leading-relaxed text-sm">
                  {scenario.outcome.comment}
                </p>
              </div>
            )}
          </div>

          {/* Right column: per-buyer trace */}
          <div className="space-y-5">
            <div className="rounded-xl border border-border bg-surface p-5">
              <div className="text-eyebrow mb-4">Per-buyer trace</div>
              <div className="space-y-3">
                {buyerLines.map((line) => {
                  const cur = line.segs[round];
                  const isOutOfGame = round > line.finalRound;
                  const priceLabel = isOutOfGame
                    ? line.finalAction === "accept"
                      ? "accepted"
                      : line.finalAction === "walk"
                      ? "walked"
                      : "—"
                    : cur?.price !== null && cur?.price !== undefined
                    ? `$${cur.price}`
                    : cur?.action === "accept"
                    ? "accepted"
                    : cur?.action === "walk"
                    ? "walked"
                    : "—";
                  return (
                    <div key={line.id}>
                      <div className="flex items-center justify-between mb-1.5 text-xs">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2 h-2 rounded-full"
                            style={{ background: line.color }}
                          />
                          <span className="text-foreground">{line.label}</span>
                        </div>
                        <span
                          className={`font-mono tabular-nums ${
                            isOutOfGame
                              ? line.finalAction === "accept"
                                ? "text-bad"
                                : "text-fg3"
                              : "text-fg2"
                          }`}
                        >
                          {priceLabel}
                        </span>
                      </div>
                      <div className="flex gap-1">
                        {line.segs.map((s, i) => {
                          const past = i < round;
                          const live = i === round;
                          const future = i > round;
                          const after = i > line.finalRound;
                          // Three visual states:
                          //   - past, in-lifecycle: full color, dim
                          //   - live, in-lifecycle: full color
                          //   - future, in-lifecycle: low opacity color (will play)
                          //   - after lifecycle ended (accept/walk): grey, faint
                          const dim = past ? "opacity-50" : live ? "" : future ? "opacity-25" : "";
                          const bg = after
                            ? "var(--fg4)"
                            : s.price === null
                            ? s.action === "walk"
                              ? "var(--bad)"
                              : s.action === "accept"
                              ? "var(--bad)"
                              : "var(--fg4)"
                            : line.color;
                          // Render a thin "X" mark on the segment where the
                          // buyer accepted/walked so the lifecycle is legible.
                          const isExitSeg = i === line.finalRound && line.finalAction !== null;
                          return (
                            <div
                              key={i}
                              className={`flex-1 h-1 rounded-full transition-colors ${dim} ${
                                isExitSeg ? "ring-1 ring-bad" : ""
                              }`}
                              style={{ background: bg }}
                              title={
                                after
                                  ? `out: ${line.finalAction}`
                                  : s.action === "accept"
                                  ? `accepted at $${s.price ?? "?"}`
                                  : s.action === "walk"
                                  ? "walked"
                                  : s.price !== null
                                  ? `offer $${s.price}`
                                  : ""
                              }
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface p-5">
              <div className="text-eyebrow mb-3">About this view</div>
              <p className="text-fg2 text-sm leading-relaxed">
                These transcripts are pre-computed snapshots showing how
                different buyer policies behave under the same conditions. Live
                multi-agent runs are out-of-scope for the venue (VRAM constraints) —
                the offline simulation captures the same dynamics.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BuyerRow({ action, color }: { action: BuyerAction; color: string }) {
  const tone =
    action.action === "accept"
      ? "text-good"
      : action.action === "walk"
      ? "text-bad"
      : "text-foreground";

  return (
    <div className="flex items-start gap-4 px-5 py-4">
      <div
        className="w-2 h-2 rounded-full mt-2 shrink-0"
        style={{ background: color }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <div className="text-foreground text-sm font-medium">{action.label}</div>
          <div className="flex items-center gap-3 text-sm font-mono tabular-nums">
            <span className={`uppercase tracking-wider text-[11px] ${tone}`}>
              {action.action}
            </span>
            {action.price !== null && (
              <span className="text-foreground">${action.price.toLocaleString()}</span>
            )}
          </div>
        </div>
        <div className="text-fg2 text-sm italic leading-relaxed">{action.message}</div>
      </div>
    </div>
  );
}

function labelForBuyer(scenario: ArenaScenario, buyerId: string): string {
  for (const r of scenario.rounds) {
    const found = r.actions.find((a) => a.buyer === buyerId);
    if (found) return found.label;
  }
  return buyerId;
}

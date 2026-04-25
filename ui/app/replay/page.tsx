"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  apiGet,
  apiPost,
  type CounterfactualResult,
  type EnvironmentState,
} from "../lib/api";
import { NegotiationChart } from "../components/NegotiationChart";
import { TellsDisplay } from "../components/TellsDisplay";
import { ReplayControls } from "../components/ReplayControls";
import { Play, Star } from "lucide-react";

/* ── Curated highlights ────────────────────────────────── */
const highlights = [
  {
    id: "amazon-best",
    title: "Crompton Geyser — ₹7,299 → ₹2,645",
    task: "amazon_realistic",
    surplus: 0.974,
    rounds: 8,
    badge: "Best Surplus",
    badgeColor: "bg-green-500/15 text-green-400",
  },
  {
    id: "tells-deceptive",
    title: "Silk Scarf — Bluff called",
    task: "read_the_tells",
    surplus: 0.483,
    rounds: 2,
    badge: "Deceptive Seller",
    badgeColor: "bg-red-500/15 text-red-400",
  },
  {
    id: "career-grind",
    title: "Silk Scarf — 8-round patience play",
    task: "career_10",
    surplus: 0.979,
    rounds: 8,
    badge: "Long Haggle",
    badgeColor: "bg-purple-500/15 text-purple-400",
  },
];

export default function ReplayPage() {
  const [state, setState] = useState<EnvironmentState | null>(null);
  const [replayStep, setReplayStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cfResult, setCfResult] = useState<CounterfactualResult | null>(null);
  const [cfRound, setCfRound] = useState<number>(1);
  const [cfAction, setCfAction] = useState<string>("offer");
  const [cfPrice, setCfPrice] = useState<number>(40);
  const playTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadState = useCallback(async () => {
    try {
      const s = await apiGet<EnvironmentState>("/state");
      setState(s);
      setReplayStep(s.offer_history.length);
      setError(null);
    } catch {
      setError("No active session. Start a negotiation first, or watch a curated replay below.");
    }
  }, []);

  useEffect(() => {
    loadState();
  }, [loadState]);

  const totalSteps = state?.offer_history.length ?? 0;
  const visibleHistory = state?.offer_history.slice(0, replayStep + 1) ?? [];
  const currentRound =
    visibleHistory.length > 0 ? visibleHistory[visibleHistory.length - 1].round : 0;

  const play = useCallback(() => {
    setIsPlaying(true);
    playTimerRef.current = setInterval(() => {
      setReplayStep((s) => {
        if (s >= totalSteps - 1) {
          setIsPlaying(false);
          if (playTimerRef.current) clearInterval(playTimerRef.current);
          return s;
        }
        return s + 1;
      });
    }, 800);
  }, [totalSteps]);

  const pause = useCallback(() => {
    setIsPlaying(false);
    if (playTimerRef.current) clearInterval(playTimerRef.current);
  }, []);

  useEffect(() => {
    return () => {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
    };
  }, []);

  const runCounterfactual = async () => {
    if (!state) return;
    try {
      const res = await apiPost<CounterfactualResult>("/counterfactual", {
        from_round: cfRound,
        alternative_action: cfAction,
        alternative_price: cfAction === "offer" ? cfPrice : null,
      });
      setCfResult(res);
    } catch (e) {
      setError(`Counterfactual error: ${e}`);
    }
  };

  const currentTell = state?.tells_history[Math.max(0, replayStep - 1)] ?? null;
  const dealEntry = state?.offer_history.find((h) => h.action === "accept");
  const dealPrice = dealEntry?.price ?? null;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Replay & Analysis</h1>
          <p className="text-sm text-foreground/50">
            Review past negotiations turn-by-turn, or watch curated highlights.
          </p>
        </div>
        <button
          onClick={loadState}
          className="px-3 py-1.5 bg-surface border border-border rounded-lg text-sm hover:bg-surface-2"
        >
          Refresh State
        </button>
      </div>

      {/* ═══ Curated Highlights ═══ */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-foreground/60 mb-3 flex items-center gap-1.5">
          <Star size={14} className="text-warning" /> Curated Highlights
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {highlights.map((h) => (
            <Link
              key={h.id}
              href={`/replay/${h.id}`}
              className="group p-4 rounded-xl bg-surface border border-border hover:border-accent/20 transition-all"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${h.badgeColor}`}>
                  {h.badge}
                </span>
              </div>
              <h3 className="font-medium text-sm mb-1 group-hover:text-accent transition-colors">{h.title}</h3>
              <div className="flex gap-3 text-xs text-foreground/40">
                <span>{h.rounds} rounds</span>
                <span className="font-mono text-accent">{(h.surplus * 100).toFixed(1)}%</span>
              </div>
              <div className="mt-3 flex items-center gap-1 text-xs text-accent opacity-0 group-hover:opacity-100 transition-opacity">
                <Play size={10} /> Watch replay
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* ═══ Live replay from session ═══ */}
      {error && !state && (
        <div className="p-4 rounded-xl bg-surface border border-border text-sm mb-4 space-y-3">
          <p className="text-foreground/60">{error}</p>
          <div className="flex gap-3">
            <Link
              href="/negotiate"
              className="px-3 py-1.5 bg-accent text-background rounded-lg text-sm font-medium hover:bg-accent/90"
            >
              Play as Buyer
            </Link>
            <Link
              href="/spectate"
              className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700"
            >
              Watch AI Play
            </Link>
            <button
              onClick={async () => {
                try {
                  setError(null);
                  await apiPost("/simulate", { task: "single_deal", strategy: "smart", seed: 42 });
                  await loadState();
                } catch (e) {
                  setError(`Failed: ${e}`);
                }
              }}
              className="px-3 py-1.5 bg-surface-2 border border-border rounded-lg text-sm hover:bg-border"
            >
              Quick Simulate & Load
            </button>
          </div>
        </div>
      )}

      {state && (
        <>
          {/* Info bar */}
          <div className="grid grid-cols-5 gap-3 mb-4">
            {[
              { label: "Task", value: state.task_name },
              { label: "Personality", value: state.seller_personality },
              { label: "Episode", value: `${state.episode} / ${state.total_episodes}` },
              { label: "Status", value: state.done ? "Done" : "In progress" },
              { label: "Reward", value: state.cumulative_reward.toFixed(3) },
            ].map((m) => (
              <div key={m.label} className="p-3 rounded-lg bg-surface border border-border">
                <div className="text-xs text-foreground/50">{m.label}</div>
                <div className="text-sm font-semibold">{m.value}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Chart + Replay */}
            <div className="lg:col-span-2 space-y-4">
              <div className="rounded-xl bg-surface border border-border p-4">
                <NegotiationChart
                  history={visibleHistory}
                  budget={state.buyer_budget}
                  cost={state.seller_cost}
                  dealPrice={replayStep >= totalSteps - 1 ? dealPrice : null}
                  activeRound={currentRound}
                />
              </div>

              <ReplayControls
                currentStep={replayStep}
                totalSteps={totalSteps - 1}
                isPlaying={isPlaying}
                onPlay={play}
                onPause={pause}
                onStepForward={() => setReplayStep((s) => Math.min(s + 1, totalSteps - 1))}
                onStepBack={() => setReplayStep((s) => Math.max(s - 1, 0))}
                onReset={() => { setReplayStep(0); pause(); }}
                onSeek={setReplayStep}
              />

              {/* Step detail */}
              <div className="rounded-xl bg-surface border border-border p-4">
                <h3 className="text-sm font-medium mb-2">Step Detail</h3>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {visibleHistory.map((entry, i) => (
                    <div
                      key={i}
                      className={`text-sm py-1 px-2 rounded ${
                        i === replayStep ? "bg-accent/10 border border-accent/20" : ""
                      } ${entry.actor === "buyer" ? "text-accent" : "text-foreground/70"}`}
                    >
                      <span className="text-xs text-foreground/30 mr-2">R{entry.round}</span>
                      <span className="font-medium">{entry.actor}</span> {entry.action}
                      {entry.price != null && (
                        <span className="font-mono ml-1">@ {entry.price.toFixed(0)}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Counterfactual */}
              <div className="rounded-xl bg-surface border border-border p-4">
                <h3 className="text-sm font-medium mb-3">What-If Analysis</h3>
                <div className="flex flex-wrap items-end gap-3 mb-3">
                  <div>
                    <label className="block text-xs text-foreground/50 mb-1">From Round</label>
                    <input
                      type="number"
                      min={1}
                      max={state.current_round}
                      value={cfRound}
                      onChange={(e) => setCfRound(Number(e.target.value))}
                      className="w-20 bg-surface-2 border border-border rounded px-2 py-1 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-foreground/50 mb-1">Action</label>
                    <select
                      value={cfAction}
                      onChange={(e) => setCfAction(e.target.value)}
                      className="bg-surface-2 border border-border rounded px-2 py-1 text-sm"
                    >
                      <option value="offer">Offer</option>
                      <option value="accept">Accept</option>
                      <option value="walk">Walk</option>
                    </select>
                  </div>
                  {cfAction === "offer" && (
                    <div>
                      <label className="block text-xs text-foreground/50 mb-1">Price</label>
                      <input
                        type="number"
                        value={cfPrice}
                        onChange={(e) => setCfPrice(Number(e.target.value))}
                        className="w-20 bg-surface-2 border border-border rounded px-2 py-1 text-sm"
                      />
                    </div>
                  )}
                  <button
                    onClick={runCounterfactual}
                    className="px-3 py-1.5 bg-purple-600 text-white rounded text-sm hover:bg-purple-700"
                  >
                    Run What-If
                  </button>
                </div>

                {cfResult && (
                  <div className="animate-fade-in space-y-2">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 rounded bg-surface-2 border border-border">
                        <div className="text-xs text-foreground/50">Original</div>
                        <div className="font-mono text-sm">
                          {cfResult.original_outcome} @ {cfResult.original_price?.toFixed(0) ?? "-"}
                        </div>
                        <div className="text-xs text-foreground/50">
                          Score: {cfResult.original_score.toFixed(4)}
                        </div>
                      </div>
                      <div className="p-3 rounded bg-purple-500/10 border border-purple-500/20">
                        <div className="text-xs text-purple-400">Counterfactual</div>
                        <div className="font-mono text-sm">
                          {cfResult.counterfactual_outcome} @ {cfResult.counterfactual_price?.toFixed(0) ?? "-"}
                        </div>
                        <div className="text-xs text-purple-400">
                          Score: {cfResult.counterfactual_score.toFixed(4)}
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-foreground/50">
                      Diverged at round {cfResult.divergence_round}.{" "}
                      {cfResult.counterfactual_score > cfResult.original_score
                        ? "Alternative was BETTER"
                        : cfResult.counterfactual_score < cfResult.original_score
                        ? "Original was BETTER"
                        : "Same outcome"}{" "}
                      (delta: {(cfResult.counterfactual_score - cfResult.original_score).toFixed(4)})
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Tells */}
            <div className="space-y-4">
              <TellsDisplay tells={currentTell} personality={state.seller_personality} />
              {state.tells_history.length > 0 && (
                <div className="rounded-xl bg-surface border border-border p-4">
                  <h3 className="text-sm font-medium mb-2">Tell Trends</h3>
                  <div className="space-y-1">
                    {state.tells_history.slice(0, replayStep).map((t, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="w-8 text-foreground/40">R{i + 1}</span>
                        <div className="flex-1 flex gap-1">
                          <div
                            className="h-2 bg-danger rounded"
                            style={{ width: `${t.verbal_urgency * 100}%` }}
                            title={`urgency: ${(t.verbal_urgency * 100).toFixed(0)}%`}
                          />
                        </div>
                        <div className="flex-1 flex gap-1">
                          <div
                            className="h-2 bg-warning rounded"
                            style={{ width: `${t.verbal_deception_cue * 100}%` }}
                            title={`deception: ${(t.verbal_deception_cue * 100).toFixed(0)}%`}
                          />
                        </div>
                        <div className="flex-1 flex gap-1">
                          <div
                            className="h-2 bg-accent rounded"
                            style={{ width: `${t.fidget_level * 100}%` }}
                            title={`fidget: ${(t.fidget_level * 100).toFixed(0)}%`}
                          />
                        </div>
                      </div>
                    ))}
                    <div className="flex gap-4 text-xs text-foreground/40 mt-1">
                      <span className="text-danger">urgency</span>
                      <span className="text-warning">deception</span>
                      <span className="text-accent">fidget</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

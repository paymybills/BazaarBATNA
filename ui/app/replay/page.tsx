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
import { Play, RotateCw } from "lucide-react";

const highlights = [
  {
    id: "amazon-best",
    title: "Amazon best haggle",
    sub: "₹7,299 → ₹2,645",
    surplus: 0.974,
    rounds: 8,
    badge: "97% surplus",
  },
  {
    id: "tells-deceptive",
    title: "Read-the-tells win",
    sub: "Deception flagged in turn 1",
    surplus: 0.483,
    rounds: 2,
    badge: "tell extracted",
  },
  {
    id: "career-grind",
    title: "Career-mode grind",
    sub: "8 rounds, sustained pressure",
    surplus: 0.979,
    rounds: 8,
    badge: "long haggle",
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
      setReplayStep(s?.offer_history?.length ?? 0);
      setError(null);
    } catch {
      setError("No active session. Run a simulation or play a round first.");
    }
  }, []);

  useEffect(() => {
    loadState();
  }, [loadState]);

  const totalSteps = state?.offer_history?.length ?? 0;
  const visibleHistory = state?.offer_history?.slice(0, replayStep + 1) ?? [];
  const currentRound =
    visibleHistory.length > 0
      ? visibleHistory[visibleHistory.length - 1].round
      : 0;

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
      setError(`Counterfactual failed: ${e}`);
    }
  };

  const currentTell = state?.tells_history?.[Math.max(0, replayStep - 1)] ?? null;
  const dealEntry = state?.offer_history?.find((h) => h.action === "accept");
  const dealPrice = dealEntry?.price ?? null;

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-baseline justify-between gap-4 mb-10">
        <div>
          <h1 className="text-h1 mb-2">Replay</h1>
          <p className="text-meta">
            Scrub through past episodes. Branch into counterfactuals.
          </p>
        </div>
        <button
          onClick={loadState}
          className="inline-flex items-center gap-2 rounded-md border border-border-2 px-4 py-2 text-sm hover:border-foreground/40 transition-colors"
        >
          <RotateCw size={14} /> Refresh
        </button>
      </div>

      {/* Highlights */}
      <section className="mb-12">
        <div className="text-eyebrow mb-5">Highlights</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {highlights.map((h) => (
            <Link
              key={h.id}
              href={`/replay/${h.id}`}
              className="group rounded-xl border border-border bg-surface p-5 card-hover"
            >
              <div className="flex items-center justify-between mb-4">
                <span
                  className="text-eyebrow"
                  style={{ color: "var(--accent)", opacity: 0.85 }}
                >
                  {h.badge}
                </span>
                <span className="text-meta tabular-nums">{h.rounds} rds</span>
              </div>
              <h3 className="text-foreground text-base font-medium leading-snug mb-1.5">
                {h.title}
              </h3>
              <div className="text-fg2 text-sm font-mono">{h.sub}</div>
              <div className="flex items-center gap-2 mt-5 text-fg2 text-sm group-hover:text-foreground transition-colors">
                <Play size={12} /> Watch
              </div>
            </Link>
          ))}
        </div>
      </section>

      {!state && error && (
        <div className="rounded-xl border border-border bg-surface p-10 text-center">
          <p className="text-fg2 text-sm mb-6">{error}</p>
          <div className="flex flex-col sm:flex-row justify-center gap-3">
            <Link
              href="/sell"
              className="inline-flex items-center justify-center rounded-md bg-accent text-background px-5 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Start a session
            </Link>
            <button
              onClick={async () => {
                setError(null);
                await apiPost("/simulate", { task: "single_deal", strategy: "smart", seed: 42 });
                await loadState();
              }}
              className="inline-flex items-center justify-center rounded-md border border-border-2 px-5 py-2.5 text-sm hover:border-foreground/40 transition-colors"
            >
              Run a quick demo simulation
            </button>
          </div>
        </div>
      )}

      {state && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-5">
            {/* Metadata strip */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              <Stat label="Task" value={state.task_name} />
              <Stat label="Persona" value={state.seller_personality || "default"} />
              <Stat label="Episode" value={state.episode.toString()} mono />
              <Stat label="Status" value={state.done ? "closed" : "active"} />
              <Stat label="Reward" value={state.cumulative_reward.toFixed(3)} mono />
            </div>

            {/* Chart */}
            <div className="rounded-xl border border-border bg-surface p-6">
              <NegotiationChart
                history={visibleHistory}
                budget={state.buyer_budget}
                cost={state.seller_cost}
                dealPrice={replayStep >= totalSteps - 1 ? dealPrice : null}
                activeRound={currentRound}
              />
            </div>

            {/* Replay controls */}
            <div className="rounded-xl border border-border bg-surface p-4">
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
            </div>

            {/* Trace detail */}
            <div className="rounded-xl border border-border bg-surface overflow-hidden">
              <div className="px-5 py-3 border-b border-border">
                <div className="text-eyebrow">Trace</div>
              </div>
              <div className="p-4 max-h-72 overflow-y-auto space-y-1.5 font-mono">
                {visibleHistory.map((entry, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-4 text-xs py-1.5 px-2 rounded transition-colors ${
                      i === replayStep
                        ? "bg-accent/10 text-foreground"
                        : "text-fg3"
                    }`}
                  >
                    <span className="w-12 tabular-nums shrink-0">[{String(entry.round).padStart(2, "0")}]</span>
                    <span className="w-16 shrink-0">{entry.actor}</span>
                    <span className="flex-1">{entry.action}</span>
                    {entry.price != null && (
                      <span className="w-20 text-right tabular-nums">₹{entry.price.toFixed(0)}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Counterfactual */}
            <div className="rounded-xl border border-border bg-surface p-6">
              <div className="flex items-baseline justify-between mb-5">
                <div>
                  <div className="text-eyebrow mb-1">Counterfactual</div>
                  <h3 className="text-h2">What if?</h3>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-4 mb-5">
                <div>
                  <label className="text-eyebrow block mb-2">From round</label>
                  <input
                    type="number"
                    min={1}
                    max={state.current_round}
                    value={cfRound}
                    onChange={(e) => setCfRound(Number(e.target.value))}
                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono focus:border-accent outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="text-eyebrow block mb-2">Alt action</label>
                  <select
                    value={cfAction}
                    onChange={(e) => setCfAction(e.target.value)}
                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:border-accent outline-none transition-colors"
                  >
                    <option value="offer">offer</option>
                    <option value="accept">accept</option>
                    <option value="walk">walk</option>
                  </select>
                </div>
                {cfAction === "offer" && (
                  <div>
                    <label className="text-eyebrow block mb-2">Alt price</label>
                    <input
                      type="number"
                      value={cfPrice}
                      onChange={(e) => setCfPrice(Number(e.target.value))}
                      className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono focus:border-accent outline-none transition-colors"
                    />
                  </div>
                )}
                <div className="flex items-end">
                  <button
                    onClick={runCounterfactual}
                    className="w-full rounded-md bg-accent text-background px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
                  >
                    Run
                  </button>
                </div>
              </div>

              {cfResult && (
                <div className="rounded-lg border border-border overflow-hidden">
                  <div className="grid grid-cols-1 md:grid-cols-2">
                    <div className="p-5 border-b md:border-b-0 md:border-r border-border bg-background">
                      <div className="text-eyebrow mb-2">Original</div>
                      <div className="text-xl font-mono mb-1">
                        {cfResult.original_outcome} · ₹{cfResult.original_price?.toFixed(0) ?? "—"}
                      </div>
                      <div className="text-meta">score {cfResult.original_score.toFixed(3)}</div>
                    </div>
                    <div className="p-5 bg-accent/10">
                      <div className="text-eyebrow mb-2" style={{ color: "var(--accent)" }}>
                        Counterfactual
                      </div>
                      <div className="text-xl font-mono mb-1">
                        {cfResult.counterfactual_outcome} · ₹{cfResult.counterfactual_price?.toFixed(0) ?? "—"}
                      </div>
                      <div className="text-meta">score {cfResult.counterfactual_score.toFixed(3)}</div>
                    </div>
                  </div>
                  <div className="px-5 py-3 bg-surface-2/40 border-t border-border text-xs text-fg3 text-center">
                    Δ score{" "}
                    <span className="font-mono text-foreground tabular-nums">
                      {(cfResult.counterfactual_score - cfResult.original_score).toFixed(3)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right column */}
          <div className="space-y-5">
            <TellsDisplay tells={currentTell} personality={state.seller_personality} />
            {state.tells_history.length > 0 && (
              <div className="rounded-xl border border-border bg-surface p-5">
                <div className="text-eyebrow mb-4">Signal variance</div>
                <div className="space-y-2">
                  {state.tells_history.slice(0, replayStep).map((t, i) => (
                    <div key={i} className="flex items-center gap-3 text-[10px] font-mono text-fg3">
                      <span className="w-8 tabular-nums shrink-0">r{String(i + 1).padStart(2, "0")}</span>
                      <Bar value={t.verbal_urgency} color="var(--accent)" />
                      <Bar value={t.verbal_deception_cue} color="var(--bad)" />
                      <Bar value={t.fidget_level} color="var(--accent-2)" />
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-3 border-t border-border flex justify-between text-[9px] text-fg3 font-mono uppercase tracking-wider">
                  <span>urgency</span>
                  <span>deception</span>
                  <span>fidget</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <div className="text-eyebrow mb-1">{label}</div>
      <div className={`text-sm ${mono ? "font-mono tabular-nums" : "capitalize"} text-foreground`}>
        {value}
      </div>
    </div>
  );
}

function Bar({ value, color }: { value: number; color: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="flex-1 h-1 bg-surface-2 rounded-full overflow-hidden">
      <div className="h-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

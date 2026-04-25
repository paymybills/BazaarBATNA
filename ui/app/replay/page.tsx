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
import { Play } from "lucide-react";

/* ── Curated highlights (Lib) ── */
const highlights = [
  {
    id: "amazon-best",
    title: "Amazon Realistic Trace",
    task: "7,299 → 2,645",
    surplus: 0.974,
    rounds: 8,
    badge: "97.4% Surplus",
  },
  {
    id: "tells-deceptive",
    title: "Deception Analysis",
    task: "Bluff Verification",
    surplus: 0.483,
    rounds: 2,
    badge: "Tell Extracted",
  },
  {
    id: "career-grind",
    title: "Long-form Negotiation",
    task: "Stamina Play",
    surplus: 0.979,
    rounds: 8,
    badge: "8-Round Grind",
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
      setError("No active session detected. Simulation or Live session required.");
    }
  }, []);

  useEffect(() => {
    loadState();
  }, [loadState]);

  const totalSteps = state?.offer_history.length ?? 0;
  const visibleHistory = state?.offer_history.slice(0, replayStep + 1) ?? [];
  const currentRound = visibleHistory.length > 0 ? visibleHistory[visibleHistory.length - 1].round : 0;

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
      setError(`Counterfactual failure: ${e}`);
    }
  };

  const currentTell = state?.tells_history[Math.max(0, replayStep - 1)] ?? null;
  const dealEntry = state?.offer_history.find((h) => h.action === "accept");
  const dealPrice = dealEntry?.price ?? null;

  return (
    <div className="max-w-6xl mx-auto px-4 py-16 selection:bg-foreground selection:text-background font-sans">
      <div className="flex flex-col md:flex-row items-baseline justify-between gap-6 mb-12 border-b border-border pb-8">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-tighter mb-2 italic">Analysis.v1</h1>
          <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-foreground/30">
            Replay Buffer // Bayesian Divergence Tracking
          </p>
        </div>
        <button
          onClick={loadState}
          className="px-6 py-2 border border-border text-[10px] uppercase tracking-widest font-black hover:bg-foreground hover:text-background transition-all"
        >
          Resync State
        </button>
      </div>

      {/* Highlights */}
      <section className="mb-20">
        <h2 className="text-[11px] uppercase tracking-[0.4em] font-black italic mb-6 opacity-30 underline decoration-1 underline-offset-4">Highlights.lib</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {highlights.map((h) => (
            <Link
              key={h.id}
              href={`/replay/${h.id}`}
              className="group border-t border-border pt-6 transition-all"
            >
              <div className="mb-4">
                <span className="text-[9px] uppercase tracking-widest border border-border px-2 py-0.5 text-foreground/40 group-hover:border-foreground group-hover:text-foreground transition-colors">
                  {h.badge}
                </span>
              </div>
              <h3 className="font-black text-sm uppercase tracking-tight mb-1">{h.title}</h3>
              <div className="flex gap-4 text-[10px] font-mono tracking-tighter text-foreground/30">
                <span>{h.rounds} ROUNDS</span>
                <span>{h.task}</span>
              </div>
              <div className="mt-6 flex items-center gap-2 text-[9px] uppercase tracking-[0.3em] font-black opacity-0 group-hover:opacity-100 transition-all">
                <Play size={10} strokeWidth={3} /> Watch replay
              </div>
            </Link>
          ))}
        </div>
      </section>

      {!state && error && (
        <div className="p-12 border border-border bg-surface text-center">
          <p className="text-[11px] uppercase tracking-[0.2em] text-foreground/40 mb-8">{error}</p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <Link
              href="/sell"
              className="px-8 py-3 bg-foreground text-background font-black text-[10px] uppercase tracking-widest hover:invert transition-all"
            >
              Start Session
            </Link>
            <button
              onClick={async () => {
                setError(null);
                await apiPost("/simulate", { task: "single_deal", strategy: "smart", seed: 42 });
                await loadState();
              }}
              className="px-8 py-3 border border-border text-foreground font-black text-[10px] uppercase tracking-widest hover:bg-foreground hover:text-background transition-all"
            >
              Inject Buffer
            </button>
          </div>
        </div>
      )}

      {state && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          <div className="lg:col-span-3 space-y-8">
            {/* Metadata */}
            <div className="grid grid-cols-5 gap-px bg-border border border-border">
              {[
                { label: "Protocol", value: state.task_name },
                { label: "Personality", value: state.seller_personality },
                { label: "Episode ID", value: state.episode },
                { label: "Status", value: state.done ? "Closed" : "Active" },
                { label: "Reward", value: state.cumulative_reward.toFixed(3) },
              ].map((m) => (
                <div key={m.label} className="bg-background p-4 text-center">
                  <div className="text-[9px] uppercase tracking-widest text-foreground/30 mb-2">{m.label}</div>
                  <div className="text-xs font-mono font-black">{m.value}</div>
                </div>
              ))}
            </div>

            {/* Visualizer */}
            <div className="border border-border p-8 bg-surface">
              <NegotiationChart
                history={visibleHistory}
                budget={state.buyer_budget}
                cost={state.seller_cost}
                dealPrice={replayStep >= totalSteps - 1 ? dealPrice : null}
                activeRound={currentRound}
              />
            </div>

            <div className="p-4 border border-border bg-background">
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
            <div className="border border-border bg-surface">
              <h3 className="text-[10px] uppercase tracking-[0.2em] font-black p-6 border-b border-border">Sequential Trace</h3>
              <div className="p-6 space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
                {visibleHistory.map((entry, i) => (
                  <div
                    key={i}
                    className={`flex items-baseline gap-6 text-[11px] font-mono py-1 border-b border-white/5 last:border-0 ${
                      i === replayStep ? "text-foreground font-black opacity-100" : "text-foreground/30"
                    }`}
                  >
                    <span className="w-12 shrink-0 italic opacity-20">[{String(entry.round).padStart(2, '0')}]</span>
                    <span className="w-20 shrink-0 uppercase tracking-widest font-black">{entry.actor}</span>
                    <span className="flex-1 italic">{entry.action}</span>
                    {entry.price != null && (
                      <span className="w-20 text-right font-black">₹{entry.price.toFixed(0)}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* What-If */}
            <div className="border border-border p-8 bg-surface">
              <h3 className="text-xs font-black uppercase tracking-[0.2em] mb-8 italic underline underline-offset-4">Divergence Analysis</h3>
              <div className="flex flex-wrap items-end gap-8 mb-12">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-foreground/40 mb-3 font-bold">Origin Round</label>
                  <input
                    type="number"
                    min={1}
                    max={state.current_round}
                    value={cfRound}
                    onChange={(e) => setCfRound(Number(e.target.value))}
                    className="w-24 bg-background border border-border px-3 py-2 text-sm font-mono outline-none focus:border-foreground"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-foreground/40 mb-3 font-bold">Alternative Action</label>
                  <select
                    value={cfAction}
                    onChange={(e) => setCfAction(e.target.value)}
                    className="bg-background border border-border px-3 py-2 text-sm font-mono outline-none focus:border-foreground uppercase tracking-tighter"
                  >
                    <option value="offer">Offer</option>
                    <option value="accept">Accept</option>
                    <option value="walk">Walk</option>
                  </select>
                </div>
                {cfAction === "offer" && (
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-foreground/40 mb-3 font-bold">Synthetic Price</label>
                    <input
                      type="number"
                      value={cfPrice}
                      onChange={(e) => setCfPrice(Number(e.target.value))}
                      className="w-24 bg-background border border-border px-3 py-2 text-sm font-mono outline-none focus:border-foreground"
                    />
                  </div>
                )}
                <button
                  onClick={runCounterfactual}
                  className="px-8 py-2 bg-foreground text-background text-[11px] uppercase tracking-[0.2em] font-black hover:invert transition-all"
                >
                  Process Divergence
                </button>
              </div>

              {cfResult && (
                <div className="border border-border overflow-hidden">
                  <div className="grid grid-cols-1 md:grid-cols-2">
                    <div className="p-6 border-r border-border bg-background">
                      <div className="text-[9px] uppercase tracking-widest text-foreground/40 mb-4 font-bold">Baseline</div>
                      <div className="text-xl font-black italic opacity-30 uppercase tracking-tighter mb-2">
                        {cfResult.original_outcome} @ ₹{cfResult.original_price?.toFixed(0) ?? "-"}
                      </div>
                      <div className="text-[10px] font-mono text-foreground/20 italic">Score: {cfResult.original_score.toFixed(4)}</div>
                    </div>
                    <div className="p-6 bg-foreground text-background">
                      <div className="text-[9px] uppercase tracking-widest opacity-60 mb-4 font-bold">Counterfactual</div>
                      <div className="text-xl font-black italic uppercase tracking-tighter mb-2">
                        {cfResult.counterfactual_outcome} @ ₹{cfResult.counterfactual_price?.toFixed(0) ?? "-"}
                      </div>
                      <div className="text-[10px] font-mono opacity-60 italic">Score: {cfResult.counterfactual_score.toFixed(4)}</div>
                    </div>
                  </div>
                  <div className="px-6 py-4 bg-background border-t border-border text-[10px] text-foreground/30 uppercase tracking-widest text-center">
                    Delta Detected: <span className="font-mono text-foreground">{(cfResult.counterfactual_score - cfResult.original_score).toFixed(4)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-8">
            <TellsDisplay tells={currentTell} personality={state.seller_personality} />
            {state.tells_history.length > 0 && (
              <div className="border border-border p-6 bg-surface">
                <h3 className="text-[10px] uppercase tracking-[0.2em] font-black mb-6">Signal Variance</h3>
                <div className="space-y-3">
                  {state.tells_history.slice(0, replayStep).map((t, i) => (
                    <div key={i} className="flex items-center gap-3 text-[9px] font-mono text-foreground/30">
                      <span className="w-8 shrink-0">R{String(i + 1).padStart(2, '0')}</span>
                      <div className="flex-1 h-[1px] bg-white/5 overflow-hidden">
                        <div className="h-full bg-foreground opacity-20" style={{ width: `${t.verbal_urgency * 100}%` }} />
                      </div>
                      <div className="flex-1 h-[1px] bg-white/5 overflow-hidden">
                        <div className="h-full bg-foreground opacity-40" style={{ width: `${t.verbal_deception_cue * 100}%` }} />
                      </div>
                      <div className="flex-1 h-[1px] bg-white/5 overflow-hidden">
                        <div className="h-full bg-foreground opacity-80" style={{ width: `${t.fidget_level * 100}%` }} />
                      </div>
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

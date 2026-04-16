"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiPost, type TaskInfo, apiGet } from "../lib/api";
import { NegotiationChart } from "../components/NegotiationChart";
import { TellsDisplay } from "../components/TellsDisplay";
import { ReplayControls } from "../components/ReplayControls";

interface SimStep {
  round: number;
  episode: number;
  actor: string;
  action: string;
  price: number | null;
  buyer_offer?: number | null;
  seller_offer?: number | null;
  message: string;
  reward: number;
  done: boolean;
  outcome?: string | null;
  tells?: Record<string, unknown> | null;
  reward_components?: Record<string, number>;
}

interface SimResult {
  steps: SimStep[];
  score: number;
  task: string;
  strategy: string;
  personality: string;
  episodes: number;
}

export default function SpectatePage() {
  const [tasks, setTasks] = useState<Record<string, TaskInfo>>({});
  const [selectedTask, setSelectedTask] = useState("single_deal");
  const [strategy, setStrategy] = useState("smart");
  const [personality, setPersonality] = useState("");
  const [result, setResult] = useState<SimResult | null>(null);
  const [replayStep, setReplayStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    apiGet<Record<string, TaskInfo>>("/tasks").then(setTasks).catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const runSimulation = useCallback(async () => {
    setLoading(true);
    setResult(null);
    setReplayStep(0);
    setIsPlaying(false);
    if (timerRef.current) clearInterval(timerRef.current);

    try {
      const body: Record<string, unknown> = {
        task: selectedTask,
        strategy,
        seed: Math.floor(Math.random() * 10000),
      };
      if (personality) body.seller_personality = personality;

      const res = await apiPost<SimResult>("/simulate", body);
      setResult(res);
      // Auto-play
      setReplayStep(0);
      setIsPlaying(true);
      let step = 0;
      timerRef.current = setInterval(() => {
        step++;
        if (step >= res.steps.length - 1) {
          setIsPlaying(false);
          if (timerRef.current) clearInterval(timerRef.current);
        }
        setReplayStep(step);
      }, 1200);
    } catch (e) {
      alert(`Error: ${e}`);
    }
    setLoading(false);
  }, [selectedTask, strategy, personality]);

  const play = useCallback(() => {
    if (!result) return;
    setIsPlaying(true);
    let step = replayStep;
    timerRef.current = setInterval(() => {
      step++;
      if (step >= result.steps.length - 1) {
        setIsPlaying(false);
        if (timerRef.current) clearInterval(timerRef.current);
      }
      setReplayStep(step);
    }, 1200);
  }, [result, replayStep]);

  const pause = useCallback(() => {
    setIsPlaying(false);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  // Build chart history from visible steps
  const visibleSteps = result?.steps.slice(0, replayStep + 1) ?? [];
  const chartHistory = visibleSteps
    .filter((s) => s.price != null)
    .map((s) => ({
      round: s.round,
      actor: s.actor,
      action: s.action,
      price: s.price,
    }));

  const currentTell = visibleSteps.length > 0
    ? (visibleSteps[visibleSteps.length - 1].tells as Record<string, unknown> | null)
    : null;

  const dealStep = visibleSteps.find((s) => s.outcome === "deal");

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-2">Spectator Mode</h1>
      <p className="text-sm text-foreground/50 mb-6">
        Watch an AI agent negotiate against the seller in real-time.
        Choose strategy, personality, and observe.
      </p>

      {/* Config bar */}
      <div className="flex flex-wrap items-end gap-4 mb-6 p-4 rounded-xl bg-surface border border-border">
        <div>
          <label className="block text-xs text-foreground/50 mb-1">Task</label>
          <select
            value={selectedTask}
            onChange={(e) => setSelectedTask(e.target.value)}
            className="bg-surface-2 border border-border rounded px-3 py-1.5 text-sm"
          >
            {Object.entries(tasks).map(([name, t]) => (
              <option key={name} value={name}>
                {name} ({t.difficulty})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-foreground/50 mb-1">AI Strategy</label>
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
            className="bg-surface-2 border border-border rounded px-3 py-1.5 text-sm"
          >
            <option value="smart">Smart (Strategic)</option>
            <option value="naive">Naive (Capitulates)</option>
            <option value="aggressive">Aggressive (Lowballs)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-foreground/50 mb-1">Seller Personality</label>
          <select
            value={personality}
            onChange={(e) => setPersonality(e.target.value)}
            className="bg-surface-2 border border-border rounded px-3 py-1.5 text-sm"
          >
            <option value="">Task default</option>
            <option value="default">Default</option>
            <option value="deceptive">Deceptive</option>
            <option value="impatient">Impatient</option>
            <option value="collaborative">Collaborative</option>
          </select>
        </div>
        <button
          onClick={runSimulation}
          disabled={loading}
          className="px-5 py-1.5 bg-accent text-background rounded font-medium text-sm hover:bg-accent/90 disabled:opacity-50"
        >
          {loading ? "Running..." : "Run & Watch"}
        </button>
      </div>

      {!result ? (
        <div className="text-center py-20 text-foreground/40">
          Select a task and strategy, then click Run & Watch.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {/* Score */}
            <div className="grid grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-surface border border-border">
                <div className="text-xs text-foreground/50">Strategy</div>
                <div className="text-sm font-semibold">{result.strategy}</div>
              </div>
              <div className="p-3 rounded-lg bg-surface border border-border">
                <div className="text-xs text-foreground/50">Personality</div>
                <div className="text-sm font-semibold">{result.personality}</div>
              </div>
              <div className="p-3 rounded-lg bg-surface border border-border">
                <div className="text-xs text-foreground/50">Score</div>
                <div className={`text-lg font-mono font-semibold ${result.score >= 0.3 ? "text-green-400" : "text-danger"}`}>
                  {result.score.toFixed(4)}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-surface border border-border">
                <div className="text-xs text-foreground/50">Steps</div>
                <div className="text-lg font-mono font-semibold">{result.steps.length}</div>
              </div>
            </div>

            {/* Chart */}
            <div className="rounded-xl bg-surface border border-border p-4">
              <NegotiationChart
                history={chartHistory}
                budget={100}
                cost={30}
                dealPrice={dealStep?.price ?? null}
                activeRound={visibleSteps[visibleSteps.length - 1]?.round}
              />
            </div>

            {/* Replay controls */}
            <ReplayControls
              currentStep={replayStep}
              totalSteps={result.steps.length - 1}
              isPlaying={isPlaying}
              onPlay={play}
              onPause={pause}
              onStepForward={() => setReplayStep((s) => Math.min(s + 1, result.steps.length - 1))}
              onStepBack={() => setReplayStep((s) => Math.max(s - 1, 0))}
              onReset={() => { setReplayStep(0); pause(); }}
              onSeek={setReplayStep}
            />
          </div>

          {/* Right: Tells + Live log */}
          <div className="space-y-4">
            <TellsDisplay
              tells={currentTell as Parameters<typeof TellsDisplay>[0]["tells"]}
              personality={result.personality}
            />

            {/* Step-by-step log */}
            <div className="rounded-xl bg-surface border border-border">
              <div className="px-4 py-2 border-b border-border text-sm font-medium">
                Live Negotiation
              </div>
              <div className="p-3 max-h-80 overflow-y-auto space-y-1.5">
                {visibleSteps.map((step, i) => (
                  <div
                    key={i}
                    className={`text-sm animate-fade-in ${
                      step.actor === "buyer" ? "text-accent" : "text-foreground/70"
                    } ${i === replayStep ? "font-medium" : ""}`}
                  >
                    <span className="text-xs text-foreground/30 mr-2">R{step.round}</span>
                    <span className="font-medium">{step.actor}</span>{" "}
                    {step.action}
                    {step.price != null && (
                      <span className="font-mono ml-1">@ {step.price.toFixed(0)}</span>
                    )}
                    {step.reward !== 0 && (
                      <span className={`ml-2 text-xs ${step.reward > 0 ? "text-green-400" : "text-danger"}`}>
                        ({step.reward > 0 ? "+" : ""}{step.reward.toFixed(3)})
                      </span>
                    )}
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

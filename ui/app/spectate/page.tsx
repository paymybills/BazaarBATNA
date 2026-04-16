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
  reasoning?: string | null;
  reward: number;
  done: boolean;
  outcome?: string | null;
  tells?: Record<string, unknown> | null;
}

interface SimResult {
  steps: SimStep[];
  score: number;
  task: string;
  strategy: string;
  personality: string;
  episodes: number;
}

interface ProviderInfo {
  name: string;
  default_model: string;
  models: string[];
}

export default function SpectatePage() {
  const [tasks, setTasks] = useState<Record<string, TaskInfo>>({});
  const [providers, setProviders] = useState<Record<string, ProviderInfo>>({});
  const [selectedTask, setSelectedTask] = useState("single_deal");
  const [strategy, setStrategy] = useState("smart");
  const [personality, setPersonality] = useState("");
  const [result, setResult] = useState<SimResult | null>(null);
  const [replayStep, setReplayStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // LLM config
  const [llmProvider, setLlmProvider] = useState("openai");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmModel, setLlmModel] = useState("");

  useEffect(() => {
    apiGet<Record<string, TaskInfo>>("/tasks").then(setTasks).catch(() => {});
    apiGet<Record<string, ProviderInfo>>("/providers").then(setProviders).catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Scroll log to bottom on new steps
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [replayStep]);

  // Update default model when provider changes
  useEffect(() => {
    const p = providers[llmProvider];
    if (p) setLlmModel(p.default_model);
  }, [llmProvider, providers]);

  const runSimulation = useCallback(async () => {
    setLoading(true);
    setResult(null);
    setReplayStep(0);
    setIsPlaying(false);
    setError(null);
    if (timerRef.current) clearInterval(timerRef.current);

    try {
      const body: Record<string, unknown> = {
        task: selectedTask,
        strategy,
        seed: Math.floor(Math.random() * 10000),
      };
      if (personality) body.seller_personality = personality;

      // LLM config
      if (strategy === "llm") {
        if (!llmApiKey) {
          setError("API key required for LLM strategy");
          setLoading(false);
          return;
        }
        body.llm_provider = llmProvider;
        body.llm_api_key = llmApiKey;
        body.llm_model = llmModel || undefined;
      }

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
      }, strategy === "llm" ? 2000 : 1200);
    } catch (e) {
      setError(`${e}`);
    }
    setLoading(false);
  }, [selectedTask, strategy, personality, llmProvider, llmApiKey, llmModel]);

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
    ? (visibleSteps[visibleSteps.length - 1].tells as Parameters<typeof TellsDisplay>[0]["tells"])
    : null;

  const dealStep = visibleSteps.find((s) => s.outcome === "deal");
  const isLlm = strategy === "llm";

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-2">Spectator Mode</h1>
      <p className="text-sm text-foreground/50 mb-6">
        Watch an AI agent negotiate against the seller. Use rule-based strategies
        or plug in a real LLM (GPT, Claude, Gemini, Grok, HuggingFace).
      </p>

      {/* Config bar */}
      <div className="space-y-4 mb-6 p-4 rounded-xl bg-surface border border-border">
        <div className="flex flex-wrap items-end gap-4">
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
              <option value="smart">Smart (Rule-based)</option>
              <option value="naive">Naive (Capitulates)</option>
              <option value="aggressive">Aggressive (Lowballs)</option>
              <option value="llm">LLM (Real AI Model)</option>
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
            {loading ? (isLlm ? "Calling LLM..." : "Running...") : "Run & Watch"}
          </button>
        </div>

        {/* LLM config row */}
        {isLlm && (
          <div className="flex flex-wrap items-end gap-4 pt-3 border-t border-border animate-fade-in">
            <div>
              <label className="block text-xs text-foreground/50 mb-1">Provider</label>
              <select
                value={llmProvider}
                onChange={(e) => setLlmProvider(e.target.value)}
                className="bg-surface-2 border border-border rounded px-3 py-1.5 text-sm"
              >
                {Object.entries(providers).map(([key, p]) => (
                  <option key={key} value={key}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-foreground/50 mb-1">Model</label>
              <select
                value={llmModel}
                onChange={(e) => setLlmModel(e.target.value)}
                className="bg-surface-2 border border-border rounded px-3 py-1.5 text-sm"
              >
                {(providers[llmProvider]?.models ?? []).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs text-foreground/50 mb-1">API Key</label>
              <input
                type="password"
                value={llmApiKey}
                onChange={(e) => setLlmApiKey(e.target.value)}
                placeholder={`${providers[llmProvider]?.name ?? ""} API key`}
                className="w-full bg-surface-2 border border-border rounded px-3 py-1.5 text-sm"
              />
            </div>
            <div className="text-xs text-foreground/30">
              Key is sent to backend for inference only. Not stored.
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm mb-4">
          {error}
        </div>
      )}

      {!result && !error ? (
        <div className="text-center py-20 text-foreground/40">
          Select a task and strategy, then click Run & Watch.
        </div>
      ) : result ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {/* Score */}
            <div className="grid grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-surface border border-border">
                <div className="text-xs text-foreground/50">Strategy</div>
                <div className="text-sm font-semibold">
                  {result.strategy === "llm" ? `LLM (${llmModel.split("/").pop()})` : result.strategy}
                </div>
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

          {/* Right: Tells + Conversation log */}
          <div className="space-y-4">
            <TellsDisplay
              tells={currentTell}
              personality={result.personality}
            />

            {/* Conversation log */}
            <div className="rounded-xl bg-surface border border-border">
              <div className="px-4 py-2 border-b border-border text-sm font-medium">
                Negotiation Dialogue
              </div>
              <div ref={logRef} className="p-3 max-h-[420px] overflow-y-auto space-y-2">
                {visibleSteps.map((step, i) => (
                  <div key={i} className={`animate-fade-in ${i === replayStep ? "bg-surface-2/50 -mx-1 px-1 rounded" : ""}`}>
                    {/* Price action line */}
                    <div className={`text-xs flex items-center gap-1.5 ${
                      step.actor === "buyer" ? "text-accent" : "text-foreground/50"
                    }`}>
                      <span className="text-foreground/30">R{step.round}</span>
                      <span className="font-semibold">{step.actor}</span>
                      <span>{step.action}</span>
                      {step.price != null && (
                        <span className="font-mono">@ {step.price.toFixed(0)}</span>
                      )}
                      {step.reward !== 0 && (
                        <span className={step.reward > 0 ? "text-green-400" : "text-danger"}>
                          ({step.reward > 0 ? "+" : ""}{step.reward.toFixed(3)})
                        </span>
                      )}
                    </div>
                    {/* Conversation message */}
                    {step.message && (
                      <div className={`text-sm mt-0.5 pl-4 border-l-2 ${
                        step.actor === "buyer"
                          ? "border-accent/30 text-accent/80"
                          : "border-foreground/10 text-foreground/60"
                      }`}>
                        {step.message}
                      </div>
                    )}
                    {/* LLM reasoning */}
                    {step.reasoning && (
                      <div className="text-xs mt-0.5 pl-4 border-l-2 border-purple-500/30 text-purple-400/80 italic">
                        {step.reasoning}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiPost, type TaskInfo, apiGet } from "../lib/api";
import { NegotiationChart } from "../components/NegotiationChart";
import { TellsDisplay } from "../components/TellsDisplay";
import { ReplayControls } from "../components/ReplayControls";
import { AlertCircle, Play, Info, Cpu, Database } from "lucide-react";

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

  const [llmProvider, setLlmProvider] = useState("");
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

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [replayStep]);

  useEffect(() => {
    setLlmModel("");
  }, [llmProvider]);

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

      if (strategy === "llm") {
        if (!llmProvider) { setError("Provider selection required"); setLoading(false); return; }
        if (!llmModel) { setError("Model selection required"); setLoading(false); return; }
        if (!llmApiKey) { setError("Auth token required"); setLoading(false); return; }
        body.llm_provider = llmProvider;
        body.llm_api_key = llmApiKey;
        body.llm_model = llmModel;
      }

      const res = await apiPost<SimResult>("/simulate", body);
      setResult(res);
      setReplayStep(0);
      setIsPlaying(true);
      let i = 0;
      timerRef.current = setInterval(() => {
        i++;
        if (i >= res.steps.length - 1) {
          setIsPlaying(false);
          if (timerRef.current) clearInterval(timerRef.current);
        }
        setReplayStep(i);
      }, strategy === "llm" ? 2000 : 1200);
    } catch (e) {
      setError(`${e}`);
    }
    setLoading(false);
  }, [selectedTask, strategy, personality, llmProvider, llmApiKey, llmModel]);

  const play = useCallback(() => {
    if (!result) return;
    setIsPlaying(true);
    let i = replayStep;
    timerRef.current = setInterval(() => {
      i++;
      if (i >= result.steps.length - 1) {
        setIsPlaying(false);
        if (timerRef.current) clearInterval(timerRef.current);
      }
      setReplayStep(i);
    }, 1200);
  }, [result, replayStep]);

  const pause = useCallback(() => {
    setIsPlaying(false);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

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
    <div className="max-w-6xl mx-auto px-4 py-16 selection:bg-foreground selection:text-background font-sans">
      <div className="flex flex-col md:flex-row items-baseline justify-between gap-6 mb-12 border-b border-border pb-8">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-tighter mb-2 italic">Observer.v2</h1>
          <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-foreground/30">
            AI vs AI Simulation // Policy Verification
          </p>
        </div>
      </div>

      <div className="p-8 border border-border bg-surface mb-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 items-end">
          <div className="space-y-4">
            <label className="block text-[10px] uppercase tracking-widest text-foreground/40 font-black">Scenario.lib</label>
            <select
              value={selectedTask}
              onChange={(e) => setSelectedTask(e.target.value)}
              className="w-full bg-background border border-border px-4 py-3 text-[10px] uppercase tracking-tighter font-black focus:border-foreground outline-none transition-colors"
            >
              {Object.entries(tasks).map(([name, t]) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-4">
            <label className="block text-[10px] uppercase tracking-widest text-foreground/40 font-black">Agent Policy</label>
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              className="w-full bg-background border border-border px-4 py-3 text-[10px] uppercase tracking-tighter font-black focus:border-foreground outline-none transition-colors"
            >
              <option value="smart">Smart (Rule)</option>
              <option value="naive">Naive (Rule)</option>
              <option value="aggressive">Aggressive (Rule)</option>
              <option value="llm">Neural (LLM)</option>
            </select>
          </div>
          <div className="space-y-4">
            <label className="block text-[10px] uppercase tracking-widest text-foreground/40 font-black">Environment</label>
            <select
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              className="w-full bg-background border border-border px-4 py-3 text-[10px] uppercase tracking-tighter font-black focus:border-foreground outline-none transition-colors"
            >
              <option value="">Default</option>
              <option value="deceptive">Deceptive</option>
              <option value="impatient">Impatient</option>
              <option value="collaborative">Collaborative</option>
            </select>
          </div>
          <button
            onClick={runSimulation}
            disabled={loading}
            className="w-full px-8 py-4 bg-foreground text-background font-black text-xs uppercase tracking-[0.3em] hover:invert transition-all"
          >
            {loading ? "Simulating..." : "Execute Trace"}
          </button>
        </div>

        {isLlm && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-8 pt-8 border-t border-border animate-fade-in">
             <div className="space-y-4">
              <label className="block text-[10px] uppercase tracking-widest text-foreground/40 font-black">Provider</label>
              <select
                value={llmProvider}
                onChange={(e) => setLlmProvider(e.target.value)}
                className="w-full bg-background border border-border px-4 py-3 text-[10px] uppercase tracking-tighter font-black focus:border-foreground outline-none"
              >
                <option value="" disabled>Select...</option>
                {Object.entries(providers).map(([key, p]) => (
                  <option key={key} value={key}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-4">
              <label className="block text-[10px] uppercase tracking-widest text-foreground/40 font-black">Model</label>
              <select
                value={llmModel}
                onChange={(e) => setLlmModel(e.target.value)}
                className="w-full bg-background border border-border px-4 py-3 text-[10px] uppercase tracking-tighter font-black focus:border-foreground outline-none"
                disabled={!llmProvider}
              >
                <option value="" disabled>{llmProvider ? "Select..." : "Awaiting Provider"}</option>
                {(providers[llmProvider]?.models ?? []).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
             <div className="space-y-4">
              <label className="block text-[10px] uppercase tracking-widest text-foreground/40 font-black">Auth Token</label>
              <input
                type="password"
                value={llmApiKey}
                onChange={(e) => setLlmApiKey(e.target.value)}
                className="w-full bg-background border border-border px-4 py-3 text-[11px] uppercase tracking-widest font-black focus:border-foreground outline-none"
              />
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="p-6 border-2 border-red-500 text-red-500 text-[11px] uppercase tracking-[0.2em] font-black mb-12 flex items-center gap-4">
          <AlertCircle size={18} strokeWidth={3} /> {error}
        </div>
      )}

      {result && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          <div className="lg:col-span-3 space-y-8">
            <div className="grid grid-cols-4 gap-px bg-border border border-border text-center">
              {[
                { label: "Policy", value: result.strategy.toUpperCase() },
                { label: "Persona", value: result.personality.toUpperCase() || "DEFAULT" },
                { label: "Aggregate Score", value: result.score.toFixed(4) },
                { label: "Step Count", value: result.steps.length },
              ].map((m) => (
                <div key={m.label} className="bg-background p-6">
                  <div className="text-[9px] uppercase tracking-widest text-foreground/30 mb-2 font-black">{m.label}</div>
                  <div className="text-xs font-mono font-black">{m.value}</div>
                </div>
              ))}
            </div>

            <div className="border border-border p-8 bg-surface">
              <NegotiationChart
                history={chartHistory}
                budget={100}
                cost={30}
                dealPrice={dealStep?.price ?? null}
                activeRound={visibleSteps[visibleSteps.length - 1]?.round}
              />
            </div>

            <div className="p-4 border border-border bg-background">
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
          </div>

          <div className="space-y-8">
            <TellsDisplay
              tells={currentTell}
              personality={result.personality}
            />

            <div className="border border-border bg-surface overflow-hidden">
               <div className="px-6 py-4 border-b border-border text-[9px] uppercase tracking-[0.3em] font-black opacity-30 italic">
                Execution Buffer
              </div>
              <div ref={logRef} className="p-6 h-[500px] overflow-y-auto space-y-6 custom-scrollbar font-mono">
                {visibleSteps.map((step, i) => (
                  <div key={i} className={`flex gap-6 animate-fade-in ${i === replayStep ? "bg-foreground text-background -mx-4 px-4 py-2" : "opacity-30"}`}>
                    <span className="shrink-0 w-8 text-[8px] opacity-40 pt-1 italic">[{String(step.round).padStart(2, '0')}]</span>
                    <div className="flex-1 space-y-2">
                       <div className="text-[8px] uppercase tracking-widest font-black flex justify-between">
                         <span>{step.actor} // {step.action}</span>
                         {step.price != null && <span>₹{step.price.toFixed(0)}</span>}
                       </div>
                       {step.message && <div className="text-[10px] leading-relaxed tracking-tight">{step.message}</div>}
                       {step.reasoning && (
                        <div className="text-[9px] opacity-60 leading-normal border-t border-current pt-2 mt-2 font-sans italic opacity-40">
                          LOGIC: {step.reasoning}
                        </div>
                       )}
                    </div>
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

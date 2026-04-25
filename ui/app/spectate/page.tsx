"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiPost, type TaskInfo, apiGet } from "../lib/api";
import { NegotiationChart } from "../components/NegotiationChart";
import { TellsDisplay } from "../components/TellsDisplay";
import { ReplayControls } from "../components/ReplayControls";
import { AlertCircle, Loader2, Play } from "lucide-react";

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
    <div className="max-w-6xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-h1 mb-2">Spectate</h1>
        <p className="text-meta">
          Watch a buyer policy negotiate against the env. Turn-by-turn replay.
        </p>
      </div>

      {/* Config */}
      <div className="rounded-xl border border-border bg-surface p-6 mb-8">
        <div className="grid md:grid-cols-4 gap-5 items-end">
          <Field label="Scenario">
            <Select value={selectedTask} onChange={setSelectedTask}>
              {Object.keys(tasks).map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Buyer policy">
            <Select value={strategy} onChange={setStrategy}>
              <option value="smart">Smart (rule)</option>
              <option value="naive">Naive (rule)</option>
              <option value="aggressive">Aggressive (rule)</option>
              <option value="llm">Neural (LLM)</option>
            </Select>
          </Field>
          <Field label="Seller personality">
            <Select value={personality} onChange={setPersonality}>
              <option value="">default</option>
              <option value="deceptive">deceptive</option>
              <option value="impatient">impatient</option>
              <option value="collaborative">collaborative</option>
            </Select>
          </Field>
          <button
            onClick={runSimulation}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-accent text-background px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity h-[42px]"
          >
            {loading ? (
              <><Loader2 size={14} className="animate-spin" /> Running</>
            ) : (
              <><Play size={14} /> Run trace</>
            )}
          </button>
        </div>

        {isLlm && (
          <div className="grid md:grid-cols-3 gap-5 mt-5 pt-5 border-t border-border">
            <Field label="LLM provider">
              <Select value={llmProvider} onChange={setLlmProvider}>
                <option value="">select…</option>
                {Object.entries(providers).map(([key, p]) => (
                  <option key={key} value={key}>{p.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Model">
              <Select value={llmModel} onChange={setLlmModel} disabled={!llmProvider}>
                <option value="">{llmProvider ? "select…" : "pick a provider first"}</option>
                {(providers[llmProvider]?.models ?? []).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </Select>
            </Field>
            <Field label="API key">
              <input
                type="password"
                value={llmApiKey}
                onChange={(e) => setLlmApiKey(e.target.value)}
                className="w-full bg-background border border-border rounded-md px-3 py-2.5 text-sm font-mono focus:border-accent outline-none transition-colors h-[42px]"
              />
            </Field>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-bad/40 bg-bad/10 px-5 py-4 mb-8 flex items-center gap-3">
          <AlertCircle size={16} className="text-bad shrink-0" />
          <span className="text-bad text-sm">{error}</span>
        </div>
      )}

      {result && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-5">
            {/* Stat strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Policy" value={result.strategy} />
              <Stat label="Persona" value={result.personality || "default"} />
              <Stat label="Score" value={result.score.toFixed(3)} mono />
              <Stat label="Steps" value={result.steps.length.toString()} mono />
            </div>

            {/* Chart */}
            <div className="rounded-xl border border-border bg-surface p-6">
              <NegotiationChart
                history={chartHistory}
                budget={100}
                cost={30}
                dealPrice={dealStep?.price ?? null}
                activeRound={visibleSteps[visibleSteps.length - 1]?.round}
              />
            </div>

            {/* Replay controls */}
            <div className="rounded-xl border border-border bg-surface p-4">
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

          {/* Right column */}
          <div className="space-y-5">
            <TellsDisplay tells={currentTell} personality={result.personality} />

            <div className="rounded-xl border border-border bg-surface overflow-hidden">
              <div className="px-5 py-3 border-b border-border">
                <div className="text-eyebrow">Step log</div>
              </div>
              <div ref={logRef} className="p-4 h-[440px] overflow-y-auto space-y-2.5 font-mono">
                {visibleSteps.map((step, i) => (
                  <div
                    key={i}
                    className={`rounded-lg px-3 py-2 transition-colors ${
                      i === replayStep
                        ? "bg-accent/10 border border-accent/30"
                        : "opacity-50"
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="text-fg3 tabular-nums">[{String(step.round).padStart(2, "0")}]</span>
                      <span className="text-fg2">{step.actor} · {step.action}</span>
                      {step.price != null && (
                        <span className="text-foreground tabular-nums">₹{step.price.toFixed(0)}</span>
                      )}
                    </div>
                    {step.message && (
                      <div className="text-xs text-foreground leading-relaxed font-sans">
                        {step.message}
                      </div>
                    )}
                    {step.reasoning && (
                      <div className="text-[10px] text-fg3 italic leading-relaxed font-sans mt-1.5 pt-1.5 border-t border-border/50">
                        {step.reasoning}
                      </div>
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

/* ── Reusable bits ─────────────────────────────────────── */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-eyebrow block mb-2">{label}</label>
      {children}
    </div>
  );
}

function Select({
  value,
  onChange,
  disabled,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full bg-background border border-border rounded-md px-3 py-2.5 text-sm focus:border-accent outline-none transition-colors h-[42px] disabled:opacity-40"
    >
      {children}
    </select>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <div className="text-eyebrow mb-1">{label}</div>
      <div className={`text-base ${mono ? "font-mono tabular-nums" : "capitalize"} text-foreground`}>
        {value}
      </div>
    </div>
  );
}

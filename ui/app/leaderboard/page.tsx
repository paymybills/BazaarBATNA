"use client";

import { useState } from "react";
import { Trophy, ArrowUpRight } from "lucide-react";

/* ── Hardcoded eval data ── */
interface PolicyResult {
  policy: string;
  label: string;
  tasks: {
    amazon_realistic: { surplus: number; deal_rate: number; rounds: number };
    read_the_tells: { surplus: number; deal_rate: number; rounds: number };
    career_10: { surplus: number; deal_rate: number; rounds: number };
  };
  n_per_task: number;
}

const policies: PolicyResult[] = [
  {
    policy: "bestdealbot",
    label: "MolBhav (bestdealbot)",
    n_per_task: 20,
    tasks: {
      amazon_realistic: { surplus: 0.9132, deal_rate: 1.0, rounds: 7.5 },
      read_the_tells: { surplus: 0.4176, deal_rate: 1.0, rounds: 2.0 },
      career_10: { surplus: 0.9717, deal_rate: 1.0, rounds: 7.8 },
    },
  },
  {
    policy: "rule_based",
    label: "Rule-Based",
    n_per_task: 20,
    tasks: {
      amazon_realistic: { surplus: 0.3957, deal_rate: 0.95, rounds: 3.8 },
      read_the_tells: { surplus: 0.0411, deal_rate: 0.05, rounds: 2.0 },
      career_10: { surplus: 0.8045, deal_rate: 1.0, rounds: 3.9 },
    },
  },
  {
    policy: "llama3.2:3b",
    label: "Llama 3.2 3B (baseline)",
    n_per_task: 20,
    tasks: {
      amazon_realistic: { surplus: 0.2341, deal_rate: 1.0, rounds: 2.05 },
      read_the_tells: { surplus: 0.3079, deal_rate: 0.65, rounds: 1.9 },
      career_10: { surplus: 0.705, deal_rate: 1.0, rounds: 1.95 },
    },
  },
];

const taskNames = ["amazon_realistic", "read_the_tells", "career_10"] as const;

function avgSurplus(p: PolicyResult): number {
  return (p.tasks.amazon_realistic.surplus + p.tasks.read_the_tells.surplus + p.tasks.career_10.surplus) / 3;
}

function avgDealRate(p: PolicyResult): number {
  return (p.tasks.amazon_realistic.deal_rate + p.tasks.read_the_tells.deal_rate + p.tasks.career_10.deal_rate) / 3;
}

export default function LeaderboardPage() {
  const [viewMode, setViewMode] = useState<"overall" | "per_task">("overall");
  const sorted = [...policies].sort((a, b) => avgSurplus(b) - avgSurplus(a));

  return (
    <div className="max-w-5xl mx-auto px-4 py-16 selection:bg-foreground selection:text-background font-sans">
      <div className="flex flex-col md:flex-row items-baseline justify-between gap-6 mb-16 border-b border-border pb-8">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-tighter mb-2 italic">Benchmarks.lib</h1>
          <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-foreground/30">
            Automated Evaluation Logs // n=20 eps/task
          </p>
        </div>
        <div className="flex bg-surface border border-border p-1">
          <button
            onClick={() => setViewMode("overall")}
            className={`px-4 py-2 text-[10px] uppercase tracking-widest font-black transition-all ${
              viewMode === "overall" ? "bg-foreground text-background" : "text-foreground/40 hover:text-foreground"
            }`}
          >
            Overall
          </button>
          <button
            onClick={() => setViewMode("per_task")}
            className={`px-4 py-2 text-[10px] uppercase tracking-widest font-black transition-all ${
              viewMode === "per_task" ? "bg-foreground text-background" : "text-foreground/40 hover:text-foreground"
            }`}
          >
            Per Task
          </button>
        </div>
      </div>

      {/* Overall view */}
      {viewMode === "overall" && (
        <div className="border border-border">
          <table className="w-full text-[11px] uppercase tracking-wider">
            <thead>
              <tr className="border-b border-border bg-surface text-foreground/40 font-black">
                <th className="px-6 py-4 text-left w-16">Rank</th>
                <th className="px-6 py-4 text-left">Entity</th>
                <th className="px-6 py-4 text-right">Surplus</th>
                <th className="px-6 py-4 text-right">Success</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p, i) => {
                const isOurs = p.policy === "bestdealbot";
                return (
                  <tr
                    key={p.policy}
                    className={`border-b border-border last:border-0 transition-colors ${
                      isOurs ? "bg-foreground text-background" : "hover:bg-surface"
                    }`}
                  >
                    <td className="px-6 py-6 font-mono opacity-40">{String(i + 1).padStart(2, '0')}</td>
                    <td className="px-6 py-6 font-black italic">
                      {p.label}
                      {isOurs && <span className={`ml-3 italic text-[9px] ${isOurs ? "opacity-60" : ""}`}>── MolBhav</span>}
                    </td>
                    <td className="px-6 py-6 text-right font-mono font-bold text-sm">
                      {avgSurplus(p).toFixed(4)}
                    </td>
                    <td className="px-6 py-6 text-right font-mono opacity-50">
                      {(avgDealRate(p) * 100).toFixed(0)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Per-task view */}
      {viewMode === "per_task" && (
        <div className="space-y-12">
          {taskNames.map((task) => {
            const taskSorted = [...policies].sort((a, b) => b.tasks[task].surplus - a.tasks[task].surplus);
            return (
              <div key={task} className="border border-border">
                <div className="px-6 py-4 bg-surface border-b border-border text-[10px] uppercase tracking-[0.4em] font-black italic">
                  {task}
                </div>
                <table className="w-full text-[10px] uppercase tracking-widest">
                  <thead>
                    <tr className="border-b border-border text-foreground/20">
                      <th className="px-6 py-3 text-left w-16">#</th>
                      <th className="px-6 py-3 text-left">Agent</th>
                      <th className="px-6 py-3 text-right">Surplus</th>
                      <th className="px-6 py-3 text-right">Rounds</th>
                    </tr>
                  </thead>
                  <tbody>
                    {taskSorted.map((p, i) => {
                      const isOurs = p.policy === "bestdealbot";
                      const d = p.tasks[task];
                      return (
                        <tr
                          key={p.policy}
                          className={`border-b border-border last:border-0 transition-colors ${
                            isOurs ? "bg-foreground text-background" : "hover:bg-surface"
                          }`}
                        >
                          <td className="px-6 py-4 font-mono opacity-30">{i + 1}</td>
                          <td className="px-6 py-4 font-black">{p.label}</td>
                          <td className="px-6 py-4 text-right font-mono font-bold">{d.surplus.toFixed(4)}</td>
                          <td className="px-6 py-4 text-right font-mono opacity-40">{d.rounds.toFixed(1)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      {/* Submit CTA */}
      <div className="mt-24 p-12 border border-border text-center bg-surface">
        <h2 className="font-black text-xl uppercase tracking-tighter mb-4 italic">Submit Verification</h2>
        <p className="text-[11px] uppercase tracking-widest text-foreground/40 mb-8 max-w-md mx-auto leading-relaxed">
          OpenEnv agents must be compatible with BazaarBATNA protocol. Evaluation requires n=20 episodes per task.
        </p>
        <a
          href="https://github.com/paymybills/BazaarBATNA"
          target="_blank"
          className="inline-flex items-center gap-3 px-10 py-4 bg-foreground text-background font-black text-xs uppercase tracking-[0.3em] hover:invert transition-all"
        >
          <ArrowUpRight size={14} /> GitHub Protocol
        </a>
      </div>
    </div>
  );
}

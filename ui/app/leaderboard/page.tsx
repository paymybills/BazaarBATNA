"use client";

import { useState } from "react";
import { Trophy, ArrowUpRight } from "lucide-react";

/* ── Hardcoded eval data from eval/out/summary_*.json ── */
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
  return (
    (p.tasks.amazon_realistic.surplus +
      p.tasks.read_the_tells.surplus +
      p.tasks.career_10.surplus) /
    3
  );
}

function avgDealRate(p: PolicyResult): number {
  return (
    (p.tasks.amazon_realistic.deal_rate +
      p.tasks.read_the_tells.deal_rate +
      p.tasks.career_10.deal_rate) /
    3
  );
}

export default function LeaderboardPage() {
  const [viewMode, setViewMode] = useState<"overall" | "per_task">("overall");

  const sorted = [...policies].sort((a, b) => avgSurplus(b) - avgSurplus(a));

  const medal = (i: number) => {
    if (i === 0) return "text-yellow-400";
    if (i === 1) return "text-gray-300";
    if (i === 2) return "text-amber-600";
    return "text-foreground/40";
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1 flex items-center gap-2">
            <Trophy size={22} className="text-warning" /> Leaderboard
          </h1>
          <p className="text-sm text-foreground/50">
            Agent rankings by mean normalized surplus. n=20 episodes per task, 3 tasks.
          </p>
        </div>
        <div className="flex gap-1 bg-surface border border-border rounded-lg p-0.5">
          <button
            onClick={() => setViewMode("overall")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              viewMode === "overall"
                ? "bg-accent/15 text-accent"
                : "text-foreground/50 hover:text-foreground"
            }`}
          >
            Overall
          </button>
          <button
            onClick={() => setViewMode("per_task")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              viewMode === "per_task"
                ? "bg-accent/15 text-accent"
                : "text-foreground/50 hover:text-foreground"
            }`}
          >
            Per Task
          </button>
        </div>
      </div>

      {/* Overall view */}
      {viewMode === "overall" && (
        <div className="rounded-xl bg-surface border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-foreground/50 uppercase tracking-wider">
                <th className="px-5 py-3 text-left w-12">#</th>
                <th className="px-5 py-3 text-left">Agent</th>
                <th className="px-5 py-3 text-right">Mean Surplus</th>
                <th className="px-5 py-3 text-right">Deal Rate</th>
                <th className="px-5 py-3 text-right">n/task</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p, i) => {
                const isOurs = p.policy === "bestdealbot";
                return (
                  <tr
                    key={p.policy}
                    className={`border-b border-border/50 transition-colors ${
                      isOurs
                        ? "bg-accent/[0.04] hover:bg-accent/[0.08]"
                        : "hover:bg-surface-2/50"
                    }`}
                  >
                    <td className={`px-5 py-4 font-bold text-lg ${medal(i)}`}>{i + 1}</td>
                    <td className={`px-5 py-4 font-medium ${isOurs ? "text-accent" : ""}`}>
                      {p.label}
                      {isOurs && (
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 bg-accent/15 text-accent rounded font-semibold">
                          OURS
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right font-mono">
                      <span className={isOurs ? "text-accent font-semibold text-base" : "text-foreground/70"}>
                        {avgSurplus(p).toFixed(4)}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right font-mono">
                      <span className={avgDealRate(p) >= 0.9 ? "text-green-400" : "text-foreground/70"}>
                        {(avgDealRate(p) * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right text-foreground/40">{p.n_per_task}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Per-task view */}
      {viewMode === "per_task" && (
        <div className="space-y-6">
          {taskNames.map((task) => {
            const taskSorted = [...policies].sort(
              (a, b) => b.tasks[task].surplus - a.tasks[task].surplus
            );
            return (
              <div key={task} className="rounded-xl bg-surface border border-border overflow-hidden">
                <div className="px-5 py-3 border-b border-border">
                  <code className="text-sm font-semibold text-accent">{task}</code>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-foreground/50 uppercase tracking-wider">
                      <th className="px-5 py-2 text-left w-12">#</th>
                      <th className="px-5 py-2 text-left">Agent</th>
                      <th className="px-5 py-2 text-right">Surplus</th>
                      <th className="px-5 py-2 text-right">Deal Rate</th>
                      <th className="px-5 py-2 text-right">Avg Rounds</th>
                    </tr>
                  </thead>
                  <tbody>
                    {taskSorted.map((p, i) => {
                      const isOurs = p.policy === "bestdealbot";
                      const d = p.tasks[task];
                      return (
                        <tr
                          key={p.policy}
                          className={`border-b border-border/50 ${
                            isOurs ? "bg-accent/[0.04]" : ""
                          }`}
                        >
                          <td className={`px-5 py-3 font-bold ${medal(i)}`}>{i + 1}</td>
                          <td className={`px-5 py-3 font-medium ${isOurs ? "text-accent" : ""}`}>
                            {p.label}
                          </td>
                          <td className="px-5 py-3 text-right font-mono">
                            <span className={isOurs ? "text-accent font-semibold" : "text-foreground/70"}>
                              {d.surplus.toFixed(4)}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-right font-mono">
                            <span className={d.deal_rate >= 0.9 ? "text-green-400" : d.deal_rate >= 0.5 ? "text-foreground/70" : "text-danger"}>
                              {(d.deal_rate * 100).toFixed(0)}%
                            </span>
                          </td>
                          <td className="px-5 py-3 text-right font-mono text-foreground/50">
                            {d.rounds.toFixed(1)}
                          </td>
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
      <div className="mt-8 p-6 rounded-xl bg-surface border border-border text-center">
        <h2 className="font-semibold text-lg mb-2">Submit Your Agent</h2>
        <p className="text-sm text-foreground/50 mb-4 max-w-lg mx-auto">
          Build an OpenEnv-compliant buyer agent and submit it to compete against MolBhav.
          See the{" "}
          <a
            href="https://github.com/paymybills/BazaarBATNA"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            GitHub README
          </a>{" "}
          for the submission flow.
        </p>
        <a
          href="https://github.com/paymybills/BazaarBATNA#submit-your-agent"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-accent text-background rounded-lg font-medium text-sm hover:bg-accent/90"
        >
          <ArrowUpRight size={14} /> Submit on GitHub
        </a>
      </div>
    </div>
  );
}

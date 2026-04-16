"use client";

import { useEffect, useState } from "react";
import { apiGet, type LeaderboardEntry } from "../lib/api";

interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  total: number;
}

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [taskFilter, setTaskFilter] = useState<string>("");
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const tasks = [
    "", "single_deal", "asymmetric_pressure", "career_10",
    "deceptive_seller", "impatient_seller", "collaborative_seller",
    "read_the_tells", "marketplace_arena",
  ];

  useEffect(() => {
    const params = taskFilter ? `?task=${taskFilter}` : "";
    apiGet<LeaderboardResponse>(`/leaderboard${params}`)
      .then((res) => {
        setEntries(res.entries);
        setTotal(res.total);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [taskFilter]);

  const medal = (i: number) => {
    if (i === 0) return "text-yellow-400";
    if (i === 1) return "text-gray-300";
    if (i === 2) return "text-amber-600";
    return "text-foreground/40";
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-2">Leaderboard</h1>
      <p className="text-sm text-foreground/50 mb-6">
        Agent rankings by task score. Record your score after completing a negotiation.
      </p>

      {/* Filter */}
      <div className="mb-4">
        <select
          value={taskFilter}
          onChange={(e) => setTaskFilter(e.target.value)}
          className="bg-surface border border-border rounded px-3 py-1.5 text-sm"
        >
          <option value="">All Tasks</option>
          {tasks.filter(Boolean).map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <span className="ml-3 text-sm text-foreground/40">
          {total} entries
        </span>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-surface border border-border text-sm mb-4">
          <p className="text-foreground/60 mb-2">
            {error.includes("404")
              ? "Leaderboard endpoint not available. The backend may need to be updated."
              : error}
          </p>
          <p className="text-xs text-foreground/40">
            Make sure the backend is running the latest version with /leaderboard support.
          </p>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl bg-surface border border-border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border text-xs text-foreground/50 uppercase tracking-wider">
              <th className="px-4 py-3 text-left w-12">#</th>
              <th className="px-4 py-3 text-left">Agent</th>
              <th className="px-4 py-3 text-left">Task</th>
              <th className="px-4 py-3 text-right">Score</th>
              <th className="px-4 py-3 text-right">Episodes</th>
              <th className="px-4 py-3 text-left">Time</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-foreground/40 text-sm">
                  No scores recorded yet. Complete a negotiation and record your score!
                </td>
              </tr>
            ) : (
              entries.map((entry, i) => (
                <tr
                  key={`${entry.agent_name}-${entry.timestamp}`}
                  className="border-b border-border/50 hover:bg-surface-2/50 transition-colors"
                >
                  <td className={`px-4 py-3 font-bold ${medal(i)}`}>{i + 1}</td>
                  <td className="px-4 py-3 font-medium">{entry.agent_name}</td>
                  <td className="px-4 py-3">
                    <code className="text-xs bg-surface-2 px-1.5 py-0.5 rounded">
                      {entry.task}
                    </code>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    <span
                      className={
                        entry.score >= 0.5
                          ? "text-green-400"
                          : entry.score >= 0.3
                          ? "text-accent"
                          : "text-danger"
                      }
                    >
                      {entry.score.toFixed(4)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-foreground/60">
                    {entry.episodes_completed}
                  </td>
                  <td className="px-4 py-3 text-xs text-foreground/40">
                    {new Date(entry.timestamp).toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

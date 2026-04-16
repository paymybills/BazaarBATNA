"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, type TaskInfo } from "./lib/api";

export default function Dashboard() {
  const [tasks, setTasks] = useState<Record<string, TaskInfo>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Record<string, TaskInfo>>("/tasks")
      .then(setTasks)
      .catch((e) => setError(e.message));
  }, []);

  const difficultyColor: Record<string, string> = {
    easy: "bg-green-500/15 text-green-400",
    medium: "bg-yellow-500/15 text-yellow-400",
    hard: "bg-red-500/15 text-red-400",
    expert: "bg-purple-500/15 text-purple-400",
  };

  const personalityIcon: Record<string, string> = {
    default: "",
    deceptive: " [bluffs]",
    impatient: " [rushes]",
    collaborative: " [cooperates]",
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Hero */}
      <div className="mb-10">
        <h1 className="text-4xl font-bold tracking-tight mb-2">BazaarBATNA</h1>
        <p className="text-foreground/60 text-lg max-w-2xl">
          AI negotiation environment with game theory, poker-style tells,
          and multi-buyer marketplace arenas.
        </p>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-10">
        {[
          { href: "/negotiate", label: "Negotiate", desc: "Play against the seller" },
          { href: "/replay", label: "Replay", desc: "Review past sessions" },
          { href: "/arena", label: "Arena", desc: "Multi-buyer competition" },
          { href: "/leaderboard", label: "Leaderboard", desc: "Agent rankings" },
        ].map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="group block p-5 rounded-xl bg-surface border border-border hover:border-accent/30 transition-all"
          >
            <h3 className="font-semibold text-lg mb-1 group-hover:text-accent transition-colors">
              {card.label}
            </h3>
            <p className="text-sm text-foreground/50">{card.desc}</p>
          </Link>
        ))}
      </div>

      {/* Tasks grid */}
      <h2 className="text-xl font-semibold mb-4">Available Tasks</h2>

      {error && (
        <div className="p-4 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm mb-4">
          Failed to load tasks: {error}. Make sure the backend is running on{" "}
          <code className="bg-surface px-1 rounded">localhost:8000</code>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Object.entries(tasks).map(([name, task]) => (
          <div
            key={name}
            className="p-4 rounded-xl bg-surface border border-border hover:border-border/80 transition-colors"
          >
            <div className="flex items-start justify-between mb-2">
              <div>
                <code className="text-sm font-semibold text-accent">{name}</code>
                {task.seller_personality !== "default" && (
                  <span className="ml-2 text-xs text-foreground/40">
                    {personalityIcon[task.seller_personality]}
                  </span>
                )}
              </div>
              <span
                className={`px-2 py-0.5 rounded text-xs font-medium ${
                  difficultyColor[task.difficulty] || "bg-surface-2 text-foreground/50"
                }`}
              >
                {task.difficulty}
              </span>
            </div>
            <p className="text-sm text-foreground/60 mb-3">{task.description}</p>
            <div className="flex gap-2 text-xs text-foreground/40">
              {task.enable_tells && (
                <span className="px-1.5 py-0.5 bg-purple-500/10 text-purple-400 rounded">
                  tells
                </span>
              )}
              {task.enable_coalition && (
                <span className="px-1.5 py-0.5 bg-blue-500/10 text-blue-400 rounded">
                  multi-buyer
                </span>
              )}
              {task.num_buyers > 1 && (
                <span className="px-1.5 py-0.5 bg-surface-2 rounded">
                  {task.num_buyers} buyers
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Architecture info */}
      <div className="mt-10 p-6 rounded-xl bg-surface border border-border">
        <h2 className="text-lg font-semibold mb-3">How It Works</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm text-foreground/60">
          <div>
            <h3 className="font-medium text-foreground mb-1">Game Theory</h3>
            <p>
              Rubinstein alternating-offers model with asymmetric private
              information, non-linear time discounting, and stochastic BATNA.
            </p>
          </div>
          <div>
            <h3 className="font-medium text-foreground mb-1">Poker Tells</h3>
            <p>
              Sellers leak observable signals -- verbal urgency, fidgeting,
              deception cues. Smart agents learn to read the bluff.
            </p>
          </div>
          <div>
            <h3 className="font-medium text-foreground mb-1">Multi-Buyer Arena</h3>
            <p>
              Facebook Marketplace dynamics -- multiple buyers compete for the
              same item. Coalition signals, winner&#39;s curse, and seller manipulation.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import type { TellObservation } from "../lib/api";

interface Props {
  tells: TellObservation | null;
  personality: string;
}

function Bar({ value, color = "accent", label }: { value: number; color?: string; label: string }) {
  const pct = Math.max(0, Math.min(100, value * 100));
  const colorClass =
    color === "danger" ? "bg-danger" : color === "warning" ? "bg-warning" : "bg-accent";
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-28 text-foreground/60 truncate">{label}</span>
      <div className="flex-1 h-2 bg-surface-2 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-10 text-right font-mono text-foreground/50">{pct.toFixed(0)}%</span>
    </div>
  );
}

function Badge({ text, variant }: { text: string; variant: "info" | "warn" | "danger" | "good" }) {
  const cls = {
    info: "bg-blue-500/15 text-blue-400",
    warn: "bg-yellow-500/15 text-yellow-400",
    danger: "bg-red-500/15 text-red-400",
    good: "bg-green-500/15 text-green-400",
  }[variant];
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {text}
    </span>
  );
}

export function TellsDisplay({ tells, personality }: Props) {
  if (!tells) {
    return (
      <div className="rounded-lg bg-surface border border-border p-4">
        <h3 className="text-sm font-semibold mb-2 text-foreground/70">Seller Tells</h3>
        <p className="text-xs text-foreground/40">No tells available for this round.</p>
      </div>
    );
  }

  const deceptionHigh = tells.verbal_deception_cue > 0.4;
  const urgentHigh = tells.verbal_urgency > 0.5;
  const nervousHigh = tells.fidget_level > 0.4;

  return (
    <div className="rounded-lg bg-surface border border-border p-4 animate-fade-in">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">Seller Tells</h3>
        <Badge
          text={personality}
          variant={
            personality === "deceptive" ? "danger" :
            personality === "impatient" ? "warn" :
            personality === "collaborative" ? "good" : "info"
          }
        />
      </div>

      {/* Verbal signals */}
      <div className="space-y-1.5 mb-3">
        <Bar value={tells.verbal_urgency} color={urgentHigh ? "warning" : "accent"} label="Urgency" />
        <Bar value={tells.verbal_confidence} label="Confidence" />
        <Bar value={tells.verbal_deception_cue} color={deceptionHigh ? "danger" : "accent"} label="Deception Cue" />
        <Bar value={tells.fidget_level} color={nervousHigh ? "warning" : "accent"} label="Nervousness" />
        <Bar value={tells.emotional_escalation} color="warning" label="Emotion" />
      </div>

      {/* Categorical tells */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-foreground/50">Eyes:</span>{" "}
          <span className={tells.eye_contact === "avoidant" ? "text-warning" : tells.eye_contact === "intense" ? "text-danger" : ""}>
            {tells.eye_contact}
          </span>
        </div>
        <div>
          <span className="text-foreground/50">Posture:</span>{" "}
          <span className={tells.posture === "arms_crossed" ? "text-warning" : ""}>
            {tells.posture.replace("_", " ")}
          </span>
        </div>
        <div>
          <span className="text-foreground/50">Speed:</span>{" "}
          <span className={tells.offer_speed === "instant" ? "text-danger" : ""}>
            {tells.offer_speed}
          </span>
        </div>
        <div>
          <span className="text-foreground/50">Pattern:</span>{" "}
          <span className={tells.concession_pattern === "erratic" ? "text-danger" : tells.concession_pattern === "stalling" ? "text-warning" : ""}>
            {tells.concession_pattern}
          </span>
        </div>
        {tells.topic_changes > 0 && (
          <div className="col-span-2">
            <Badge text={`${tells.topic_changes} topic changes (diversion)`} variant="warn" />
          </div>
        )}
      </div>

      {/* Poker read */}
      {(deceptionHigh || (nervousHigh && tells.offer_speed === "instant")) && (
        <div className="mt-3 p-2 rounded bg-danger/10 border border-danger/20 text-xs text-danger">
          Possible bluff detected: {deceptionHigh ? "high deception cues" : "nervous + instant response"}
        </div>
      )}
    </div>
  );
}

"use client";

import type { TellObservation } from "../lib/api";

interface Props {
  tells: TellObservation | null;
  personality: string;
}

function Bar({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <div className="flex items-center gap-3 text-[10px] uppercase font-bold tracking-tight">
      <span className="w-28 text-foreground/40 truncate">{label}</span>
      <div className="flex-1 h-[2px] bg-white/5 overflow-hidden">
        <div
          className="h-full bg-foreground transition-all duration-1000 ease-in-out"
          style={{ width: `${pct}%`, opacity: 0.1 + (pct/100) * 0.9 }}
        />
      </div>
      <span className="w-10 text-right font-mono text-foreground/20 text-[9px] italic">{pct.toFixed(0)}%</span>
    </div>
  );
}

export function TellsDisplay({ tells, personality }: Props) {
  if (!tells) {
    return (
      <div className="border border-border bg-surface p-6 font-sans">
        <h3 className="text-[10px] uppercase tracking-[0.2em] font-black mb-4">Signal Analysis</h3>
        <p className="text-[10px] uppercase tracking-widest text-foreground/20 font-bold">Trace Buffer Empty...</p>
      </div>
    );
  }

  const deceptionHigh = tells.verbal_deception_cue > 0.4;
  const urgentHigh = tells.verbal_urgency > 0.5;

  return (
    <div className="border border-border bg-surface p-6 animate-fade-in font-sans">
      <div className="flex items-center justify-between mb-8 border-b border-border pb-4">
        <h3 className="text-[10px] uppercase tracking-[0.3em] font-black italic">Signal Analysis</h3>
        <span className="text-[9px] uppercase tracking-[0.2em] font-black border border-white/10 px-2 py-0.5 opacity-40">
           Policy // {personality || "DEFAULT"}
        </span>
      </div>

      <div className="space-y-4 mb-10">
        <Bar value={tells.verbal_urgency} label="Urgency" />
        <Bar value={tells.verbal_confidence} label="Confidence" />
        <Bar value={tells.verbal_deception_cue} label="Deception" />
        <Bar value={tells.fidget_level} label="Fission" />
        <Bar value={tells.emotional_escalation} label="Emotional" />
      </div>

      <div className="grid grid-cols-1 gap-4 text-[10px] uppercase tracking-widest font-black italic">
        {[
          { k: "OCULAR", v: tells.eye_contact },
          { k: "POSTURE", v: tells.posture.replace("_", " ") },
          { k: "VELOCITY", v: tells.offer_speed },
          { k: "STRATEGY", v: tells.concession_pattern }
        ].map(item => (
          <div key={item.k} className="flex justify-between items-center opacity-30 hover:opacity-100 transition-opacity">
            <span>{item.k}</span>
            <span className="text-foreground">{item.v}</span>
          </div>
        ))}
      </div>

      {deceptionHigh && (
        <div className="mt-10 p-4 border border-foreground/20 text-[10px] uppercase tracking-widest font-black text-center italic bg-white/[0.02]">
          Anomalous Divergence Detected
        </div>
      )}
    </div>
  );
}

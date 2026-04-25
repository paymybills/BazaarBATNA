"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  ArrowLeft,
  Share2,
  Check,
} from "lucide-react";

interface ReplayTranscriptEntry {
  round: number;
  actor: string;
  text: string;
  action?: string;
  price?: number | null;
}

interface CuratedReplay {
  id: string;
  title: string;
  task: string;
  surplus: number;
  rounds: number;
  seller_personality: string;
  buyer_budget: number;
  seller_cost: number;
  seller_anchor: number;
  agreed_price: number;
  transcript: ReplayTranscriptEntry[];
}

export function ReplayClient({ replay }: { replay: CuratedReplay }) {
  const [step, setStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalSteps = replay.transcript.length;

  const play = useCallback(() => {
    setIsPlaying(true);
    timerRef.current = setInterval(() => {
      setStep((s) => {
        if (s >= totalSteps - 1) {
          setIsPlaying(false);
          if (timerRef.current) clearInterval(timerRef.current);
          return s;
        }
        return s + 1;
      });
    }, 1200);
  }, [totalSteps]);

  const pause = useCallback(() => {
    setIsPlaying(false);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const copyUrl = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const visibleTranscript = replay.transcript.slice(0, step + 1);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <Link
            href="/replay"
            className="text-xs text-foreground/40 hover:text-foreground/60 flex items-center gap-1 mb-2"
          >
            <ArrowLeft size={12} /> Back to Replay
          </Link>
          <h1 className="text-xl font-bold mb-1">{replay.title}</h1>
          <div className="flex items-center gap-3 text-xs text-foreground/40">
            <code className="bg-surface-2 px-1.5 py-0.5 rounded">{replay.task}</code>
            <span>{replay.rounds} rounds</span>
            <span className="text-accent font-mono">{(replay.surplus * 100).toFixed(1)}% surplus</span>
            {replay.seller_personality !== "default" && (
              <span className="px-1.5 py-0.5 bg-red-500/15 text-red-400 rounded">{replay.seller_personality}</span>
            )}
          </div>
        </div>
        <button
          onClick={copyUrl}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border rounded-lg text-xs hover:border-accent/30"
        >
          {copied ? <Check size={12} className="text-green-400" /> : <Share2 size={12} />}
          {copied ? "Copied!" : "Share"}
        </button>
      </div>

      {/* Info bar */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: "Seller Anchor", value: `₹${replay.seller_anchor}` },
          { label: "Seller Cost", value: `₹${replay.seller_cost}` },
          { label: "Buyer Budget", value: `₹${replay.buyer_budget}` },
          { label: "Agreed Price", value: `₹${replay.agreed_price}`, color: "text-accent" },
        ].map((m) => (
          <div key={m.label} className="p-3 rounded-lg bg-surface border border-border">
            <div className="text-[10px] text-foreground/40 uppercase tracking-wider">{m.label}</div>
            <div className={`text-base font-mono font-semibold ${m.color || ""}`}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* Transcript */}
      <div className="rounded-xl bg-surface border border-border overflow-hidden mb-4">
        <div className="px-5 py-3 border-b border-border text-sm font-medium">
          Transcript
        </div>
        <div className="p-5 space-y-3 min-h-[200px]">
          {visibleTranscript.map((entry, i) => (
            <div
              key={i}
              className={`flex gap-3 text-sm animate-fade-in ${
                i === step ? "opacity-100" : "opacity-70"
              }`}
            >
              <span className="text-[10px] text-foreground/25 pt-1 w-8 shrink-0">R{entry.round}</span>
              <div
                className={`flex-1 ${
                  entry.actor === "buyer"
                    ? "text-accent"
                    : "text-foreground/60"
                }`}
              >
                <span className="font-semibold text-xs">
                  {entry.actor === "buyer" ? "MolBhav" : "Seller"}:
                </span>{" "}
                {entry.text}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Replay controls */}
      <div className="flex items-center gap-3 bg-surface border border-border rounded-xl px-5 py-3">
        <button
          onClick={() => { setStep(0); pause(); }}
          className="p-1.5 hover:bg-surface-2 rounded"
          title="Reset"
        >
          <RotateCcw size={16} />
        </button>
        <button
          onClick={() => setStep((s) => Math.max(s - 1, 0))}
          className="p-1.5 hover:bg-surface-2 rounded"
          disabled={step <= 0}
          title="Step back"
        >
          <SkipBack size={16} />
        </button>
        <button
          onClick={isPlaying ? pause : play}
          className="p-2 bg-accent/15 text-accent hover:bg-accent/25 rounded-lg"
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button
          onClick={() => setStep((s) => Math.min(s + 1, totalSteps - 1))}
          className="p-1.5 hover:bg-surface-2 rounded"
          disabled={step >= totalSteps - 1}
          title="Step forward"
        >
          <SkipForward size={16} />
        </button>
        <div className="flex-1 flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={totalSteps - 1}
            value={step}
            onChange={(e) => setStep(Number(e.target.value))}
            className="flex-1 accent-accent h-1.5 cursor-pointer"
          />
          <span className="text-xs font-mono text-foreground/50 w-16 text-right">
            {step + 1} / {totalSteps}
          </span>
        </div>
      </div>
    </div>
  );
}

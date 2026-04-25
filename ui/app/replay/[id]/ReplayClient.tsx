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
    <div className="max-w-4xl mx-auto px-4 py-16 selection:bg-foreground selection:text-background font-sans">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start justify-between gap-6 mb-12 border-b border-border pb-8">
        <div>
          <Link
            href="/replay"
            className="text-[9px] uppercase tracking-[0.2em] font-black text-foreground/30 hover:text-foreground mb-4 inline-flex items-center gap-2 transition-colors"
          >
            <ArrowLeft size={10} strokeWidth={3} /> Return to Index
          </Link>
          <h1 className="text-4xl font-black uppercase tracking-tighter mb-2 italic">{replay.title}</h1>
          <div className="flex flex-wrap items-center gap-4 text-[10px] uppercase tracking-widest font-bold opacity-30">
            <span className="border border-foreground/20 px-2 py-0.5">{replay.task}</span>
            <span>{replay.rounds} Rounds</span>
            <span className="font-mono">{(replay.surplus * 100).toFixed(1)}% Surplus</span>
            {replay.seller_personality !== "default" && (
              <span className="italic">{replay.seller_personality}</span>
            )}
          </div>
        </div>
        <button
          onClick={copyUrl}
          className="flex items-center gap-3 px-6 py-3 border border-border text-[10px] uppercase tracking-[0.2em] font-black hover:bg-foreground hover:text-background transition-all"
        >
          {copied ? <Check size={12} strokeWidth={3} /> : <Share2 size={12} strokeWidth={3} />}
          {copied ? "Link Copied" : "Share Trace"}
        </button>
      </div>

      {/* Info bar */}
      <div className="grid grid-cols-4 gap-px bg-border border border-border mb-12">
        {[
          { label: "Anchor", value: `₹${replay.seller_anchor}` },
          { label: "Cost", value: `₹${replay.seller_cost}` },
          { label: "Budget", value: `₹${replay.buyer_budget}` },
          { label: "Final", value: `₹${replay.agreed_price}` },
        ].map((m) => (
          <div key={m.label} className="bg-background p-4 text-center">
            <div className="text-[9px] uppercase tracking-widest text-foreground/30 mb-2 font-black">{m.label}</div>
            <div className="text-sm font-mono font-black">{m.value}</div>
          </div>
        ))}
      </div>

      {/* Transcript */}
      <div className="border border-border bg-surface mb-8">
        <div className="px-6 py-4 border-b border-border text-[10px] uppercase tracking-[0.3em] font-black italic opacity-30">
          Trace Execution
        </div>
        <div className="p-8 space-y-6 min-h-[300px]">
          {visibleTranscript.map((entry, i) => (
            <div
              key={i}
              className={`flex gap-8 text-[11px] leading-relaxed animate-fade-in ${
                i === step ? "opacity-100" : "opacity-30"
              }`}
            >
              <span className="text-[9px] font-mono text-foreground/40 pt-1 w-12 shrink-0 italic">[{String(entry.round).padStart(2, '0')}]</span>
              <div className="flex-1">
                <span className="font-black uppercase tracking-widest text-[10px] mr-4">
                  {entry.actor === "buyer" ? "Sauda" : "Seller"}
                </span>
                <span className="font-medium text-foreground tracking-tight">
                  {entry.text}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Replay controls */}
      <div className="flex flex-col md:flex-row items-center gap-8 border border-border p-8 bg-background">
        <div className="flex items-center gap-6">
          <button
            onClick={() => { setStep(0); pause(); }}
            className="p-2 text-foreground/30 hover:text-foreground transition-colors"
            title="Reset"
          >
            <RotateCcw size={16} strokeWidth={3} />
          </button>
          <button
            onClick={() => setStep((s) => Math.max(s - 1, 0))}
            className="p-2 text-foreground/30 hover:text-foreground transition-colors disabled:opacity-0"
            disabled={step <= 0}
            title="Step Back"
          >
            <SkipBack size={16} strokeWidth={3} />
          </button>
          <button
            onClick={isPlaying ? pause : play}
            className="w-12 h-12 bg-foreground text-background flex items-center justify-center hover:invert transition-all"
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause size={20} strokeWidth={3} /> : <Play size={20} fill="currentColor" />}
          </button>
          <button
            onClick={() => setStep((s) => Math.min(s + 1, totalSteps - 1))}
            className="p-2 text-foreground/30 hover:text-foreground transition-colors disabled:opacity-0"
            disabled={step >= totalSteps - 1}
            title="Step Forward"
          >
            <SkipForward size={16} strokeWidth={3} />
          </button>
        </div>
        
        <div className="flex-1 w-full flex items-center gap-6">
          <input
            type="range"
            min={0}
            max={totalSteps - 1}
            value={step}
            onChange={(e) => setStep(Number(e.target.value))}
            className="flex-1 accent-foreground grayscale h-1 cursor-pointer"
          />
          <div className="text-[10px] uppercase tracking-widest font-black text-foreground/40 w-24 text-right">
            Buffer {step + 1} / {totalSteps}
          </div>
        </div>
      </div>
    </div>
  );
}

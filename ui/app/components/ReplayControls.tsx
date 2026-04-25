"use client";

import { Pause, Play, SkipBack, SkipForward, RotateCcw } from "lucide-react";

interface Props {
  currentStep: number;
  totalSteps: number;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStepForward: () => void;
  onStepBack: () => void;
  onReset: () => void;
  onSeek: (step: number) => void;
}

export function ReplayControls({
  currentStep,
  totalSteps,
  isPlaying,
  onPlay,
  onPause,
  onStepForward,
  onStepBack,
  onReset,
  onSeek,
}: Props) {
  return (
    <div className="flex flex-col md:flex-row items-center gap-6 bg-background border border-border p-6">
      <div className="flex items-center gap-4">
        <button 
          onClick={onReset} 
          className="p-2 text-foreground/30 hover:text-foreground transition-colors" 
          title="Reset"
        >
          <RotateCcw size={16} strokeWidth={3} />
        </button>
        <button 
          onClick={onStepBack} 
          className="p-2 text-foreground/30 hover:text-foreground transition-colors disabled:opacity-0" 
          disabled={currentStep <= 0} 
          title="Step back"
        >
          <SkipBack size={16} strokeWidth={3} />
        </button>
        <button
          onClick={isPlaying ? onPause : onPlay}
          className="w-12 h-12 bg-foreground text-background flex items-center justify-center hover:invert transition-all"
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause size={20} strokeWidth={3} /> : <Play size={20} fill="currentColor" />}
        </button>
        <button 
          onClick={onStepForward} 
          className="p-2 text-foreground/30 hover:text-foreground transition-colors disabled:opacity-0" 
          disabled={currentStep >= totalSteps} 
          title="Step forward"
        >
          <SkipForward size={16} strokeWidth={3} />
        </button>
      </div>

      <div className="flex-1 w-full flex items-center gap-4">
        <input
          type="range"
          min={0}
          max={totalSteps}
          value={currentStep}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="flex-1 accent-foreground grayscale h-1 cursor-pointer"
        />
        <span className="text-[10px] uppercase font-black tracking-widest text-foreground/40 w-20 text-right">
          {currentStep} / {totalSteps}
        </span>
      </div>
    </div>
  );
}

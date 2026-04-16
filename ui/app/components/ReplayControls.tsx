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
    <div className="flex items-center gap-3 bg-surface border border-border rounded-lg px-4 py-2">
      <button onClick={onReset} className="p-1.5 hover:bg-surface-2 rounded" title="Reset">
        <RotateCcw size={16} />
      </button>
      <button onClick={onStepBack} className="p-1.5 hover:bg-surface-2 rounded" disabled={currentStep <= 0} title="Step back">
        <SkipBack size={16} />
      </button>
      <button
        onClick={isPlaying ? onPause : onPlay}
        className="p-2 bg-accent/15 text-accent hover:bg-accent/25 rounded-lg"
        title={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <button onClick={onStepForward} className="p-1.5 hover:bg-surface-2 rounded" disabled={currentStep >= totalSteps} title="Step forward">
        <SkipForward size={16} />
      </button>

      {/* Scrubber */}
      <div className="flex-1 flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={totalSteps}
          value={currentStep}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="flex-1 accent-accent h-1.5 cursor-pointer"
        />
        <span className="text-xs font-mono text-foreground/50 w-16 text-right">
          {currentStep} / {totalSteps}
        </span>
      </div>
    </div>
  );
}

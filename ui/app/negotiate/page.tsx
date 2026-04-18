"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  apiGet,
  apiPost,
  type BazaarObservation,
  type ResetResponse,
  type StepResponse,
  type TaskInfo,
} from "../lib/api";
import { NegotiationChart } from "../components/NegotiationChart";
import { TellsDisplay } from "../components/TellsDisplay";

interface HistoryEntry {
  round: number;
  actor: string;
  action: string;
  price: number | null;
}

export default function NegotiatePage() {
  const [tasks, setTasks] = useState<Record<string, TaskInfo>>({});
  const [selectedTask, setSelectedTask] = useState("single_deal");
  const [personality, setPersonality] = useState<string>("");
  const [obs, setObs] = useState<BazaarObservation | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [messages, setMessages] = useState<Array<{ round: number; text: string; type: string }>>([]);
  const [totalReward, setTotalReward] = useState(0);
  const [offerPrice, setOfferPrice] = useState(30);
  const [done, setDone] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiGet<Record<string, TaskInfo>>("/tasks").then(setTasks).catch(() => {});
  }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages]);

  const startNegotiation = useCallback(async () => {
    setLoading(true);
    try {
      const body: Record<string, unknown> = { task: selectedTask };
      if (personality) body.seller_personality = personality;
      const res = await apiPost<ResetResponse>("/reset", body);
      setObs(res.observation);
      setHistory([
        {
          round: 0,
          actor: "seller",
          action: "open",
          price: res.observation.seller_asking_price,
        },
      ]);
      setMessages([
        { round: 0, text: res.observation.message, type: "seller" },
      ]);
      setTotalReward(0);
      setDone(false);
      setScore(null);
      setOfferPrice(Math.round(res.observation.seller_asking_price * 0.5));
    } catch (e) {
      setMessages([{ round: 0, text: `Error: ${e}`, type: "error" }]);
    }
    setLoading(false);
  }, [selectedTask, personality]);

  const submitAction = useCallback(
    async (action: string, price?: number) => {
      if (!obs || done) return;
      setLoading(true);
      try {
        const body: Record<string, unknown> = { action };
        if (price !== undefined) body.price = price;
        const res = await apiPost<StepResponse>("/step", body);
        const newObs = res.observation;
        const info = (res.info || {}) as {
          episode_done?: boolean;
          episode?: number;
          next_episode?: number;
        };

        // Detect invalid accept: server returns a non-advancing turn with this message.
        const invalidAccept =
          action === "accept" &&
          typeof newObs.message === "string" &&
          newObs.message.toLowerCase().includes("no seller offer to accept");

        // Detect episode rollover (career mode): server resets and returns new opening obs.
        const episodeRolled = Boolean(info.episode_done);

        // Update history
        const newHistory = [...history];
        if (!invalidAccept) {
          if (action === "offer" && price !== undefined) {
            newHistory.push({
              round: newObs.current_round,
              actor: "buyer",
              action: "offer",
              price,
            });
          }
          if (action === "accept") {
            newHistory.push({
              round: newObs.current_round,
              actor: "buyer",
              action: "accept",
              price: obs.opponent_last_offer,
            });
          }
          if (action === "walk") {
            newHistory.push({
              round: newObs.current_round,
              actor: "buyer",
              action: "walk",
              price: null,
            });
          }
          if (
            !episodeRolled &&
            newObs.opponent_last_offer !== obs.opponent_last_offer
          ) {
            newHistory.push({
              round: newObs.current_round,
              actor: "seller",
              action: newObs.deal_outcome === "deal" ? "accept" : "counter",
              price: newObs.opponent_last_offer,
            });
          }
        }

        setHistory(newHistory);
        setObs(newObs);
        setTotalReward((r) => r + res.reward);

        setMessages((m) => {
          const next = [...m];
          if (invalidAccept) {
            next.push({
              round: newObs.current_round,
              text: `Invalid: ${newObs.message}`,
              type: "error",
            });
            return next;
          }
          const actionLabel =
            action === "offer"
              ? `You offer ${price?.toFixed(0)} rupees`
              : action === "accept"
              ? "You accept"
              : "You walk away";
          next.push({
            round: newObs.current_round,
            text: actionLabel,
            type: "buyer",
          });
          if (episodeRolled) {
            next.push({
              round: newObs.current_round,
              text: `— Episode ${info.episode ?? "?"} ended · Episode ${
                info.next_episode ?? newObs.episode_number
              } begins (${newObs.item_name}) —`,
              type: "divider",
            });
          }
          next.push({
            round: newObs.current_round,
            text: newObs.message,
            type: "seller",
          });
          return next;
        });

        if (res.done) {
          setDone(true);
          try {
            const scoreRes = await apiGet<{ score: number }>("/score");
            setScore(scoreRes.score);
          } catch {}
        }
      } catch (e) {
        setMessages((m) => [...m, { round: 0, text: `Error: ${e}`, type: "error" }]);
      }
      setLoading(false);
    },
    [obs, done, history]
  );

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-6">Manual Negotiation</h1>

      {/* Setup bar */}
      <div className="flex flex-wrap items-end gap-4 mb-6 p-4 rounded-xl bg-surface border border-border">
        <div>
          <label className="block text-xs text-foreground/50 mb-1">Task</label>
          <select
            value={selectedTask}
            onChange={(e) => setSelectedTask(e.target.value)}
            className="bg-surface-2 border border-border rounded px-3 py-1.5 text-sm"
          >
            {Object.entries(tasks).map(([name, t]) => (
              <option key={name} value={name}>
                {name} ({t.difficulty})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-foreground/50 mb-1">
            Personality Override
          </label>
          <select
            value={personality}
            onChange={(e) => setPersonality(e.target.value)}
            className="bg-surface-2 border border-border rounded px-3 py-1.5 text-sm"
          >
            <option value="">Task default</option>
            <option value="default">Default</option>
            <option value="deceptive">Deceptive</option>
            <option value="impatient">Impatient</option>
            <option value="collaborative">Collaborative</option>
          </select>
        </div>
        <button
          onClick={startNegotiation}
          disabled={loading}
          className="px-4 py-1.5 bg-accent text-background rounded font-medium text-sm hover:bg-accent/90 disabled:opacity-50"
        >
          {obs ? "Restart" : "Start Negotiation"}
        </button>
      </div>

      {!obs ? (
        <div className="text-center py-20 text-foreground/40">
          Select a task and click Start Negotiation to begin.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Chart + controls */}
          <div className="lg:col-span-2 space-y-4">
            {/* Metrics */}
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: "Round", value: `${obs.current_round} / ${obs.max_rounds}` },
                { label: "Budget", value: `${obs.own_private_budget.toFixed(0)}` },
                { label: "Seller Ask", value: `${obs.opponent_last_offer?.toFixed(0) || "-"}` },
                { label: "Reward", value: totalReward.toFixed(3) },
              ].map((m) => (
                <div key={m.label} className="p-3 rounded-lg bg-surface border border-border">
                  <div className="text-xs text-foreground/50">{m.label}</div>
                  <div className="text-lg font-semibold font-mono">{m.value}</div>
                </div>
              ))}
            </div>

            {/* Chart */}
            <div className="rounded-xl bg-surface border border-border p-4">
              <NegotiationChart
                history={history}
                budget={obs.own_private_budget}
                cost={tasks[selectedTask]?.description.includes("30") ? 30 : 30}
                dealPrice={obs.deal_outcome === "deal" ? obs.opponent_last_offer : null}
              />
            </div>

            {/* Action controls */}
            {!done && (
              <div className="flex items-end gap-3 p-4 rounded-xl bg-surface border border-border">
                <div className="flex-1">
                  <label className="block text-xs text-foreground/50 mb-1">
                    Your Offer Price
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={obs.own_private_budget}
                    value={offerPrice}
                    onChange={(e) => setOfferPrice(Number(e.target.value))}
                    className="w-full accent-accent"
                  />
                  <div className="flex justify-between text-xs text-foreground/40 mt-1">
                    <span>1</span>
                    <span className="text-accent font-mono font-bold text-base">
                      {offerPrice}
                    </span>
                    <span>{obs.own_private_budget}</span>
                  </div>
                </div>
                <button
                  onClick={() => submitAction("offer", offerPrice)}
                  disabled={loading}
                  className="px-4 py-2 bg-accent text-background rounded font-medium text-sm hover:bg-accent/90 disabled:opacity-50"
                >
                  Offer
                </button>
                <button
                  onClick={() => submitAction("accept")}
                  disabled={loading}
                  className="px-4 py-2 bg-green-600 text-white rounded font-medium text-sm hover:bg-green-700 disabled:opacity-50"
                >
                  Accept
                </button>
                <button
                  onClick={() => submitAction("walk")}
                  disabled={loading}
                  className="px-4 py-2 bg-danger/80 text-white rounded font-medium text-sm hover:bg-danger disabled:opacity-50"
                >
                  Walk
                </button>
              </div>
            )}

            {/* Score banner */}
            {done && score !== null && (
              <div
                className={`p-4 rounded-xl text-center font-semibold animate-fade-in ${
                  score >= 0.3
                    ? "bg-green-500/10 border border-green-500/20 text-green-400"
                    : "bg-danger/10 border border-danger/20 text-danger"
                }`}
              >
                Final Score: {score.toFixed(4)}{" "}
                {score >= 0.3 ? "-- Nice deal!" : "-- Room for improvement"}
              </div>
            )}
          </div>

          {/* Right: Tells + Chat log */}
          <div className="space-y-4">
            {/* Tells */}
            <TellsDisplay
              tells={obs.tells}
              personality={obs.seller_personality}
            />

            {/* Chat log */}
            <div className="rounded-xl bg-surface border border-border">
              <div className="px-4 py-2 border-b border-border text-sm font-medium">
                Negotiation Log
              </div>
              <div
                ref={logRef}
                className="p-3 max-h-80 overflow-y-auto space-y-2"
              >
                {messages.map((msg, i) => {
                  if (msg.type === "divider") {
                    return (
                      <div
                        key={i}
                        className="text-xs text-foreground/40 italic text-center py-1 border-t border-border/50 mt-2"
                      >
                        {msg.text}
                      </div>
                    );
                  }
                  return (
                    <div
                      key={i}
                      className={`text-sm animate-fade-in ${
                        msg.type === "buyer"
                          ? "text-accent"
                          : msg.type === "error"
                          ? "text-danger"
                          : "text-foreground/70"
                      }`}
                    >
                      <span className="text-xs text-foreground/30 mr-2">
                        R{msg.round}
                      </span>
                      {msg.text}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiPost, apiGet } from "../lib/api";
import { Send, Loader2, Keyboard, RefreshCw, Brain } from "lucide-react";

/* ── Highlight types ───────────────────────────────────── */
interface HighlightSpan {
  start: number;
  end: number;
  text: string;
  signal: "urgency" | "deception" | "confidence" | "condition";
  score: number;
  explanation: string;
}

interface HighlightResponse {
  spans: HighlightSpan[];
  aggregate: Record<string, number>;
}

const SIGNAL_COLOR: Record<string, string> = {
  urgency: "var(--warn)",
  deception: "var(--bad)",
  confidence: "var(--accent-2)",
  condition: "var(--good)",
};

/* ── Types ─────────────────────────────────────────────── */
interface HistoryEntry {
  round: number;
  actor: string;
  action: string;
  price: number | null;
}

interface TellSignal {
  key: string;
  label: string;
  value: number;
  group: "verbal" | "behavioral" | "condition";
  synthetic?: boolean;
}

interface Listing {
  id: string;
  category: string;
  title: string;
  description: string;
  listed_price: number;
  buyer_target: number;
  seller_target: number;
  image: string | null;
}

interface RoleBrief {
  asking_price: number;
  reservation_price: number;
  bonus_per_unit: number;
  max_bonus: number;
  persona: "default" | "firm" | "flexible" | "deceptive";
  pressure: string;
}

/* Build a Chicago-HAI-style role brief from a listing */
function makeBrief(listing: Listing): RoleBrief {
  const asking = listing.listed_price;
  const reservation = Math.round(asking * 0.78);
  const persona = (["default", "firm", "flexible"] as const)[
    Math.floor(Math.random() * 3)
  ];
  const pressureOptions = [
    "House on the market 1 month, no firm offer yet.",
    "Friend listed similar item; you want to beat their price.",
    "Need to sell within 2 weeks — moving cities.",
    "Listed last weekend, two viewers but no offers.",
    "Rent due in 10 days; this would cover it.",
  ];
  const pressure = pressureOptions[Math.floor(Math.random() * pressureOptions.length)];
  const gap = Math.max(0, asking - reservation);
  const max_bonus = Math.max(1, Math.round(gap * 0.10));
  return {
    asking_price: asking,
    reservation_price: reservation,
    bonus_per_unit: 1,
    max_bonus,
    persona,
    pressure,
  };
}

/* ── Listing card ──────────────────────────────────────── */
function ListingCard({ listing, brief }: { listing: Listing; brief: RoleBrief }) {
  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <div className="grid md:grid-cols-[1fr_1.6fr] gap-0">
        <div className="bg-surface-2 aspect-square md:aspect-auto md:min-h-full flex items-center justify-center p-8 border-b md:border-b-0 md:border-r border-border">
          <div className="text-eyebrow opacity-60 text-center">
            {listing.category}
          </div>
        </div>
        <div className="p-6 md:p-8">
          <div className="text-eyebrow mb-3">Listing #{listing.id}</div>
          <h3 className="text-2xl md:text-[28px] font-semibold tracking-tight leading-tight mb-4">
            {listing.title}
          </h3>
          <p className="text-fg2 text-sm leading-relaxed line-clamp-4 mb-6">
            {listing.description}
          </p>
          <div className="flex items-baseline gap-3">
            <span className="text-eyebrow">Listed</span>
            <span className="text-3xl font-mono font-medium tabular-nums">
              ${listing.listed_price.toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* Role brief — visible only to seller */}
      <div className="border-t border-border bg-surface-2/40 p-6 md:p-8">
        <div className="text-eyebrow mb-4">Your role · seller (private)</div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Brief label="Asking price" value={`$${brief.asking_price.toLocaleString()}`} />
          <Brief label="Reservation (secret)" value={`$${brief.reservation_price.toLocaleString()}`} accent="warn" />
          <Brief label="Bonus per $10 above" value={`+$${brief.bonus_per_unit}`} />
          <Brief label="Max bonus" value={`$${brief.max_bonus}`} />
        </div>
        <div className="mt-5 grid sm:grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-eyebrow mb-1.5">Persona</div>
            <div className="text-foreground capitalize">{brief.persona}</div>
          </div>
          <div>
            <div className="text-eyebrow mb-1.5">Context</div>
            <div className="text-foreground italic">{brief.pressure}</div>
          </div>
        </div>
        <div className="mt-5 text-fg3 text-xs leading-relaxed border-t border-border pt-4">
          You earn <span className="text-foreground">${brief.bonus_per_unit}</span> bonus per
          $10 above your reservation, capped at ${brief.max_bonus}. You earn
          nothing if you sell below ${brief.reservation_price.toLocaleString()} or
          fail to close. <em>Adapted from the Chicago HAI / Kellogg study setup.</em>
        </div>
      </div>
    </div>
  );
}

function Brief({ label, value, accent }: { label: string; value: string; accent?: "warn" | "good" }) {
  const colorClass = accent === "warn"
    ? "text-warn"
    : accent === "good"
    ? "text-good"
    : "text-foreground";
  return (
    <div>
      <div className="text-eyebrow mb-1.5">{label}</div>
      <div className={`text-lg font-mono font-medium tabular-nums ${colorClass}`}>{value}</div>
    </div>
  );
}

/* ── Tells panel ───────────────────────────────────────── */
function TellsPanel({ tells }: { tells: TellSignal[] }) {
  const groups = {
    verbal: tells.filter((t) => t.group === "verbal"),
    behavioral: tells.filter((t) => t.group === "behavioral"),
    condition: tells.filter((t) => t.group === "condition"),
  };
  const labels: Record<string, string> = {
    verbal: "Verbal signals",
    behavioral: "Behavioral (synthetic)",
    condition: "Condition",
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <div className="text-eyebrow mb-5">What Sauda reads</div>
      {Object.entries(groups).map(([group, signals]) =>
        signals.length > 0 ? (
          <div key={group} className="mb-5 last:mb-0">
            <div className="text-[10px] uppercase tracking-widest text-fg3 mb-3">
              {labels[group]}
            </div>
            <div className="space-y-2.5">
              {signals.map((s) => {
                const pct = Math.max(0, Math.min(100, s.value * 100));
                const color = s.value > 0.7 ? "var(--bad)" : s.value > 0.4 ? "var(--warn)" : "var(--good)";
                return (
                  <div key={s.key} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-fg2 font-mono">
                        {s.label}
                        {s.synthetic && <span className="ml-1 opacity-40">∗</span>}
                      </span>
                      <span className="font-mono tabular-nums text-foreground">
                        {s.value.toFixed(2)}
                      </span>
                    </div>
                    <div className="h-1 bg-surface-2 rounded-full overflow-hidden">
                      <div
                        className="h-full transition-all duration-500"
                        style={{ width: `${pct}%`, background: color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null
      )}
      <div className="text-[10px] text-fg3 mt-5 pt-4 border-t border-border leading-relaxed">
        ∗ synthetic. Real NLP extractor wires in post-venue.
      </div>
    </div>
  );
}

/* ── Outside-buyer ticker (simulated pressure) ────────── */
function PressureTicker({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <div className="rounded-xl border border-warn/30 bg-warn/5 p-4 flex items-start gap-3">
      <span className="text-warn pulse-dot mt-1 inline-block w-1.5 h-1.5 rounded-full bg-warn" />
      <div className="flex-1 text-sm text-foreground/90 italic leading-relaxed">
        {messages[messages.length - 1]}
      </div>
    </div>
  );
}

function makeTickerMessage(round: number, listed: number): string {
  const variants = [
    `Another buyer on the listing site just messaged: "Is ${Math.round(listed * 0.65)} firm?"`,
    `Your friend texts: "I saw a similar one go for $${Math.round(listed * 0.7)} yesterday."`,
    `Someone watching the listing just bookmarked it. Round ${round}.`,
    `A new tab opens — "comparable item sold for $${Math.round(listed * 0.74)}."`,
    `You glance at your phone: "are you still selling?"`,
  ];
  return variants[round % variants.length];
}

/* ── Highlighted bubble: marks spans on the message ─────── */
function HighlightedText({
  text,
  spans,
}: {
  text: string;
  spans: HighlightSpan[];
}) {
  if (!spans || spans.length === 0) return <>{text}</>;

  // Resolve overlapping spans: keep highest score per char position
  const claimed = new Array<HighlightSpan | null>(text.length).fill(null);
  for (const s of [...spans].sort((a, b) => b.score - a.score)) {
    for (let i = s.start; i < s.end && i < text.length; i++) {
      if (claimed[i] === null) claimed[i] = s;
    }
  }

  // Build runs of consecutive same-span (or null) chars
  type Run = { start: number; end: number; span: HighlightSpan | null };
  const runs: Run[] = [];
  let cur: Run | null = null;
  for (let i = 0; i < text.length; i++) {
    const span = claimed[i];
    if (cur && cur.span === span) {
      cur.end = i + 1;
    } else {
      if (cur) runs.push(cur);
      cur = { start: i, end: i + 1, span };
    }
  }
  if (cur) runs.push(cur);

  return (
    <>
      {runs.map((r, i) => {
        const slice = text.slice(r.start, r.end);
        if (r.span === null) return <span key={i}>{slice}</span>;
        const color = SIGNAL_COLOR[r.span.signal] || "var(--accent)";
        return (
          <mark
            key={i}
            title={`${r.span.signal} ${r.span.score.toFixed(2)} — ${r.span.explanation}`}
            className="group relative cursor-help bg-transparent"
            style={{
              borderBottom: `2px solid ${color}`,
              padding: "0 1px",
              color: "inherit",
            }}
          >
            {slice}
          </mark>
        );
      })}
    </>
  );
}

/* ── Thinking beat: 3-step animation while buyer responds ── */
function ThinkingBeat({ stage }: { stage: 0 | 1 | 2 | 3 }) {
  const stages = [
    "Reading your message…",
    "Extracting tells (urgency, deception, condition)…",
    "Running Bayesian posterior over flexibility…",
    "Choosing offer + reply…",
  ];
  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 flex items-start gap-3">
      <Brain size={16} className="text-accent shrink-0 mt-0.5 animate-pulse" />
      <div className="flex-1 space-y-1">
        {stages.slice(0, stage + 1).map((s, i) => (
          <div
            key={i}
            className={`text-sm transition-opacity ${
              i === stage ? "text-foreground" : "text-fg3"
            }`}
          >
            {i === stage ? "→ " : "✓ "}
            {s}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Main page ─────────────────────────────────────────── */
export default function SellPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [listingIdx, setListingIdx] = useState(0);
  const [brief, setBrief] = useState<RoleBrief | null>(null);

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [messages, setMessages] = useState<Array<{ text: string; type: string; highlights?: HighlightSpan[] }>>([]);
  const [tickerMessages, setTickerMessages] = useState<string[]>([]);
  const [lastBuyerOffer, setLastBuyerOffer] = useState<number | null>(null);
  const [counterPrice, setCounterPrice] = useState(0);
  const [done, setDone] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [thinkingStage, setThinkingStage] = useState<0 | 1 | 2 | 3 | -1>(-1);
  const [currentTells, setCurrentTells] = useState<TellSignal[]>([]);
  const [agentHealth, setAgentHealth] = useState<"checking" | "live" | "degraded">("checking");
  const logRef = useRef<HTMLDivElement>(null);

  // Probe Sauda inference endpoint on mount
  useEffect(() => {
    let cancelled = false;
    apiGet<{ status: string; live_agent_available: boolean }>("/sauda/health")
      .then((r) => {
        if (cancelled) return;
        setAgentHealth(r.live_agent_available ? "live" : "degraded");
      })
      .catch(() => {
        if (!cancelled) setAgentHealth("degraded");
      });
    return () => { cancelled = true; };
  }, []);

  // Load curated listings once
  useEffect(() => {
    fetch("/listings.json")
      .then((r) => r.json())
      .then((data: Listing[]) => {
        setListings(data);
        const idx = Math.floor(Math.random() * data.length);
        setListingIdx(idx);
        setBrief(makeBrief(data[idx]));
      })
      .catch((e) => console.error("listings load failed", e));
  }, []);

  const currentListing = listings[listingIdx];

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages]);

  // Init counter slider midpoint when listing loads
  useEffect(() => {
    if (currentListing && brief) {
      setCounterPrice(Math.round((brief.asking_price + brief.reservation_price) / 2));
    }
  }, [currentListing, brief]);

  const cycleListing = () => {
    if (listings.length === 0) return;
    const next = (listingIdx + 1) % listings.length;
    setListingIdx(next);
    setBrief(makeBrief(listings[next]));
  };

  const generateTells = (round: number, buyerPrice: number | null): TellSignal[] => {
    if (!brief) return [];
    const progress = Math.min(1, round / 8);
    const pressure = buyerPrice ? Math.max(0, 1 - buyerPrice / brief.asking_price) : 0;
    return [
      { key: "urgency", label: "Urgency", value: Math.min(1, 0.2 + progress * 0.5 + Math.random() * 0.1), group: "verbal" },
      { key: "confidence", label: "Confidence", value: Math.max(0.1, 0.8 - progress * 0.3 + Math.random() * 0.1), group: "verbal" },
      { key: "deception", label: "Deception cue", value: Math.min(1, 0.1 + Math.random() * 0.3 + pressure * 0.2), group: "verbal" },
      { key: "speed", label: "Offer speed", value: Math.min(1, 0.3 + progress * 0.4), group: "verbal" },
      { key: "fidget", label: "Fidget level", value: Math.min(1, 0.15 + progress * 0.35 + Math.random() * 0.1), group: "behavioral", synthetic: true },
      { key: "condition", label: "Condition score", value: 0.7 + Math.random() * 0.2, group: "condition" },
    ];
  };

  // Pre-message tells: shown on round 1 before the seller has typed anything.
  // The buyer truly has no verbal signal to read yet — only the listing exists.
  // Verbal/behavioral default to 0 (we'll populate from /highlight after the
  // seller speaks); condition is derived from the listing text itself so it can
  // already have a value pre-conversation.
  const baselineTells = (): TellSignal[] => [
    { key: "urgency",    label: "Urgency",         value: 0, group: "verbal" },
    { key: "confidence", label: "Confidence",      value: 0, group: "verbal" },
    { key: "deception",  label: "Deception cue",   value: 0, group: "verbal" },
    { key: "speed",      label: "Offer speed",     value: 0, group: "verbal" },
    { key: "fidget",     label: "Fidget level",    value: 0, group: "behavioral", synthetic: true },
    { key: "condition",  label: "Condition score", value: 0, group: "condition" },
  ];

  const startNegotiation = useCallback(async () => {
    if (!brief || !currentListing) return;
    setLoading(true);
    try {
      const res = await apiPost<{
        round: number;
        buyer_action: string;
        buyer_price: number | null;
        message: string;
        history: HistoryEntry[];
      }>("/seller-mode/reset", {
        // single_deal is the canonical seller-mode task; the server scales
        // budget/cost from opening_price so any listing magnitude works.
        task: "single_deal",
        strategy: "sauda",  // HF endpoint primary; server falls back to rule if unconfigured
        seed: Math.floor(Math.random() * 10000),
        opening_price: brief.asking_price,
        item_name: currentListing.title,
        listing_price: currentListing.listed_price,
      });

      setHistory(res.history);
      setLastBuyerOffer(res.buyer_price);
      setMessages([
        { text: `You list "${currentListing.title}" at $${brief.asking_price}.`, type: "system" },
        { text: res.message, type: "buyer" },
      ]);
      setDone(false);
      setResult(null);
      setStarted(true);
      // Show all-zero tells on reset: the seller (user) hasn't typed yet,
      // so there's nothing for the buyer to read. The Fidget bar stays at
      // 0 too — synthetic signals shouldn't pretend to extract from silence.
      setCurrentTells(baselineTells());
      setTickerMessages([]);
    } catch (e) {
      // Render the error to the chat so the user can see why the buyer
      // didn't respond — otherwise the page just sits in a "loading then
      // nothing" state and the error is invisible in the dev console.
      setMessages([
        { text: `You list "${currentListing.title}" at $${brief.asking_price}.`, type: "system" },
        { text: `Buyer never responded. Backend error: ${String(e)}`, type: "error" },
      ]);
      setStarted(true);
      setDone(true);
      setResult({
        outcome: "error",
        agreed_price: null,
        buyer_score: 0,
        seller_profit: 0,
      });
    }
    setLoading(false);
  }, [brief, currentListing]);

  const submitCounter = useCallback(
    async (price: number, sellerText?: string) => {
      if (done || !brief) return;
      setLoading(true);
      const messageText = sellerText && sellerText.trim()
        ? sellerText.trim()
        : `Counter at $${price}.`;

      // Push seller bubble immediately (no highlights yet)
      setMessages((m) => [...m, { text: messageText, type: "seller" }]);

      // Stage the thinking beat: 0 → 1 → 2 → 3 over ~1.6s while we fetch
      setThinkingStage(0);
      const beatTimers = [
        setTimeout(() => setThinkingStage(1), 350),
        setTimeout(() => setThinkingStage(2), 800),
        setTimeout(() => setThinkingStage(3), 1300),
      ];

      try {
        // Kick off both calls in parallel
        const highlightPromise = apiPost<HighlightResponse>("/highlight", {
          message: messageText,
        }).catch(() => ({ spans: [], aggregate: {} } as HighlightResponse));

        const stepPromise = apiPost<{
          round: number;
          message: string;
          buyer_action: string;
          buyer_price: number | null;
          done: boolean;
          outcome?: string;
          agreed_price?: number;
          seller_profit?: number;
          buyer_score?: number;
          history: HistoryEntry[];
        }>("/seller-mode/step", { price });

        const [highlightRes, res] = await Promise.all([highlightPromise, stepPromise]);

        // Backfill the seller bubble with highlights, then push buyer reply
        setMessages((m) => {
          const next = [...m];
          // The seller bubble we just pushed is the last "seller" entry
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].type === "seller") {
              next[i] = { ...next[i], highlights: highlightRes.spans };
              break;
            }
          }
          next.push({ text: res.message, type: "buyer" });
          return next;
        });

        setHistory(res.history);

        // Inject pressure ticker message every 2 rounds
        if (res.round % 2 === 0 && currentListing && !res.done) {
          setTickerMessages((tm) => [...tm, makeTickerMessage(res.round, currentListing.listed_price)]);
        }

        if (res.buyer_price != null) {
          setLastBuyerOffer(res.buyer_price);
          if (!res.done) {
            setCounterPrice(Math.round(((res.buyer_price ?? 0) + price) / 2));
          }
        }

        // Hydrate the tells panel from the real /highlight aggregate when available.
        // Behavioral fidget is synthetic but should be a deterministic function of
        // signal — not random jitter. Tie it to (round depth × price-pressure)
        // so it monotonically reflects how stressed a real seller would look,
        // and stays 0 when nothing has been said.
        const agg = highlightRes.aggregate || {};
        const askPrice = brief?.asking_price ?? 0;
        const pressure = res.buyer_price && askPrice
          ? Math.max(0, 1 - res.buyer_price / askPrice)
          : 0;
        // Only show fidget once the seller has actually typed a message
        // (not just the auto "Counter at $X" template that fires when the
        // user submits without text). Synthetic but at least signal-driven.
        const sellerSpoke = !!(sellerText && sellerText.trim());
        const fidget = sellerSpoke
          ? Math.min(1, (res.round / 8) * 0.4 + pressure * 0.4)
          : 0;
        const realTells: TellSignal[] = [
          { key: "urgency", label: "Urgency", value: agg.urgency ?? 0, group: "verbal" },
          { key: "deception", label: "Deception", value: agg.deception ?? 0, group: "verbal" },
          { key: "confidence", label: "Confidence", value: agg.confidence ?? 0, group: "verbal" },
          { key: "condition", label: "Condition", value: agg.condition ?? 0, group: "condition" },
          { key: "fidget", label: "Fidget level", value: fidget, group: "behavioral", synthetic: true },
        ];
        setCurrentTells(realTells);

        if (res.done) {
          setDone(true);
          setResult(res as Record<string, unknown>);
        }
      } catch (e) {
        setMessages((m) => [...m, { text: `Error: ${e}`, type: "error" }]);
      } finally {
        beatTimers.forEach(clearTimeout);
        setThinkingStage(-1);
        setLoading(false);
      }
    },
    [done, brief, currentListing]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!started || done) return;
      const tgt = e.target as HTMLElement;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA")) return;
      if (e.key === "Enter" && !e.shiftKey && !loading) {
        e.preventDefault();
        submitCounter(counterPrice);
      }
      if (e.key === "Escape" && lastBuyerOffer && !loading) {
        submitCounter(lastBuyerOffer);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [started, done, loading, counterPrice, lastBuyerOffer, submitCounter]);

  // Outcome math (symmetric scoring)
  const sellerShare = (() => {
    if (!result?.agreed_price || !brief) return null;
    const agreed = result.agreed_price as number;
    const buyerBudget = brief.asking_price * 1.05; // proxy — env knows the real one
    const zopa = buyerBudget - brief.reservation_price;
    if (zopa <= 0) return null;
    return (agreed - brief.reservation_price) / zopa;
  })();

  const buyerShare = sellerShare !== null ? 1 - sellerShare : null;
  const earnedBonus = brief && result?.agreed_price
    ? Math.min(
        brief.max_bonus,
        Math.max(0, Math.floor(((result.agreed_price as number) - brief.reservation_price) / 10) * brief.bonus_per_unit)
      )
    : 0;

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="mb-10">
        <div className="flex items-start justify-between gap-4 mb-2">
          <h1 className="text-h1">Play</h1>
          <div
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-mono tracking-wide ${
              agentHealth === "live"
                ? "border-good/40 bg-good/10 text-good"
                : agentHealth === "degraded"
                ? "border-warn/40 bg-warn/10 text-warn"
                : "border-border bg-surface-2/40 text-fg3"
            }`}
            title={
              agentHealth === "live"
                ? "Live HF Inference Endpoint serving Sauda v2 (Llama-3.1-8B + QLoRA, SFT+GRPO)"
                : agentHealth === "degraded"
                ? "HF endpoint unreachable — heuristic fallback active"
                : "Probing inference endpoint…"
            }
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                agentHealth === "live"
                  ? "bg-good shadow-[0_0_6px_var(--good)] animate-pulse"
                  : agentHealth === "degraded"
                  ? "bg-warn"
                  : "bg-fg3"
              }`}
              aria-hidden
            />
            {agentHealth === "live"
              ? "HF endpoint connected · Sauda v2 live"
              : agentHealth === "degraded"
              ? "HF endpoint offline · heuristic fallback"
              : "Connecting to Sauda…"}
          </div>
        </div>
        <p className="text-meta">
          You&apos;re the seller. Sauda is the buyer. Mirrors the Chicago HAI Kellogg setup.
        </p>
      </div>

      {/* Pre-game: listing + role brief + start */}
      {!started && currentListing && brief && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="text-eyebrow">Round 0 · Listing brief</div>
            <button
              onClick={cycleListing}
              className="inline-flex items-center gap-2 text-meta hover:text-foreground transition-colors"
            >
              <RefreshCw size={12} />
              try a different one
            </button>
          </div>
          <ListingCard listing={currentListing} brief={brief} />
          <div className="flex flex-wrap gap-3 justify-center md:justify-start pt-2">
            <button
              onClick={startNegotiation}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-md bg-accent text-background px-6 py-3 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : null}
              Open at ${brief.asking_price.toLocaleString()}
            </button>
            <div className="text-fg3 text-xs self-center max-w-md">
              Once you open, the buyer responds. Your reservation price stays secret.
            </div>
          </div>
        </div>
      )}

      {/* Game state */}
      {started && brief && currentListing && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-5">
            {/* Item summary strip */}
            <div className="rounded-xl border border-border bg-surface px-5 py-4 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-4">
                <div className="text-eyebrow">selling</div>
                <div className="text-foreground text-sm font-medium truncate max-w-md">
                  {currentListing.title}
                </div>
              </div>
              <div className="flex items-center gap-5 text-sm font-mono tabular-nums">
                <span className="text-fg3">res ${brief.reservation_price}</span>
                <span className="text-fg2">ask ${brief.asking_price}</span>
                <span className="text-foreground">
                  bid {lastBuyerOffer ? `$${Math.round(lastBuyerOffer)}` : "—"}
                </span>
              </div>
            </div>

            {/* Pressure ticker */}
            <PressureTicker messages={tickerMessages} />

            {/* Chat */}
            <div className="rounded-xl border border-border bg-surface overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                <span className="text-eyebrow">Conversation</span>
                {loading && (
                  <span className="text-meta inline-flex items-center gap-2">
                    <Loader2 size={12} className="animate-spin" />
                    buyer thinking...
                  </span>
                )}
              </div>
              <div ref={logRef} className="p-5 h-[380px] overflow-y-auto space-y-3">
                {messages.map((m, i) => {
                  const isBuyer = m.type === "buyer";
                  const isSeller = m.type === "seller";
                  return (
                    <div
                      key={i}
                      className={`flex ${isBuyer ? "justify-start" : isSeller ? "justify-end" : "justify-center"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                          isBuyer
                            ? "bg-surface-2 text-foreground"
                            : isSeller
                            ? "bg-accent/10 border border-accent/30 text-foreground"
                            : "text-fg3 text-xs italic"
                        }`}
                      >
                        {isSeller && m.highlights ? (
                          <HighlightedText text={m.text} spans={m.highlights} />
                        ) : (
                          m.text
                        )}
                      </div>
                    </div>
                  );
                })}
                {thinkingStage >= 0 && (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] w-full">
                      <ThinkingBeat stage={thinkingStage as 0 | 1 | 2 | 3} />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Counter input */}
            {!done && (
              <div className="rounded-xl border border-border bg-surface p-6 space-y-5">
                {/* Free-text message: what makes the highlighting actually mark something */}
                <div>
                  <label className="text-eyebrow block mb-2">
                    Say something (Sauda will read it for tells)
                  </label>
                  <SellerTextInput
                    counterPrice={counterPrice}
                    onSubmit={(text) => submitCounter(counterPrice, text)}
                    disabled={loading}
                  />
                  <div className="text-meta mt-2">
                    Try: <span className="text-foreground/70">&quot;last price hai bhai, teen aur log dekh rahe&quot;</span>
                    {" "}— Sauda will underline the urgency and deception cues it picks up.
                  </div>
                </div>
                <div className="grid md:grid-cols-[1fr_auto] gap-6 items-end">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <label className="text-eyebrow">Your counter</label>
                      <span className="text-2xl font-mono font-medium tabular-nums text-foreground">
                        ${counterPrice.toLocaleString()}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={brief.reservation_price}
                      max={brief.asking_price}
                      value={counterPrice}
                      onChange={(e) => setCounterPrice(Number(e.target.value))}
                      className="w-full accent-accent"
                    />
                    <div className="flex justify-between text-meta mt-2">
                      <span>res ${brief.reservation_price}</span>
                      <span>ask ${brief.asking_price}</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 min-w-32">
                    <button
                      onClick={() => submitCounter(counterPrice)}
                      disabled={loading}
                      className="inline-flex items-center justify-center gap-2 rounded-md bg-accent text-background px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
                    >
                      <Send size={14} /> Counter (price only)
                    </button>
                    <button
                      onClick={() => lastBuyerOffer && submitCounter(lastBuyerOffer)}
                      disabled={loading || !lastBuyerOffer}
                      className="inline-flex items-center justify-center rounded-md border border-border-2 px-4 py-2.5 text-sm hover:border-foreground/40 disabled:opacity-30 transition-colors"
                    >
                      Accept ${lastBuyerOffer ? Math.round(lastBuyerOffer) : "—"}
                    </button>
                  </div>
                </div>
                <div className="mt-5 text-meta flex items-center gap-2">
                  <Keyboard size={12} />
                  <span>Enter to counter · Esc to accept</span>
                </div>
              </div>
            )}

            {/* Outcome */}
            {done && (
              <div className="rounded-xl border border-border bg-surface p-8 animate-fade-up">
                <div className="text-eyebrow mb-4">Outcome</div>
                <div className="text-h1 mb-6">
                  {result?.outcome === "deal"
                    ? `Deal at $${(result.agreed_price as number).toLocaleString()}`
                    : "No deal"}
                </div>
                {result?.outcome === "deal" && (
                  <div className="grid sm:grid-cols-3 gap-4 mb-6">
                    <ResultStat
                      label="Your share"
                      value={sellerShare !== null ? `${(sellerShare * 100).toFixed(0)}%` : "—"}
                      tone={sellerShare !== null && sellerShare > 0.5 ? "good" : "default"}
                    />
                    <ResultStat
                      label="Sauda share"
                      value={buyerShare !== null ? `${(buyerShare * 100).toFixed(0)}%` : "—"}
                      tone={buyerShare !== null && buyerShare > 0.5 ? "warn" : "default"}
                    />
                    <ResultStat
                      label="Bonus earned"
                      value={`$${earnedBonus} / $${brief.max_bonus}`}
                    />
                  </div>
                )}
                <p className="text-fg2 text-sm leading-relaxed mb-6 max-w-xl">
                  {result?.outcome === "deal"
                    ? sellerShare !== null && sellerShare > 0.6
                      ? "You held the line. Sauda still closed because the deal beat its reservation."
                      : sellerShare !== null && sellerShare < 0.4
                      ? "Sauda out-anchored you. The buyer captured most of the surplus."
                      : "Fair split. Both sides walked away with reasonable surplus."
                    : "No agreement reached. Either you held above Sauda's budget, or it walked."}
                </p>
                <button
                  onClick={() => window.location.reload()}
                  className="inline-flex items-center gap-2 rounded-md border border-border-2 px-4 py-2.5 text-sm hover:border-foreground/40 transition-colors"
                >
                  Play another listing
                </button>
              </div>
            )}
          </div>

          {/* Right column */}
          <div className="space-y-5">
            <TellsPanel tells={currentTells} />
          </div>
        </div>
      )}
    </div>
  );
}

function ResultStat({ label, value, tone = "default" }: { label: string; value: string; tone?: "good" | "warn" | "default" }) {
  const colorClass = tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-4">
      <div className="text-eyebrow mb-2">{label}</div>
      <div className={`text-2xl font-mono font-medium tabular-nums ${colorClass}`}>{value}</div>
    </div>
  );
}

/* ── Seller text input: type Hinglish/English, hit send ──── */
function SellerTextInput({
  counterPrice,
  onSubmit,
  disabled,
}: {
  counterPrice: number;
  onSubmit: (text: string) => void;
  disabled: boolean;
}) {
  const [text, setText] = useState("");

  const send = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSubmit(t);
    setText("");
  };

  return (
    <div className="flex gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        rows={2}
        placeholder={`e.g. "${counterPrice} is final, last price hai"`}
        className="flex-1 bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-fg3 focus:border-accent outline-none transition-colors resize-none font-mono"
        disabled={disabled}
      />
      <button
        onClick={send}
        disabled={disabled || !text.trim()}
        className="self-stretch inline-flex items-center justify-center gap-2 rounded-md bg-accent text-background px-4 text-sm font-medium hover:opacity-90 disabled:opacity-30 transition-opacity"
      >
        <Send size={14} /> Send
      </button>
    </div>
  );
}

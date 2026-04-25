"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiPost } from "../lib/api";
import { Send, Loader2, Keyboard, RefreshCw } from "lucide-react";

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
  return {
    asking_price: asking,
    reservation_price: reservation,
    bonus_per_unit: 1,
    max_bonus: 10,
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
          <Brief label="Bonus per $1k above" value={`+$${brief.bonus_per_unit}`} />
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
          $1k above your reservation price, capped at ${brief.max_bonus}. You earn
          nothing if you sell below ${brief.reservation_price.toLocaleString()} or
          fail to close. <em>Mirrors the Chicago HAI / Kellogg study setup.</em>
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

/* ── Main page ─────────────────────────────────────────── */
export default function SellPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [listingIdx, setListingIdx] = useState(0);
  const [brief, setBrief] = useState<RoleBrief | null>(null);

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [messages, setMessages] = useState<Array<{ text: string; type: string }>>([]);
  const [tickerMessages, setTickerMessages] = useState<string[]>([]);
  const [lastBuyerOffer, setLastBuyerOffer] = useState<number | null>(null);
  const [counterPrice, setCounterPrice] = useState(0);
  const [done, setDone] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentTells, setCurrentTells] = useState<TellSignal[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

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
        task: "amazon_realistic",
        strategy: "smart",
        seed: Math.floor(Math.random() * 10000),
        opening_price: brief.asking_price,
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
      setCurrentTells(generateTells(1, res.buyer_price));
      setTickerMessages([]);
    } catch (e) {
      setMessages([{ text: `Error: ${e}`, type: "error" }]);
    }
    setLoading(false);
  }, [brief, currentListing]);

  const submitCounter = useCallback(
    async (price: number) => {
      if (done || !brief) return;
      setLoading(true);
      try {
        const res = await apiPost<{
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

        setHistory(res.history);
        setMessages((m) => [
          ...m,
          { text: `You counter at $${price}.`, type: "seller" },
          { text: res.message, type: "buyer" },
        ]);

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

        setCurrentTells(generateTells(res.round, res.buyer_price));

        if (res.done) {
          setDone(true);
          setResult(res as Record<string, unknown>);
        }
      } catch (e) {
        setMessages((m) => [...m, { text: `Error: ${e}`, type: "error" }]);
      }
      setLoading(false);
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
        Math.max(0, Math.floor(((result.agreed_price as number) - brief.reservation_price) / 1000) * brief.bonus_per_unit)
      )
    : 0;

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-h1 mb-2">Play</h1>
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
                        {m.text}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Counter input */}
            {!done && (
              <div className="rounded-xl border border-border bg-surface p-6">
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
                      <Send size={14} /> Counter
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

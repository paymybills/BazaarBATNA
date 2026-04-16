"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface OfferEntry {
  round: number;
  actor: string;
  action: string;
  price: number | null;
}

interface Props {
  history: OfferEntry[];
  budget: number;
  cost: number;
  dealPrice?: number | null;
  activeRound?: number; // for replay cursor
}

export function NegotiationChart({
  history,
  budget,
  cost,
  dealPrice,
  activeRound,
}: Props) {
  // Build per-round data with ZOPA band
  const maxRound = Math.max(...history.map((h) => h.round), 1);
  const data: Array<Record<string, number | null>> = [];

  for (let r = 0; r <= maxRound; r++) {
    const sellerEntry = history.find(
      (h) => h.round === r && h.actor === "seller" && h.price != null
    );
    const buyerEntry = history.find(
      (h) => h.round === r && h.actor === "buyer" && h.price != null
    );

    data.push({
      round: r,
      seller: sellerEntry?.price ?? null,
      buyer: buyerEntry?.price ?? null,
      zopaTop: budget,
      zopaBottom: cost,
      midpoint: (budget + cost) / 2,
    });
  }

  return (
    <div className="w-full h-[400px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
          <XAxis
            dataKey="round"
            stroke="#666"
            label={{ value: "Round", position: "insideBottom", offset: -5, fill: "#666" }}
          />
          <YAxis
            stroke="#666"
            domain={[Math.max(0, cost - 10), budget + 10]}
            label={{ value: "Price", angle: -90, position: "insideLeft", fill: "#666" }}
          />
          <Tooltip
            contentStyle={{
              background: "#1a1a2e",
              border: "1px solid #2a2a3e",
              borderRadius: "8px",
              color: "#ededed",
            }}
            formatter={(value, name) => [
              `${Number(value)?.toFixed(0)}`,
              name === "seller" ? "Seller" : name === "buyer" ? "Buyer" : String(name),
            ]}
          />

          {/* ZOPA band */}
          <Area
            type="monotone"
            dataKey="zopaTop"
            stackId="zopa"
            fill="transparent"
            stroke="transparent"
          />
          <Area
            type="monotone"
            dataKey="zopaBottom"
            stackId="zopa-bg"
            fill="rgba(78, 205, 196, 0.05)"
            stroke="transparent"
          />

          {/* Reference lines */}
          <ReferenceLine y={budget} stroke="#666" strokeDasharray="5 5" label={{ value: "Budget", fill: "#888", position: "right" }} />
          <ReferenceLine y={cost} stroke="#f59e0b" strokeDasharray="5 5" label={{ value: "Cost", fill: "#f59e0b", position: "right" }} />
          <ReferenceLine y={(budget + cost) / 2} stroke="#ffd93d" strokeDasharray="3 3" label={{ value: "Nash", fill: "#ffd93d", position: "left" }} />

          {dealPrice && (
            <ReferenceLine y={dealPrice} stroke="#4ecdc4" strokeWidth={2} label={{ value: `Deal @ ${dealPrice.toFixed(0)}`, fill: "#4ecdc4", position: "right" }} />
          )}

          {activeRound !== undefined && (
            <ReferenceLine x={activeRound} stroke="#8b5cf6" strokeWidth={2} strokeDasharray="4 4" />
          )}

          {/* Offer lines */}
          <Line
            type="monotone"
            dataKey="seller"
            stroke="#ff6b6b"
            strokeWidth={3}
            dot={{ r: 6, fill: "#ff6b6b", stroke: "#ff6b6b" }}
            connectNulls
            name="seller"
          />
          <Line
            type="monotone"
            dataKey="buyer"
            stroke="#4ecdc4"
            strokeWidth={3}
            dot={{ r: 6, fill: "#4ecdc4", stroke: "#4ecdc4" }}
            connectNulls
            name="buyer"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

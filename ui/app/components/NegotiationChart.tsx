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
  activeRound?: number;
}

export function NegotiationChart({
  history,
  budget,
  cost,
  dealPrice,
  activeRound,
}: Props) {
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
    <div className="w-full h-[400px] font-sans">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 20, right: 40, left: 0, bottom: 20 }}>
          <CartesianGrid strokeDasharray="1 1" stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis
            dataKey="round"
            stroke="#333"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            label={{ value: "ROUND_TRACER", position: "insideBottom", offset: -10, fill: "#333", fontSize: 9, fontWeight: 900, letterSpacing: 2 }}
          />
          <YAxis
            stroke="#333"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            domain={[Math.max(0, cost - 10), budget + 10]}
            label={{ value: "VALUATION_INR", angle: -90, position: "insideLeft", fill: "#333", fontSize: 9, fontWeight: 900, letterSpacing: 2 }}
          />
          <Tooltip
            contentStyle={{
              background: "#000",
              border: "1px solid #222",
              borderRadius: "0px",
              color: "#fff",
              fontSize: "10px",
              textTransform: "uppercase",
              letterSpacing: "1px"
            }}
            itemStyle={{ color: "#fff", fontWeight: "bold" }}
            cursor={{ stroke: "#444", strokeWidth: 1 }}
            formatter={(value, name) => [
              `₹${Number(value)?.toFixed(0)}`,
              name === "seller" ? "SELLER" : name === "buyer" ? "USER" : String(name),
            ]}
          />

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
            fill="rgba(255,255,255,0.02)"
            stroke="transparent"
          />

          <ReferenceLine y={budget} stroke="#222" strokeDasharray="3 3" label={{ value: "LIMIT", fill: "#333", fontSize: 8, fontWeight: 900, position: "right" }} />
          <ReferenceLine y={cost} stroke="#222" strokeDasharray="3 3" label={{ value: "COST", fill: "#333", fontSize: 8, fontWeight: 900, position: "right" }} />
          
          {dealPrice && (
            <ReferenceLine y={dealPrice} stroke="#fff" strokeWidth={1} label={{ value: `SETTLED_@_${dealPrice.toFixed(0)}`, fill: "#fff", fontSize: 9, fontWeight: 900, position: "right" }} />
          )}

          {activeRound !== undefined && (
            <ReferenceLine x={activeRound} stroke="#fff" strokeWidth={1} strokeDasharray="1 1" opacity={0.3} />
          )}

          <Line
            type="monotone"
            dataKey="seller"
            stroke="#666"
            strokeWidth={1}
            dot={{ r: 3, fill: "#000", stroke: "#666", strokeWidth: 1 }}
            activeDot={{ r: 5, fill: "#fff" }}
            connectNulls
            name="seller"
          />
          <Line
            type="monotone"
            dataKey="buyer"
            stroke="#fff"
            strokeWidth={2}
            dot={{ r: 4, fill: "#fff", stroke: "#000", strokeWidth: 1 }}
            activeDot={{ r: 6, fill: "#fff", stroke: "#000" }}
            connectNulls
            name="buyer"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

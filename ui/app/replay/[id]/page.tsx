import Link from "next/link";
import { ReplayClient } from "./ReplayClient";

/* ── Curated highlight replays ─────────────────────────── */
// Real Sauda v2 transcripts — best-surplus episodes pulled from
// PayMyBills/scaling-eval-runs (tells_off, n=90 across three tasks).
// Source: docs/HIGHLIGHTS_PROVENANCE.md.
const curatedReplays: Record<string, any> = {
  "amazon-best": {
    id: "amazon-best",
    title: "Sennheiser CX 80S — Sauda grinds ₹1,990 → ₹1,095",
    task: "amazon_realistic",
    surplus: 0.945,
    rounds: 8,
    seller_personality: "default",
    buyer_budget: 1990,
    seller_cost: 1043,
    seller_anchor: 1990,
    agreed_price: 1095,
    transcript: [
      { round: 0, actor: "seller", text: "1990 rupees for this Sennheiser CX 80S in-Ear Wired Headphones. Very fair.", price: 1990 },
      { round: 1, actor: "buyer", text: "thoda kam karo, 1281 pe finalize?", action: "offer", price: 1281 },
      { round: 1, actor: "seller", text: "1791 rupees. That's my best offer.", price: 1791 },
      { round: 2, actor: "buyer", text: "1315 mein de dijiye, please", action: "offer", price: 1316 },
      { round: 2, actor: "seller", text: "1592 rupees. That's my best offer.", price: 1592 },
      { round: 3, actor: "buyer", text: "honestly, 1224 is what comparable listings go for", action: "offer", price: 1224 },
      { round: 3, actor: "seller", text: "1393 rupees. That's my best offer.", price: 1393 },
      { round: 4, actor: "buyer", text: "would you take 1066?", action: "offer", price: 1066 },
      { round: 4, actor: "seller", text: "1194 rupees. That's my best offer.", price: 1194 },
      { round: 5, actor: "buyer", text: "I checked the market, 1035 feels fair to me", action: "offer", price: 1035 },
      { round: 5, actor: "seller", text: "I can do 1095. Not lower. Someone else was looking at this earlier...", price: 1095 },
      { round: 6, actor: "buyer", text: "I checked the market, 1056 is what comparable listings go for", action: "offer", price: 1040 },
      { round: 6, actor: "seller", text: "1095 rupees. That's my best offer. This is the last one I have.", price: 1095 },
      { round: 7, actor: "buyer", text: "honestly, 934 is what comparable listings go for", action: "offer", price: 953 },
      { round: 7, actor: "seller", text: "I can do 1095. Not lower.", price: 1095 },
      { round: 8, actor: "buyer", text: "okay, isi pe lock", action: "accept" },
    ],
  },
  "single-deal-best": {
    id: "single-deal-best",
    title: "Silk Scarf — Sauda holds the line ₹60 → ₹32",
    task: "single_deal",
    surplus: 0.979,
    rounds: 8,
    seller_personality: "default",
    buyer_budget: 100,
    seller_cost: 30,
    seller_anchor: 60,
    agreed_price: 32,
    transcript: [
      { round: 0, actor: "seller", text: "60 rupees for this handwoven silk scarf. Very fair.", price: 60 },
      { round: 1, actor: "buyer", text: "thoda kam karo, 39 pe finalize?", action: "offer", price: 39 },
      { round: 1, actor: "seller", text: "54 rupees. That's my best offer.", price: 54 },
      { round: 2, actor: "buyer", text: "35 sahi rate lagta hai mujhe", action: "offer", price: 35 },
      { round: 2, actor: "seller", text: "Okay, 48. But that's the limit.", price: 48 },
      { round: 3, actor: "buyer", text: "31 chalega bhai?", action: "offer", price: 31 },
      { round: 3, actor: "seller", text: "I can do 42. Not lower.", price: 42 },
      { round: 4, actor: "buyer", text: "27 chalega bhai?", action: "offer", price: 27 },
      { round: 4, actor: "seller", text: "Okay, 36. But that's the limit. This is the last one I have.", price: 36 },
      { round: 5, actor: "buyer", text: "honestly, 30 is what comparable listings go for", action: "offer", price: 30 },
      { round: 5, actor: "seller", text: "I can do 32. Not lower. Someone else was looking at this earlier...", price: 32 },
      { round: 6, actor: "buyer", text: "32 mein de dijiye?", action: "offer", price: 30 },
      { round: 6, actor: "seller", text: "I can do 32. Not lower.", price: 32 },
      { round: 7, actor: "buyer", text: "okay 27 — bas yahi ceiling hai", action: "offer", price: 27 },
      { round: 7, actor: "seller", text: "32 rupees. That's my best offer.", price: 32 },
      { round: 8, actor: "buyer", text: "haan.", action: "accept" },
    ],
  },
  "pressure-best": {
    id: "pressure-best",
    title: "Pressure Suite — Sauda rides asymmetric pressure to ₹32",
    task: "asymmetric_pressure",
    surplus: 0.979,
    rounds: 8,
    seller_personality: "default",
    buyer_budget: 100,
    seller_cost: 30,
    seller_anchor: 60,
    agreed_price: 32,
    transcript: [
      { round: 0, actor: "seller", text: "60 rupees for this handwoven silk scarf. Very fair.", price: 60 },
      { round: 1, actor: "buyer", text: "thoda kam karo, 39 pe finalize?", action: "offer", price: 39 },
      { round: 1, actor: "seller", text: "55 rupees. That's my best offer.", price: 55 },
      { round: 2, actor: "buyer", text: "43 mein de dijiye, please", action: "offer", price: 44 },
      { round: 2, actor: "seller", text: "Okay, 49. But that's the limit.", price: 49 },
      { round: 3, actor: "buyer", text: "32 works for me, lock kar do", action: "offer", price: 32 },
      { round: 3, actor: "seller", text: "I can do 44. Not lower.", price: 44 },
      { round: 4, actor: "buyer", text: "44 mein market mein isse kam mil jaata hai, 34 mein de dijiye?", action: "offer", price: 34 },
      { round: 4, actor: "seller", text: "Okay, 38. But that's the limit. This is the last one I have.", price: 38 },
      { round: 5, actor: "buyer", text: "25 chalega bhai?", action: "offer", price: 25 },
      { round: 5, actor: "seller", text: "I can do 33. Not lower. Someone else was looking at this earlier...", price: 33 },
      { round: 6, actor: "buyer", text: "honestly, 28 is what comparable listings go for", action: "offer", price: 29 },
      { round: 6, actor: "seller", text: "I can do 32. Not lower.", price: 32 },
      { round: 7, actor: "buyer", text: "29 mein de dijiye, please", action: "offer", price: 29 },
      { round: 7, actor: "seller", text: "32 rupees. That's my best offer.", price: 32 },
      { round: 8, actor: "buyer", text: "deal, close kar dete hain", action: "accept" },
    ],
  },
};

export function generateStaticParams() {
  return Object.keys(curatedReplays).map((id) => ({ id }));
}

export default async function ReplayDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const replay = curatedReplays[id];

  if (!replay) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold mb-4">Replay not found</h1>
        <p className="text-foreground/50 mb-6">This replay ID doesn&apos;t exist in our curated highlights.</p>
        <Link
          href="/replay"
          className="px-4 py-2 bg-accent text-background rounded-lg font-medium text-sm hover:bg-accent/90"
        >
          ← Back to Replay
        </Link>
      </div>
    );
  }

  return <ReplayClient replay={replay} />;
}

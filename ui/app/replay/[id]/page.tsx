import Link from "next/link";
import { ReplayClient } from "./ReplayClient";

/* ── Curated highlight replays ─────────────────────────── */
const curatedReplays: Record<string, any> = {
  "amazon-best": {
    id: "amazon-best",
    title: "Crompton Geyser — Agent grinds ₹7,299 → ₹2,645",
    task: "amazon_realistic",
    surplus: 0.974,
    rounds: 8,
    seller_personality: "default",
    buyer_budget: 7299,
    seller_cost: 2519,
    seller_anchor: 7299,
    agreed_price: 2645,
    transcript: [
      { round: 0, actor: "seller", text: "7299 rupees for this Crompton Gracee 5-L Instant Water Heater (Geyser). Very fair." },
      { round: 1, actor: "buyer", text: "Offer: ₹4,698", action: "offer", price: 4698 },
      { round: 1, actor: "seller", text: "Okay, 6569. But that's the limit.", price: 6569 },
      { round: 2, actor: "buyer", text: "Offer: ₹4,270", action: "offer", price: 4270 },
      { round: 2, actor: "seller", text: "I can do 5839. Not lower. This is the last one I have.", price: 5839 },
      { round: 3, actor: "buyer", text: "Offer: ₹3,795", action: "offer", price: 3795 },
      { round: 3, actor: "seller", text: "5109 rupees. That's my best offer.", price: 5109 },
      { round: 4, actor: "buyer", text: "Offer: ₹3,321", action: "offer", price: 3321 },
      { round: 4, actor: "seller", text: "4379 rupees. That's my best offer.", price: 4379 },
      { round: 5, actor: "buyer", text: "Offer: ₹2,847", action: "offer", price: 2847 },
      { round: 5, actor: "seller", text: "I can do 3650. Not lower.", price: 3650 },
      { round: 6, actor: "buyer", text: "Offer: ₹2,372", action: "offer", price: 2372 },
      { round: 6, actor: "seller", text: "I can do 2920. Not lower.", price: 2920 },
      { round: 7, actor: "buyer", text: "Offer: ₹2,540", action: "offer", price: 2540 },
      { round: 7, actor: "seller", text: "2645 rupees. That's my best offer.", price: 2645 },
      { round: 8, actor: "buyer", text: "Accept ✓", action: "accept" },
    ],
  },
  "tells-deceptive": {
    id: "tells-deceptive",
    title: "Silk Scarf — Agent calls the deceptive bluff",
    task: "read_the_tells",
    surplus: 0.483,
    rounds: 2,
    seller_personality: "deceptive",
    buyer_budget: 100,
    seller_cost: 30,
    seller_anchor: 76,
    agreed_price: 66,
    transcript: [
      { round: 0, actor: "seller", text: "This handwoven silk scarf is selling fast. 76, and honestly I'm losing money at that.", price: 76 },
      { round: 1, actor: "buyer", text: "Offer: ₹66", action: "offer", price: 66 },
      { round: 1, actor: "seller", text: "66... you know, I shouldn't even go this low. My cousin told me someone offered more yesterday.", price: 66 },
      { round: 2, actor: "buyer", text: "Accept ✓", action: "accept" },
    ],
  },
  "career-grind": {
    id: "career-grind",
    title: "Silk Scarf — 8-round patience play",
    task: "career_10",
    surplus: 0.979,
    rounds: 8,
    seller_personality: "default",
    buyer_budget: 100,
    seller_cost: 30,
    seller_anchor: 60,
    agreed_price: 32,
    transcript: [
      { round: 0, actor: "seller", text: "60 rupees for this handwoven silk scarf. Very fair.", price: 60 },
      { round: 1, actor: "buyer", text: "Offer: ₹39", action: "offer", price: 39 },
      { round: 1, actor: "seller", text: "54 rupees. That's my best offer.", price: 54 },
      { round: 2, actor: "buyer", text: "Offer: ₹35", action: "offer", price: 35 },
      { round: 2, actor: "seller", text: "Okay, 47. But that's the limit.", price: 47 },
      { round: 3, actor: "buyer", text: "Offer: ₹31", action: "offer", price: 31 },
      { round: 3, actor: "seller", text: "I can do 41. Not lower.", price: 41 },
      { round: 4, actor: "buyer", text: "Offer: ₹30", action: "offer", price: 30 },
      { round: 4, actor: "seller", text: "Okay, 35. But that's the limit. This is the last one I have.", price: 35 },
      { round: 5, actor: "buyer", text: "Offer: ₹30", action: "offer", price: 30 },
      { round: 5, actor: "seller", text: "I can do 32. Not lower. Someone else was looking at this earlier...", price: 32 },
      { round: 6, actor: "buyer", text: "Offer: ₹30", action: "offer", price: 30 },
      { round: 6, actor: "seller", text: "I can do 32. Not lower.", price: 32 },
      { round: 7, actor: "buyer", text: "Offer: ₹30", action: "offer", price: 30 },
      { round: 7, actor: "seller", text: "32 rupees. That's my best offer.", price: 32 },
      { round: 8, actor: "buyer", text: "Accept at ₹32 ✓", action: "accept" },
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

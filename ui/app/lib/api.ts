const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function apiGet<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function apiPost<T = unknown>(
  path: string,
  body: unknown
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${await res.text()}`);
  return res.json();
}

export function wsUrl(sessionId = "default"): string {
  const base = API_BASE.replace(/^http/, "ws");
  return `${base}/ws/${sessionId}`;
}

// ── Types matching backend models ──────────────────────────────

export interface TellObservation {
  verbal_urgency: number;
  verbal_confidence: number;
  verbal_deception_cue: number;
  price_rounding: string;
  offer_speed: string;
  concession_pattern: string;
  fidget_level: number;
  eye_contact: string;
  posture: string;
  repeat_phrases: number;
  topic_changes: number;
  emotional_escalation: number;
}

export interface CareerHistory {
  deals: DealRecord[];
  capitulation_rate: number;
  avg_normalized_surplus: number;
  avg_rounds_to_close: number;
}

export interface DealRecord {
  episode: number;
  outcome: string;
  agreed_price: number | null;
  rounds_taken: number;
  buyer_surplus: number;
  normalized_surplus: number;
  buyer_capitulated: boolean;
}

export interface BazaarObservation {
  current_round: number;
  max_rounds: number;
  own_last_offer: number | null;
  opponent_last_offer: number | null;
  own_private_deadline: number | null;
  own_private_budget: number;
  rounds_remaining: number;
  seller_last_move_delta: number | null;
  item_name: string;
  seller_asking_price: number;
  seller_personality: string;
  tells: TellObservation | null;
  episode_number: number;
  total_episodes: number;
  career_history: CareerHistory | null;
  done: boolean;
  deal_outcome: string | null;
  message: string;
}

export interface StepResponse {
  observation: BazaarObservation;
  reward: number;
  done: boolean;
  info: Record<string, unknown>;
}

export interface ResetResponse {
  observation: BazaarObservation;
  done: boolean;
  reward: number;
}

export interface TaskInfo {
  difficulty: string;
  description: string;
  seller_personality: string;
  num_buyers: number;
  enable_tells: boolean;
  enable_coalition: boolean;
}

export interface LeaderboardEntry {
  agent_name: string;
  task: string;
  score: number;
  episodes_completed: number;
  timestamp: string;
  metadata: Record<string, unknown>;
}

export interface CounterfactualResult {
  original_outcome: string | null;
  original_price: number | null;
  original_score: number;
  counterfactual_outcome: string | null;
  counterfactual_price: number | null;
  counterfactual_score: number;
  divergence_round: number;
  counterfactual_history: Array<{
    round: number;
    action: string;
    price: number | null;
    seller_response: string;
    reward: number;
    done: boolean;
  }>;
}

export interface EnvironmentState {
  task_name: string;
  episode: number;
  total_episodes: number;
  current_round: number;
  max_rounds: number;
  done: boolean;
  buyer_budget: number;
  seller_cost: number;
  seller_anchor: number;
  seller_personality: string;
  offer_history: Array<{
    round: number;
    actor: string;
    action: string;
    price: number | null;
  }>;
  career_history: CareerHistory | null;
  cumulative_reward: number;
  tells_history: TellObservation[];
}

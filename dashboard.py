"""
BazaarBot Dashboard - Interactive negotiation visualization.

Run: streamlit run dashboard.py
"""

import copy
import math
import random

import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from plotly.subplots import make_subplots

from server.environment import BazaarEnvironment
from server.models import ActionType, BazaarAction, DealOutcome, SellerPersonalityType
from server.tasks import GRADERS, TASKS

# ── Page config ───────────────────────────────────────────────────

st.set_page_config(
    page_title="BazaarBot - Negotiation Simulator",
    page_icon="",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.markdown("""
<style>
    .stMetric > div { background: #1e1e2e; border-radius: 10px; padding: 15px; }
    .deal-card { background: #1e1e2e; border-radius: 10px; padding: 10px; margin: 5px 0; }
</style>
""", unsafe_allow_html=True)


# ── Sidebar ───────────────────────────────────────────────────────

st.sidebar.title("BazaarBot Controls")

task_name = st.sidebar.selectbox(
    "Task",
    list(TASKS.keys()),
    format_func=lambda x: f"{x} ({TASKS[x].difficulty})",
)
task = TASKS[task_name]

st.sidebar.markdown(f"**Description:** {task.description}")
st.sidebar.markdown(f"**Max steps:** {task.max_steps}")
st.sidebar.markdown(f"**Episodes:** {task.total_episodes}")
st.sidebar.markdown(f"**Success threshold:** {task.success_threshold}")
st.sidebar.markdown(f"**Personality:** {task.seller_personality.value}")

st.sidebar.markdown("---")
st.sidebar.subheader("Buyer Strategy")

buyer_strategy = st.sidebar.selectbox(
    "Buyer agent type",
    ["smart_rule", "naive", "aggressive", "manual"],
    format_func=lambda x: {
        "smart_rule": "Smart (Strategic)",
        "naive": "Naive (Accepts quickly)",
        "aggressive": "Aggressive (Lowballs)",
        "manual": "Manual (You negotiate!)",
    }[x],
)

# Personality override
personality_override = st.sidebar.selectbox(
    "Seller personality override",
    ["task_default", "default", "deceptive", "impatient", "collaborative"],
)

seed = st.sidebar.number_input("Random seed", value=42, min_value=0, max_value=9999)

speed = st.sidebar.slider("Simulation speed (seconds/round)", 0.1, 2.0, 0.5, 0.1)

st.sidebar.markdown("---")
st.sidebar.subheader("Environment Parameters")
custom_budget = st.sidebar.slider("Buyer budget", 50.0, 200.0, task.buyer_budget, 5.0)
custom_cost = st.sidebar.slider("Seller cost", 10.0, 100.0, task.seller_cost, 5.0)
custom_anchor_mult = st.sidebar.slider("Seller anchor multiplier", 1.5, 3.0, task.seller_anchor_multiplier, 0.1)


# ── Buyer strategies ─────────────────────────────────────────────

def naive_buyer(obs, rng):
    if obs.current_round == 0:
        return BazaarAction(action=ActionType.OFFER, price=obs.seller_asking_price * 0.8)
    if obs.current_round >= 2:
        return BazaarAction(action=ActionType.ACCEPT)
    return BazaarAction(action=ActionType.OFFER, price=obs.seller_asking_price * 0.85)


def aggressive_buyer(obs, rng):
    target = obs.own_private_budget * 0.35
    if obs.current_round == 0:
        return BazaarAction(action=ActionType.OFFER, price=target * 0.7)
    if obs.opponent_last_offer and obs.opponent_last_offer <= target * 1.1:
        return BazaarAction(action=ActionType.ACCEPT)
    if obs.rounds_remaining <= 1:
        return BazaarAction(action=ActionType.WALK)
    step_up = target * (0.7 + 0.05 * obs.current_round)
    return BazaarAction(action=ActionType.OFFER, price=min(step_up, target))


def smart_buyer(obs, rng):
    budget = obs.own_private_budget
    ask = obs.seller_asking_price
    if obs.current_round == 0:
        return BazaarAction(action=ActionType.OFFER, price=round(ask * 0.4, 2))

    seller_velocity = obs.seller_last_move_delta or 0
    opp_offer = obs.opponent_last_offer or ask

    if seller_velocity > ask * 0.05:
        own_move = budget * 0.02
    else:
        own_move = budget * 0.05

    last = obs.own_last_offer or (ask * 0.4)
    next_offer = last + own_move

    if obs.own_private_deadline and obs.current_round >= obs.own_private_deadline - 1:
        next_offer = min(opp_offer * 0.95, budget * 0.7)
        if obs.current_round >= obs.own_private_deadline:
            return BazaarAction(action=ActionType.ACCEPT)

    if opp_offer <= budget * 0.55:
        return BazaarAction(action=ActionType.ACCEPT)
    if obs.rounds_remaining <= 1 and opp_offer > budget * 0.75:
        return BazaarAction(action=ActionType.WALK)
    if obs.rounds_remaining <= 1 and opp_offer <= budget * 0.75:
        return BazaarAction(action=ActionType.ACCEPT)
    if obs.career_history and obs.career_history.capitulation_rate > 0.3:
        next_offer *= 0.95

    next_offer = max(next_offer, ask * 0.3)
    next_offer = min(next_offer, budget * 0.7)

    return BazaarAction(action=ActionType.OFFER, price=round(next_offer, 2))


BUYERS = {
    "naive": naive_buyer,
    "aggressive": aggressive_buyer,
    "smart_rule": smart_buyer,
}


# ── Simulation runner ─────────────────────────────────────────────

def run_simulation(task_config, strategy, seed_val, budget, cost, anchor_mult):
    tc = copy.deepcopy(task_config)
    tc.buyer_budget = budget
    tc.seller_cost = cost
    tc.seller_anchor_multiplier = anchor_mult

    if personality_override != "task_default":
        tc.seller_personality = SellerPersonalityType(personality_override)

    env = BazaarEnvironment(tc, seed=seed_val)
    rng = random.Random(seed_val)
    buyer_fn = BUYERS[strategy]

    all_steps = []
    episode_data = []

    for ep in range(tc.total_episodes):
        obs = env.reset()
        ep_steps = []
        ep_steps.append({
            "round": 0,
            "episode": ep + 1,
            "buyer_offer": None,
            "seller_offer": obs.seller_asking_price,
            "action": "open",
            "reward": 0.0,
            "message": obs.message,
            "gap": None,
            "done": False,
        })

        max_rounds = tc.max_steps if tc.total_episodes == 1 else tc.max_steps // tc.total_episodes
        for r in range(1, max_rounds + 1):
            if env.done:
                break

            action = buyer_fn(obs, rng)
            obs, reward_obj = env.step(action)

            step_data = {
                "round": r,
                "episode": ep + 1,
                "buyer_offer": action.price,
                "seller_offer": obs.opponent_last_offer,
                "action": action.action.value,
                "reward": reward_obj.reward,
                "reward_components": reward_obj.components,
                "message": obs.message,
                "gap": abs((obs.opponent_last_offer or 0) - (action.price or 0)) if action.price else None,
                "done": obs.done,
                "outcome": obs.deal_outcome.value if obs.deal_outcome else None,
                "tells": obs.tells.model_dump() if obs.tells else None,
            }
            ep_steps.append(step_data)

            if obs.done:
                break

        episode_data.append({
            "episode": ep + 1,
            "steps": ep_steps,
            "outcome": env.episode_results[-1].outcome.value if env.episode_results else "unknown",
            "agreed_price": env.episode_results[-1].agreed_price if env.episode_results else None,
            "surplus": env.episode_results[-1].normalized_surplus if env.episode_results else 0,
            "rounds": len(ep_steps) - 1,
        })
        all_steps.extend(ep_steps)

    grader = GRADERS[tc.name]
    final_score = grader(env.episode_results, tc)

    return all_steps, episode_data, env, final_score


# ── Main content ──────────────────────────────────────────────────

st.title("BazaarBot - Negotiation Simulator")
st.markdown("*Customer-vendor price negotiation with asymmetric information, personality types, and poker tells*")

# Manual mode
if buyer_strategy == "manual":
    st.markdown("---")
    st.subheader("Manual Negotiation")

    if "manual_env" not in st.session_state:
        st.session_state.manual_env = None
        st.session_state.manual_obs = None
        st.session_state.manual_history = []
        st.session_state.manual_rewards = []
        st.session_state.manual_done = False

    col1, col2 = st.columns([2, 1])

    with col1:
        if st.button("Start New Negotiation", type="primary"):
            tc = copy.deepcopy(task)
            tc.buyer_budget = custom_budget
            tc.seller_cost = custom_cost
            tc.seller_anchor_multiplier = custom_anchor_mult
            if personality_override != "task_default":
                tc.seller_personality = SellerPersonalityType(personality_override)
            env = BazaarEnvironment(tc, seed=seed)
            obs = env.reset()
            st.session_state.manual_env = env
            st.session_state.manual_obs = obs
            st.session_state.manual_history = [{"round": 0, "message": obs.message, "seller_offer": obs.seller_asking_price}]
            st.session_state.manual_rewards = []
            st.session_state.manual_done = False

    if st.session_state.manual_env and not st.session_state.manual_done:
        obs = st.session_state.manual_obs

        st.markdown(f"**Round {obs.current_round}/{obs.max_rounds}** | "
                     f"Budget: {obs.own_private_budget:.0f} | "
                     f"Seller asks: {obs.opponent_last_offer:.0f} | "
                     f"Personality: {obs.seller_personality}")
        st.info(obs.message)

        # Show tells
        if obs.tells:
            with st.expander("Seller Tells (poker read)", expanded=True):
                tcol1, tcol2 = st.columns(2)
                with tcol1:
                    st.progress(obs.tells.verbal_urgency, text=f"Urgency: {obs.tells.verbal_urgency:.0%}")
                    st.progress(obs.tells.verbal_confidence, text=f"Confidence: {obs.tells.verbal_confidence:.0%}")
                    st.progress(obs.tells.verbal_deception_cue, text=f"Deception cue: {obs.tells.verbal_deception_cue:.0%}")
                with tcol2:
                    st.progress(obs.tells.fidget_level, text=f"Fidgeting: {obs.tells.fidget_level:.0%}")
                    st.write(f"Eyes: {obs.tells.eye_contact} | Posture: {obs.tells.posture}")
                    st.write(f"Speed: {obs.tells.offer_speed} | Pattern: {obs.tells.concession_pattern}")

        col_a, col_b, col_c = st.columns(3)
        with col_a:
            offer_price = st.number_input(
                "Your offer price",
                min_value=0.0,
                max_value=float(obs.own_private_budget),
                value=float((obs.opponent_last_offer or obs.seller_asking_price) * 0.6),
                step=1.0,
            )
            if st.button("Make Offer"):
                action = BazaarAction(action=ActionType.OFFER, price=offer_price)
                obs, rew = st.session_state.manual_env.step(action)
                st.session_state.manual_obs = obs
                st.session_state.manual_rewards.append(rew.reward)
                st.session_state.manual_history.append({
                    "round": obs.current_round,
                    "message": obs.message,
                    "buyer_offer": offer_price,
                    "seller_offer": obs.opponent_last_offer,
                    "reward": rew.reward,
                })
                if obs.done:
                    st.session_state.manual_done = True
                st.rerun()
        with col_b:
            if st.button("Accept Seller's Price"):
                action = BazaarAction(action=ActionType.ACCEPT)
                obs, rew = st.session_state.manual_env.step(action)
                st.session_state.manual_obs = obs
                st.session_state.manual_rewards.append(rew.reward)
                st.session_state.manual_history.append({
                    "round": obs.current_round,
                    "message": obs.message,
                    "reward": rew.reward,
                    "action": "accept",
                })
                st.session_state.manual_done = True
                st.rerun()
        with col_c:
            if st.button("Walk Away"):
                action = BazaarAction(action=ActionType.WALK)
                obs, rew = st.session_state.manual_env.step(action)
                st.session_state.manual_obs = obs
                st.session_state.manual_rewards.append(rew.reward)
                st.session_state.manual_history.append({
                    "round": obs.current_round,
                    "message": obs.message,
                    "reward": rew.reward,
                    "action": "walk",
                })
                st.session_state.manual_done = True
                st.rerun()

    if st.session_state.manual_done:
        env = st.session_state.manual_env
        grader = GRADERS[task_name]
        sc = grader(env.episode_results, env.task)
        st.success(f"Negotiation complete! Score: {sc:.4f}")

    if st.session_state.manual_history:
        st.markdown("### Negotiation Log")
        for h in st.session_state.manual_history:
            st.markdown(f"**Round {h['round']}:** {h.get('message', '')}")

    st.stop()


# ── Automated simulation ─────────────────────────────────────────

if st.button("Run Simulation", type="primary", use_container_width=True):
    st.session_state.sim_running = True

if not st.session_state.get("sim_running"):
    st.info("Select a task and strategy, then click **Run Simulation** to begin.")
    st.stop()

with st.spinner("Running simulation..."):
    all_steps, episode_data, env, final_score = run_simulation(
        task, buyer_strategy, seed, custom_budget, custom_cost, custom_anchor_mult
    )

# ── Metrics row ───────────────────────────────────────────────────

st.markdown("---")
col1, col2, col3, col4, col5 = st.columns(5)

deals_made = sum(1 for e in episode_data if e["outcome"] == "deal")
walks = sum(1 for e in episode_data if e["outcome"] == "walk")
avg_surplus = sum(e["surplus"] for e in episode_data) / max(len(episode_data), 1)

col1.metric("Final Score", f"{final_score:.4f}")
col2.metric("Deals Made", f"{deals_made}/{len(episode_data)}")
col3.metric("Walks", walks)
col4.metric("Avg Surplus", f"{avg_surplus:.1%}")
col5.metric("Success", "Yes" if final_score >= task.success_threshold else "No")

# ── Offer trajectory chart ────────────────────────────────────────

st.markdown("---")
st.subheader("Offer Trajectories")

if task.total_episodes == 1:
    df = pd.DataFrame(all_steps)

    fig = go.Figure()
    seller_offers = df[df["seller_offer"].notna()]
    buyer_offers = df[df["buyer_offer"].notna()]

    fig.add_trace(go.Scatter(
        x=seller_offers["round"], y=seller_offers["seller_offer"],
        mode="lines+markers", name="Seller",
        line=dict(color="#ff6b6b", width=3),
        marker=dict(size=10, symbol="diamond"),
    ))
    fig.add_trace(go.Scatter(
        x=buyer_offers["round"], y=buyer_offers["buyer_offer"],
        mode="lines+markers", name="Buyer",
        line=dict(color="#4ecdc4", width=3),
        marker=dict(size=10, symbol="circle"),
    ))

    fig.add_hline(y=custom_budget, line_dash="dash", line_color="gray",
                  annotation_text="Budget", annotation_position="top right")
    fig.add_hline(y=custom_cost, line_dash="dash", line_color="orange",
                  annotation_text="Seller Cost", annotation_position="bottom right")

    midpoint = (custom_budget + custom_cost) / 2
    fig.add_hline(y=midpoint, line_dash="dot", line_color="yellow",
                  annotation_text="Nash Midpoint", annotation_position="top left")

    if episode_data[0]["outcome"] == "deal" and episode_data[0]["agreed_price"]:
        fig.add_hline(y=episode_data[0]["agreed_price"], line_dash="solid",
                      line_color="lime", annotation_text=f"Deal @ {episode_data[0]['agreed_price']:.0f}")

    fig.update_layout(
        xaxis_title="Round",
        yaxis_title="Price (Rupees)",
        template="plotly_dark",
        height=450,
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
    )
    st.plotly_chart(fig, use_container_width=True)

else:
    tabs = st.tabs([f"Episode {e['episode']}" for e in episode_data] + ["All Episodes"])

    for i, ep in enumerate(episode_data):
        with tabs[i]:
            df = pd.DataFrame(ep["steps"])
            fig = go.Figure()
            seller = df[df["seller_offer"].notna()]
            buyer = df[df["buyer_offer"].notna()]
            fig.add_trace(go.Scatter(x=seller["round"], y=seller["seller_offer"],
                                     mode="lines+markers", name="Seller",
                                     line=dict(color="#ff6b6b", width=2)))
            fig.add_trace(go.Scatter(x=buyer["round"], y=buyer["buyer_offer"],
                                     mode="lines+markers", name="Buyer",
                                     line=dict(color="#4ecdc4", width=2)))
            fig.add_hline(y=custom_cost, line_dash="dash", line_color="orange",
                          annotation_text="Cost")
            if ep["agreed_price"]:
                fig.add_hline(y=ep["agreed_price"], line_color="lime", line_dash="solid",
                              annotation_text=f"Deal @ {ep['agreed_price']:.0f}")
            fig.update_layout(template="plotly_dark", height=350,
                              xaxis_title="Round", yaxis_title="Price",
                              title=f"Episode {ep['episode']}: {ep['outcome']}")
            st.plotly_chart(fig, use_container_width=True)

    with tabs[-1]:
        fig = make_subplots(rows=1, cols=2, subplot_titles=["Agreed Prices", "Surplus per Episode"])

        prices = [e["agreed_price"] or 0 for e in episode_data]
        surpluses = [e["surplus"] for e in episode_data]
        episodes = [e["episode"] for e in episode_data]
        colors = ["#4ecdc4" if e["outcome"] == "deal" else "#ff6b6b" for e in episode_data]

        fig.add_trace(go.Bar(x=episodes, y=prices, marker_color=colors, name="Price"), row=1, col=1)
        fig.add_trace(go.Bar(x=episodes, y=surpluses, marker_color="#ffd93d", name="Surplus"), row=1, col=2)
        fig.add_hline(y=custom_cost, line_dash="dash", line_color="orange", row=1, col=1)
        fig.update_layout(template="plotly_dark", height=400, showlegend=False)
        st.plotly_chart(fig, use_container_width=True)


# ── Reward decomposition ─────────────────────────────────────────

st.markdown("---")
st.subheader("Reward Analysis")

col_r1, col_r2 = st.columns(2)

with col_r1:
    cum_rewards = []
    running = 0
    for s in all_steps:
        running += s.get("reward", 0)
        cum_rewards.append(running)

    fig_cum = go.Figure()
    fig_cum.add_trace(go.Scatter(
        x=list(range(len(cum_rewards))), y=cum_rewards,
        mode="lines", fill="tozeroy",
        line=dict(color="#4ecdc4", width=2),
        fillcolor="rgba(78, 205, 196, 0.2)",
    ))
    fig_cum.update_layout(
        title="Cumulative Reward",
        xaxis_title="Step", yaxis_title="Reward",
        template="plotly_dark", height=350,
    )
    st.plotly_chart(fig_cum, use_container_width=True)

with col_r2:
    step_rewards = [s.get("reward", 0) for s in all_steps]
    fig_per = go.Figure()
    fig_per.add_trace(go.Bar(
        x=list(range(len(step_rewards))), y=step_rewards,
        marker_color=["#4ecdc4" if r >= 0 else "#ff6b6b" for r in step_rewards],
    ))
    fig_per.update_layout(
        title="Per-Step Rewards",
        xaxis_title="Step", yaxis_title="Reward",
        template="plotly_dark", height=350,
    )
    st.plotly_chart(fig_per, use_container_width=True)


# ── State space visualization ─────────────────────────────────────

st.markdown("---")
st.subheader("State Space Analysis")

col_s1, col_s2 = st.columns(2)

with col_s1:
    gaps = [s.get("gap") for s in all_steps if s.get("gap") is not None]
    if gaps:
        fig_gap = go.Figure()
        fig_gap.add_trace(go.Scatter(
            x=list(range(len(gaps))), y=gaps,
            mode="lines+markers",
            line=dict(color="#ffd93d", width=2),
            marker=dict(size=6),
        ))
        fig_gap.update_layout(
            title="Offer Gap Convergence",
            xaxis_title="Negotiation Step", yaxis_title="Price Gap",
            template="plotly_dark", height=350,
        )
        st.plotly_chart(fig_gap, use_container_width=True)

with col_s2:
    alpha, beta = 0.3, 2.5
    max_r = task.max_steps if task.total_episodes == 1 else task.max_steps // task.total_episodes
    t_vals = [i / max_r for i in range(max_r + 1)]
    discount_vals = [math.exp(-alpha * math.exp(beta * t)) for t in t_vals]

    fig_disc = go.Figure()
    fig_disc.add_trace(go.Scatter(
        x=list(range(len(discount_vals))), y=discount_vals,
        mode="lines+markers",
        line=dict(color="#ff6b6b", width=2),
        marker=dict(size=6),
    ))
    fig_disc.update_layout(
        title="Time Discount Factor",
        xaxis_title="Round", yaxis_title="Discount",
        template="plotly_dark", height=350,
    )
    st.plotly_chart(fig_disc, use_container_width=True)


# ── Tells visualization ──────────────────────────────────────────

tells_data = [s for s in all_steps if s.get("tells")]
if tells_data:
    st.markdown("---")
    st.subheader("Seller Tells Analysis")

    tell_df = pd.DataFrame([
        {
            "round": s["round"],
            "urgency": s["tells"]["verbal_urgency"],
            "confidence": s["tells"]["verbal_confidence"],
            "deception": s["tells"]["verbal_deception_cue"],
            "fidget": s["tells"]["fidget_level"],
            "emotion": s["tells"]["emotional_escalation"],
        }
        for s in tells_data
    ])

    fig_tells = go.Figure()
    for col_name, color in [("urgency", "#ff6b6b"), ("confidence", "#4ecdc4"),
                             ("deception", "#ffd93d"), ("fidget", "#8b5cf6")]:
        fig_tells.add_trace(go.Scatter(
            x=tell_df["round"], y=tell_df[col_name],
            mode="lines+markers", name=col_name.capitalize(),
            line=dict(color=color, width=2),
        ))
    fig_tells.update_layout(
        template="plotly_dark", height=350,
        xaxis_title="Round", yaxis_title="Signal Strength (0-1)",
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
    )
    st.plotly_chart(fig_tells, use_container_width=True)


# ── Career history table ──────────────────────────────────────────

if task.enable_career and episode_data:
    st.markdown("---")
    st.subheader("Career History")

    career_df = pd.DataFrame([
        {
            "Episode": e["episode"],
            "Outcome": e["outcome"],
            "Agreed Price": f"{e['agreed_price']:.0f}" if e["agreed_price"] else "-",
            "Rounds": e["rounds"],
            "Surplus": f"{e['surplus']:.1%}",
        }
        for e in episode_data
    ])
    st.dataframe(career_df, use_container_width=True, hide_index=True)

    cap_rates = []
    cap_count = 0
    for i, e in enumerate(episode_data):
        anchor = custom_cost * custom_anchor_mult
        if e["agreed_price"] and e["agreed_price"] > anchor * 0.85:
            cap_count += 1
        cap_rates.append(cap_count / (i + 1))

    fig_cap = go.Figure()
    fig_cap.add_trace(go.Scatter(
        x=[e["episode"] for e in episode_data], y=cap_rates,
        mode="lines+markers",
        line=dict(color="#ff6b6b", width=2),
    ))
    fig_cap.add_hline(y=0.3, line_dash="dash", line_color="yellow",
                      annotation_text="Danger zone (seller exploits)")
    fig_cap.update_layout(
        title="Capitulation Rate Over Career",
        xaxis_title="Episode", yaxis_title="Capitulation Rate",
        template="plotly_dark", height=300,
    )
    st.plotly_chart(fig_cap, use_container_width=True)


# ── Negotiation log ──────────────────────────────────────────────

st.markdown("---")
with st.expander("Full Negotiation Log", expanded=False):
    for s in all_steps:
        if s.get("message"):
            prefix = f"**Ep{s['episode']} R{s['round']}**" if task.total_episodes > 1 else f"**R{s['round']}**"
            action_info = ""
            if s.get("buyer_offer") is not None:
                action_info = f" | Buyer offers: {s['buyer_offer']:.0f}"
            if s.get("action") == "accept":
                action_info = " | Buyer ACCEPTS"
            if s.get("action") == "walk":
                action_info = " | Buyer WALKS"
            reward_info = f" | Reward: {s.get('reward', 0):+.4f}" if s.get("reward") else ""
            st.markdown(f"{prefix}: {s['message']}{action_info}{reward_info}")

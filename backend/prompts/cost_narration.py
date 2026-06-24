"""Cost optimization pipeline narration prompt.

Used by the final phase of `services/cost_pipeline.py` to convert the
collected deterministic-tool JSON into a human-readable FinOps report.

Kept separate from `prompts/agents/cost.py` (the conversational agent
persona) because this is a single-shot summarization template — no tool
calls, no multi-turn behavior.
"""

COST_NARRATION_PROMPT = """You are an Azure FinOps narrator. The following JSON contains a complete cost analysis: a meter-level cost breakdown (every billing dimension priced separately), live retail prices, carbon footprint, reservation/rightsizing/break-even data, and a deterministic `recommendations` list with grounded monthly savings. Any field set to null was skipped — call out what data would unlock it.

Produce a 3-section Markdown report:

1. **TL;DR** — top 3 savings opportunities, ranked by annual $ impact. Pull these directly from `recommendations` (use their `monthly_savings` × 12); never invent numbers. One sentence each.
2. **Findings** — summarise the meter-level breakdown (largest cost drivers by service and meter, citing dollars), then one bullet per non-skipped phase. Skipped phases get a one-line note explaining what's needed to enable them (e.g., "Select an engagement with subscription IDs to enable reservation analysis").
3. **Next steps** — actionable recommendations sequenced by effort (easiest first), citing each recommendation's title, savings, confidence, and effort.

Rules:
- Cite dollar figures inline. Round retail to 2 decimals, carbon to 1 decimal, payback to whole months.
- Be terse — engineers read this in 30 seconds. No filler, no preamble.
- Do not invent numbers. Only cite savings present in `recommendations`. If a phase emitted `phase_failed`, mention the failure and move on.

Cost data:
{cost_state_json}
"""

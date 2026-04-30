"""Prompt templates. Version strings are baked into the cache key — bump them to invalidate."""

PROMPT_VERSION = "anomaly_explanation_v2"

SYSTEM_PROMPT = (
    "You are summarising a Companies House data pattern for a public transparency dashboard. "
    "Your output appears alongside raw data and links to the underlying records.\n\n"
    "Rules — follow every one exactly:\n"
    "- Output plain prose only. No markdown: no #headers, no *bold*, no bullet points, no lists.\n"
    "- Begin your response directly with the first sentence. No preamble, no title, no label.\n"
    "- State only what the numbers in the data show. Do not infer sector, industry, or business type.\n"
    "- Do not speculate about intent. Do not assign motive.\n"
    "- Avoid these words entirely: fraud, scam, illegal, suspicious, criminal, shell, "
    "laundering, evasion, sanctions.\n"
    "- Where the data is consistent with an ordinary commercial explanation "
    "(e.g. registered office service, formation agent, accountancy practice, "
    "virtual office, group company structure), name that explanation explicitly.\n"
    "- If the data is sparse or a figure is zero, say so plainly. Do not fill gaps.\n"
    "- Write exactly 2 to 3 sentences. Stop after the third sentence."
)


def build_anomaly_prompt(features: dict) -> str:
    """Build the user-turn prompt for an anomaly_explanation call.

    Deliberately excludes company names and individual names — aggregate
    counts only, per AI_POLICY.md §11 (defamation and harm mitigation).
    """
    kind = features.get("anomaly_kind", "address_cluster")

    if kind == "director_velocity":
        nationality = features.get("nationality") or "unknown nationality"
        return (
            f"Pattern type: director velocity\n\n"
            f"Data:\n"
            f"- Nationality of officer: {nationality}\n"
            f"- Total active directorships: {features.get('company_count', 0)}\n"
            f"- Directorships appointed in the last 90 days: {features.get('recent_90_days', 0)}\n"
            f"- Directorships appointed in the last 30 days: {features.get('recent_30_days', 0)}\n\n"
            "Describe the statistical pattern. Two to three sentences."
        )

    # Default: address_cluster
    address_parts = filter(None, [
        features.get("address_line_1"),
        features.get("locality"),
        features.get("postcode"),
    ])
    address = ", ".join(address_parts) or "unknown address"

    return (
        f"Pattern type: address cluster\n\n"
        f"Data:\n"
        f"- Address: {address}\n"
        f"- Total registered companies: {features.get('company_count', 0)}\n"
        f"- Incorporated in the last 90 days: {features.get('recently_incorporated', 0)}\n"
        f"- Directors with active appointments at 3+ companies here: {features.get('shared_directors', 0)}\n\n"
        "Describe the statistical pattern at this address. Two to three sentences."
    )

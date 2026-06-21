"""Engagement-agent tool schemas — ARB workflow wrappers.

These tools emit synthetic-ack events so the LLM can propose ARB actions
(submit a design, clear/waive a condition, transition status) while the
frontend mediates the actual REST call. Mirrors the `create_stakeholder_plan`
pattern: dispatch returns ``{"status": "..."}`` + an SSE event carrying the
LLM-populated args.
"""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "submit_arb_design",
            "description": (
                "Propose submitting the active bundled design to the Architecture Review Board (ARB). "
                "Use when the user asks to 'send for review', 'submit for ARB', 'freeze this design', "
                "or otherwise wants to capture a snapshot for reviewer sign-off. "
                "Returns a draft submission card — the frontend confirms before calling POST "
                "/engagements/{id}/arb/submissions."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "Human-readable title for this ARB submission (e.g., 'AKS baseline v2 — prod readiness').",
                    },
                    "summary": {
                        "type": "string",
                        "description": "1-2 sentence summary of what is being reviewed and what success looks like.",
                    },
                    "conditions": {
                        "type": "array",
                        "description": "Pre-filed approval conditions the user already knows the design will need.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "text": {"type": "string", "description": "Condition statement (e.g., 'Enable PIM for Key Vault admins')."},
                                "severity": {
                                    "type": "string",
                                    "enum": ["blocker", "major", "minor"],
                                    "description": "Blocker = must be cleared before approval; major/minor = trackable but lower urgency.",
                                },
                                "owner": {"type": "string", "description": "Person or team accountable for clearing the condition."},
                            },
                            "required": ["text", "severity"],
                        },
                    },
                },
                "required": ["title"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "clear_arb_condition",
            "description": (
                "Propose marking an ARB approval condition as cleared (resolved with evidence). "
                "Use when the user says 'we've done X', 'this is fixed', 'mark condition Y cleared', "
                "and provides evidence (URL, doc, ticket). Returns a confirmation card — frontend "
                "calls PATCH /arb/conditions/{id} with status=cleared."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "condition_id": {
                        "type": "string",
                        "description": "The condition's UUID. Ask the user or list open conditions first if unknown.",
                    },
                    "evidence_url": {
                        "type": "string",
                        "description": "Link to the evidence (Jira ticket, PR, doc, screenshot) proving the condition is met.",
                    },
                    "notes": {
                        "type": "string",
                        "description": "Optional reviewer-facing context about how the condition was resolved.",
                    },
                },
                "required": ["condition_id", "evidence_url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "waive_arb_condition",
            "description": (
                "Propose waiving an ARB approval condition (accepting the risk without remediation). "
                "Use when the user explicitly says the condition does not apply or risk is accepted. "
                "Returns a confirmation card — frontend calls PATCH /arb/conditions/{id} with "
                "status=waived. A waiver is a recorded risk acceptance, not a silent skip."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "condition_id": {
                        "type": "string",
                        "description": "The condition's UUID.",
                    },
                    "rationale": {
                        "type": "string",
                        "description": "Required justification: why is the residual risk acceptable for this workload?",
                    },
                },
                "required": ["condition_id", "rationale"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "transition_arb_status",
            "description": (
                "Propose transitioning an ARB submission's status. Allowed transitions: "
                "draft→submitted|withdrawn, submitted→in_review|withdrawn|rejected, "
                "in_review→approved|approved_with_conditions|rejected|withdrawn, "
                "approved_with_conditions→approved. Terminal states (approved/rejected/withdrawn) "
                "cannot transition further. Returns a confirmation card — frontend calls "
                "PATCH /arb/submissions/{id}."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "submission_id": {
                        "type": "string",
                        "description": "The submission's UUID.",
                    },
                    "target_status": {
                        "type": "string",
                        "enum": [
                            "submitted",
                            "in_review",
                            "approved",
                            "approved_with_conditions",
                            "rejected",
                            "withdrawn",
                        ],
                        "description": "The status to transition into. Must be reachable from the current status per the matrix.",
                    },
                    "decision_summary": {
                        "type": "string",
                        "description": "Required for approved/approved_with_conditions/rejected. Short reviewer rationale captured on the row.",
                    },
                },
                "required": ["submission_id", "target_status"],
            },
        },
    },
]

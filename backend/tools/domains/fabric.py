"""Microsoft Fabric capacity planning tool schema."""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "plan_fabric_capacity",
            "description": (
                "Produce a structured Microsoft Fabric F-SKU capacity recommendation based on "
                "a workload profile. Use published CU consumption rates for notebooks, pipelines, "
                "warehouses, and Power BI. Include comparison across F-SKU tiers and risks."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "recommended_sku": {
                        "type": "string",
                        "description": "Recommended F-SKU tier (F2, F4, F8, F16, F32, F64, F128, F256, F512).",
                    },
                    "workload_summary": {
                        "type": "string",
                        "description": "One-paragraph summary of the analysed workload.",
                    },
                    "sizing_rationale": {
                        "type": "string",
                        "description": "Why this SKU was recommended over adjacent tiers.",
                    },
                    "monthly_cost_usd": {
                        "type": "number",
                        "description": "Estimated monthly cost USD for the recommended SKU.",
                    },
                    "utilization_estimate": {
                        "type": "number",
                        "description": "Estimated peak CU utilisation percentage (0-100) on recommended SKU.",
                    },
                    "sku_options": {
                        "type": "array",
                        "description": "Comparison table across relevant SKU tiers.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "sku": {"type": "string"},
                                "cu_capacity": {"type": "number", "description": "Total CUs in this tier."},
                                "monthly_cost_usd": {"type": "number"},
                                "utilization_estimate": {"type": "number"},
                                "status": {
                                    "type": "string",
                                    "enum": ["under", "recommended", "over"],
                                    "description": "'under' = insufficient, 'over' = oversized, 'recommended' = best fit.",
                                },
                                "notes": {"type": "string"},
                            },
                            "required": ["sku", "cu_capacity", "monthly_cost_usd", "utilization_estimate", "status"],
                        },
                    },
                    "risks": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Key risks such as burst throttling, concurrency ceilings, or growth headroom.",
                    },
                    "pay_as_you_go_comparison": {
                        "type": "string",
                        "description": "Comparison between reserved capacity and pay-as-you-go for this workload.",
                    },
                },
                "required": [
                    "recommended_sku", "workload_summary", "sizing_rationale",
                    "monthly_cost_usd", "utilization_estimate", "sku_options",
                    "risks", "pay_as_you_go_comparison",
                ],
            },
        },
    },
]

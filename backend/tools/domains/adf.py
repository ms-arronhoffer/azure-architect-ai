"""Azure Data Factory pipeline generator tool schema."""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "generate_adf_pipeline",
            "description": (
                "Generate a complete, deployable Azure Data Factory ARM template for the described "
                "ingestion scenario. Include LinkedServices, Datasets, the Pipeline with activities, "
                "and a Schedule Trigger. Support incremental watermark, full load, CDC, API-to-lake, "
                "and SAP extract patterns."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "pipeline_name": {
                        "type": "string",
                        "description": "PascalCase name for the ADF pipeline.",
                    },
                    "pattern": {
                        "type": "string",
                        "description": "Ingestion pattern used (incremental_watermark, full_load, cdc_change_tracking, api_to_lake, sap_extract).",
                    },
                    "arm_template": {
                        "type": "string",
                        "description": (
                            "Full ADF ARM template JSON as a string. Must include: "
                            "factory resource, linkedServices array, datasets array, "
                            "pipelines array (with all Copy/Lookup/ForEach activities), "
                            "triggers array. Parameterise connection strings."
                        ),
                    },
                    "notes": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Deployment prerequisites, IR requirements, and parameterisation guidance.",
                    },
                },
                "required": ["pipeline_name", "pattern", "arm_template", "notes"],
            },
        },
    },
]

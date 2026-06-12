"""Medallion schema designer tool schema."""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "design_medallion_schema",
            "description": (
                "Design a complete Bronze / Silver / Gold medallion schema from source DDL or "
                "a description of the source system. Produce Delta Lake table definitions with "
                "partition columns, Z-ORDER hints, Unity Catalog paths, and SCD-2 history columns "
                "for Silver. Include quality columns and aggregate views for Gold."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "source_system": {
                        "type": "string",
                        "description": "Name or type of the source system (e.g. 'SAP S/4HANA', 'Azure SQL Orders DB').",
                    },
                    "layers": {
                        "type": "array",
                        "description": "Bronze, Silver, and Gold layer definitions.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "layer": {
                                    "type": "string",
                                    "enum": ["Bronze", "Silver", "Gold"],
                                },
                                "description": {
                                    "type": "string",
                                    "description": "Purpose and data quality level of this layer.",
                                },
                                "tables": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "name": {"type": "string"},
                                            "ddl": {
                                                "type": "string",
                                                "description": "CREATE TABLE ... USING DELTA DDL with all columns, partitioning, and TBLPROPERTIES.",
                                            },
                                            "delta_config": {
                                                "type": "string",
                                                "description": "OPTIMIZE / Z-ORDER / VACUUM recommendations.",
                                            },
                                            "unity_catalog_path": {
                                                "type": "string",
                                                "description": "Unity Catalog three-part identifier, e.g. catalog.bronze.orders_raw.",
                                            },
                                            "notes": {"type": "string"},
                                        },
                                        "required": ["name", "ddl"],
                                    },
                                },
                            },
                            "required": ["layer", "description", "tables"],
                        },
                    },
                    "governance_notes": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Purview scanning, sensitivity labels, data access policy, and lineage recommendations.",
                    },
                },
                "required": ["source_system", "layers", "governance_notes"],
            },
        },
    },
]

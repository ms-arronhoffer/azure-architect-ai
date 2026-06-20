# Azure Services — Demo Patterns

Reference this when designing demo architecture. Each entry describes what the service demos well, required Bicep resources, RBAC roles, and typical Azure OpenAI pairings.

---

## Azure OpenAI

**Demo strength:** LLM inference, structured output, embeddings, vision, real-time streaming.

**Required Bicep resources:**
```bicep
Microsoft.CognitiveServices/accounts  (kind: 'OpenAI', sku: 'S0')
Microsoft.CognitiveServices/accounts/deployments  (per model)
```

**RBAC role to assign to user:**
- `Cognitive Services OpenAI User` — `5e0bd9bd-7b93-4f28-af87-19fc36ad61bd`

**Common deployment configs:**
| Model | Use case | Sku | Capacity |
|---|---|---|---|
| `gpt-4o` | Vision, complex reasoning | Standard | 10 |
| `gpt-4o-mini` | Classification, extraction (budget) | Standard | 30 |
| `gpt-4.1` | Discovery, structured output | Standard | 10 |
| `text-embedding-3-small` | Semantic similarity | Standard | 30 |

**Connection pattern (keyless):**
```python
from azure.identity import DefaultAzureCredential
from openai import AzureOpenAI
import azure.identity

credential = DefaultAzureCredential()
token_provider = azure.identity.get_bearer_token_provider(
    credential, "https://cognitiveservices.azure.com/.default"
)
client = AzureOpenAI(
    azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
    azure_ad_token_provider=token_provider,
    api_version="2025-01-01-preview",
)
```

---

## Azure AI Search

**Demo strength:** Hybrid search (BM25 + vector), semantic ranking, knowledge mining, RAG grounding.

**Required Bicep resources:**
```bicep
Microsoft.Search/searchServices  (sku: 'basic' — minimum tier for semantic ranking)
```

**RBAC roles to assign:**
- `Search Service Contributor` — `7ca78c08-252a-4471-8644-bb5ff32d4ba0` (create/manage indexes)
- `Search Index Data Contributor` — `8ebe5a00-799e-43f5-93ac-243d3dce84a7` (read/write documents)

**Key settings:**
```bicep
properties: {
  semanticSearch: 'free'
  disableLocalAuth: true
  publicNetworkAccess: 'enabled'
}
```

**Typical pairing:** Azure OpenAI text-embedding-3-small for vector fields + gpt-4o for answer synthesis.

---

## Azure Document Intelligence

**Demo strength:** Form recognition, table extraction, layout analysis, custom models.

**Required Bicep resources:**
```bicep
Microsoft.CognitiveServices/accounts  (kind: 'FormRecognizer', sku: 'S0')
```

**RBAC role:**
- `Cognitive Services User` — `a97b65f3-24c7-4388-baec-2e87135dc908`

**Typical pairing:** Azure OpenAI for post-processing extracted fields.

---

## Azure Blob Storage

**Demo strength:** Document storage, batch processing, CDN for static assets.

**Required Bicep resources:**
```bicep
Microsoft.Storage/storageAccounts  (kind: 'StorageV2', sku: 'Standard_LRS')
Microsoft.Storage/storageAccounts/blobServices/containers
```

**RBAC role:**
- `Storage Blob Data Contributor` — `ba92f5b4-2d11-453d-a403-e96b0029c9fe`

---

## Azure Cosmos DB (NoSQL)

**Demo strength:** Schema-flexible document storage, change feed, global distribution.

**Required Bicep resources:**
```bicep
Microsoft.DocumentDB/databaseAccounts  (kind: 'GlobalDocumentDB')
Microsoft.DocumentDB/databaseAccounts/sqlDatabases
Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers
```

**RBAC role:**
- `Cosmos DB Built-in Data Contributor` — `00000000-0000-0000-0000-000000000002` (data plane)

---

## Azure Service Bus

**Demo strength:** Reliable async messaging, fan-out, dead-letter queuing.

**Required Bicep resources:**
```bicep
Microsoft.ServiceBus/namespaces  (sku: 'Standard')
Microsoft.ServiceBus/namespaces/queues  (or /topics)
```

**RBAC role:**
- `Azure Service Bus Data Owner` — `090c5cfd-751d-490a-894a-3ce6f1109419`

---

## Azure Container Apps

**Demo strength:** Microservices, event-driven scaling, multi-agent containerized systems.

**Required Bicep resources:**
```bicep
Microsoft.App/managedEnvironments
Microsoft.App/containerApps
Microsoft.OperationalInsights/workspaces  (Log Analytics)
```

---

## Azure Functions

**Demo strength:** Event-driven serverless, scheduled tasks, HTTP triggers.

**Required Bicep resources:**
```bicep
Microsoft.Web/serverfarms  (sku: 'Y1' for Consumption)
Microsoft.Web/sites  (kind: 'functionapp')
Microsoft.Storage/storageAccounts  (required for Functions)
```

---

## Azure App Service

**Demo strength:** Web app hosting for Flask/FastAPI demos, production deployment.

**Required Bicep resources:**
```bicep
Microsoft.Web/serverfarms  (sku: 'B1' or 'S1')
Microsoft.Web/sites
```

---

## Azure Speech

**Demo strength:** Speech-to-text, text-to-speech, real-time transcription.

**Required Bicep resources:**
```bicep
Microsoft.CognitiveServices/accounts  (kind: 'SpeechServices', sku: 'S0')
```

**RBAC role:**
- `Cognitive Services Speech User` — `f2dc8367-1007-4938-bd23-fe263f013447`

---

## Azure AI Foundry (AI Hub + Project)

**Demo strength:** Model catalog, agent framework, evaluations, fine-tuning.

**Required Bicep resources:**
```bicep
Microsoft.MachineLearningServices/workspaces  (kind: 'Hub')
Microsoft.MachineLearningServices/workspaces  (kind: 'Project')
Microsoft.Storage/storageAccounts
Microsoft.KeyVault/vaults
Microsoft.Insights/components  (Application Insights)
```

# Demo Standards

Quality bar and conventions for all generated demos. The reference implementation is:
`C:\Users\arronhoffer\OneDrive - Microsoft\TempPWD\DocumentClassification_SelfEvolving`

---

## Project Structure

Every demo follows this layout:

```
{demo-slug}/
├── app.py                    # Flask entry point, SSE routes
├── {service}.py              # Service-specific logic (classifier.py, search_client.py, etc.)
├── requirements.txt
├── .env.example              # All required env vars with comments, no values
├── .gitignore
├── samples/                  # 3-5 representative input files
├── infra/
│   ├── main.bicep
│   └── main.bicepparam
├── static/
│   ├── css/style.css
│   └── js/main.js
├── templates/
│   ├── base.html             # Bootstrap 5 base with theme toggle
│   └── index.html
├── README.md
├── ARCHITECTURE.md
└── DEPLOYMENT.md
```

---

## Flask App Conventions

### SSE Pattern
Every demo that has multi-step processing uses SSE:

```python
from flask import Flask, Response, stream_with_context
import json, queue, threading

app = Flask(__name__)

@app.route('/process', methods=['POST'])
def process():
    file = request.files.get('file')
    status_queue = queue.Queue()

    def worker():
        try:
            status_queue.put({'type': 'status', 'message': 'Step 1: ...'})
            result = do_work(file)
            status_queue.put({'type': 'result', 'data': result})
        except Exception as e:
            status_queue.put({'type': 'error', 'message': str(e)})
        finally:
            status_queue.put(None)  # sentinel

    threading.Thread(target=worker, daemon=True).start()

    def generate():
        while True:
            item = status_queue.get()
            if item is None:
                break
            yield f"data: {json.dumps(item)}\n\n"

    return Response(stream_with_context(generate()), mimetype='text/event-stream')
```

### Authentication
Always use `DefaultAzureCredential`. Never use API key auth:

```python
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from openai import AzureOpenAI

token_provider = get_bearer_token_provider(
    DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"
)
client = AzureOpenAI(
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
    azure_ad_token_provider=token_provider,
    api_version="2025-01-01-preview",
)
```

### File Upload
```python
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16 MB
ALLOWED_EXTENSIONS = {'pdf', 'jpg', 'jpeg', 'png', 'tiff', 'bmp'}
```

---

## Frontend Conventions

### Bootstrap Version
Bootstrap 5 via CDN. Dark/light theme toggle persisted in `localStorage`.

### Base Template Structure
```html
<!DOCTYPE html>
<html data-bs-theme="dark" lang="en">
<head>
  <meta charset="UTF-8">
  <title>{% block title %}Demo{% endblock %}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">
  <link rel="stylesheet" href="{{ url_for('static', filename='css/style.css') }}">
</head>
<body>
  <nav class="navbar navbar-expand-lg bg-body-secondary">
    <div class="container-fluid">
      <span class="navbar-brand fw-semibold">{% block brand %}Demo{% endblock %}</span>
      <button id="themeToggle" class="btn btn-sm btn-outline-secondary ms-auto">
        <i class="bi bi-moon-fill" id="themeIcon"></i>
      </button>
    </div>
  </nav>
  <main class="container-fluid py-3">
    {% block content %}{% endblock %}
  </main>
  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
  <script src="{{ url_for('static', filename='js/main.js') }}"></script>
</body>
</html>
```

### Two-Panel Layout
```html
<div class="row g-3">
  <div class="col-lg-4">
    <!-- Input panel: upload, controls, "How It Works" accordion -->
  </div>
  <div class="col-lg-8">
    <!-- Output panel: status feed, results -->
  </div>
</div>
```

### SSE Consumer JS Pattern
```javascript
const evtSource = new EventSource('/process');

evtSource.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'status') appendStatus(msg.message);
  if (msg.type === 'result') renderResult(msg.data);
  if (msg.type === 'error')  showError(msg.message);
};

evtSource.onerror = () => evtSource.close();

function appendStatus(text) {
  const feed = document.getElementById('statusFeed');
  const item = document.createElement('div');
  item.className = 'status-item';
  item.textContent = text;
  feed.appendChild(item);
  feed.scrollTop = feed.scrollHeight;
}
```

### Theme Toggle JS (always include)
```javascript
const html = document.documentElement;
const btn = document.getElementById('themeToggle');
const icon = document.getElementById('themeIcon');

const saved = localStorage.getItem('theme') || 'dark';
html.setAttribute('data-bs-theme', saved);
icon.className = saved === 'dark' ? 'bi bi-moon-fill' : 'bi bi-sun-fill';

btn.addEventListener('click', () => {
  const next = html.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-bs-theme', next);
  icon.className = next === 'dark' ? 'bi bi-moon-fill' : 'bi bi-sun-fill';
  localStorage.setItem('theme', next);
});
```

---

## Documentation Standards

### README.md Sections (in order)
1. **Title + one-line description**
2. **Screenshot or architecture diagram** (inline image)
3. **Features** — 3-6 bullet points on what it demos
4. **Prerequisites** — Python version, Azure CLI, required Azure roles
5. **Quick Start** — 5 numbered steps max: clone → install → deploy infra → configure .env → run
6. **Usage** — How to use the demo, what inputs to try
7. **Architecture** — Link to ARCHITECTURE.md
8. **API Reference** — Table of endpoints (route, method, purpose)
9. **Project Structure** — Code tree with one-line descriptions

### ARCHITECTURE.md Sections (in order)
1. **Component Architecture** — Mermaid `flowchart LR` showing all components and connections
2. **Request/Processing Flow** — Mermaid `flowchart TD` or `sequenceDiagram` showing the main workflow
3. **Data Flow** — Where data comes from, how it's transformed, where it ends up
4. **Optional Enterprise Extension** — How to scale this to production (Blob, Cosmos, Service Bus)

---

## requirements.txt Conventions

Pin major versions, allow patch updates:

```
flask>=3.1.0
azure-identity>=1.19.0
openai>=1.30.0
python-dotenv>=1.2.0
```

---

## .env.example Conventions

Every variable gets a comment explaining what it is and how to get it:

```bash
# Azure OpenAI endpoint — from Azure portal or Bicep output
AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com/

# Deployment names — must match what you deployed in infra/main.bicep
AZURE_OPENAI_DEPLOYMENT=gpt-4o-mini
EMBEDDING_MODEL_DEPLOYMENT=text-embedding-3-small

# Optional tuning
SIMILARITY_THRESHOLD=0.82   # 0.0–1.0; lower = more matches, higher = more precision
```

---

## Code Quality Rules

1. **No hardcoded values** — all config from `os.environ` with `.env` loading via `python-dotenv`
2. **No API keys in code** — `DefaultAzureCredential` only
3. **HTML-escape all user input** before rendering — prevent XSS
4. **Max file size enforced server-side** — don't trust client-side validation
5. **Graceful error handling** — all errors surfaced to SSE stream, never silently swallowed
6. **No print statements** — use Python `logging` module
7. **No `requirements.txt` with unpinned `*`** — always pin major version

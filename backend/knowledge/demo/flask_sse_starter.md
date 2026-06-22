# Flask + SSE Starter Template

This is a reference template for Flask + Server-Sent Events demos. When generating a new demo, use this as the structural baseline and customize the processing logic, routes, and UI for the specific demo idea.

## File: app.py

```python
import os
import json
import queue
import threading
import logging
from pathlib import Path
from flask import Flask, render_template, request, Response, stream_with_context
from dotenv import load_dotenv
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from openai import AzureOpenAI

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16 MB

ALLOWED_EXTENSIONS = {'pdf', 'jpg', 'jpeg', 'png', 'txt'}

# Azure OpenAI client (keyless via DefaultAzureCredential)
_token_provider = get_bearer_token_provider(
    DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"
)
client = AzureOpenAI(
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
    azure_ad_token_provider=_token_provider,
    api_version="2025-01-01-preview",
)
DEPLOYMENT = os.environ.get("AZURE_OPENAI_DEPLOYMENT", "gpt-4o-mini")


def allowed_file(filename: str) -> bool:
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/process', methods=['POST'])
def process():
    """SSE endpoint — streams processing status and final result."""
    if 'file' not in request.files:
        return {'error': 'No file provided'}, 400
    file = request.files['file']
    if not file.filename or not allowed_file(file.filename):
        return {'error': 'Invalid file type'}, 400

    file_bytes = file.read()
    filename = file.filename
    status_queue: queue.Queue = queue.Queue()

    def worker():
        try:
            # ── Replace this section with your demo-specific logic ──────────
            status_queue.put({'type': 'status', 'message': 'Processing started...'})

            # Example: call Azure OpenAI
            result = call_openai(file_bytes, filename, status_queue)

            status_queue.put({'type': 'result', 'data': result})
            # ───────────────────────────────────────────────────────────────
        except Exception as e:
            log.exception("Processing error")
            status_queue.put({'type': 'error', 'message': str(e)})
        finally:
            status_queue.put(None)  # sentinel — tells generator to stop

    threading.Thread(target=worker, daemon=True).start()

    def generate():
        while True:
            item = status_queue.get()
            if item is None:
                break
            yield f"data: {json.dumps(item)}\n\n"

    return Response(stream_with_context(generate()), mimetype='text/event-stream')


def call_openai(file_bytes: bytes, filename: str, status_queue: queue.Queue) -> dict:
    """Replace with your demo-specific OpenAI call."""
    status_queue.put({'type': 'status', 'message': 'Calling Azure OpenAI...'})

    response = client.chat.completions.create(
        model=DEPLOYMENT,
        messages=[
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": f"Analyze this file: {filename}"},
        ],
        max_completion_tokens=1000,
    )

    return {
        "answer": response.choices[0].message.content,
        "model": response.model,
    }


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
```

---

## File: templates/base.html

```html
<!DOCTYPE html>
<html data-bs-theme="dark" lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{% block title %}Demo{% endblock %}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">
  <link rel="stylesheet" href="{{ url_for('static', filename='css/style.css') }}">
</head>
<body>
  <nav class="navbar navbar-expand-lg bg-body-secondary px-3 py-2">
    <span class="navbar-brand fw-semibold">
      <i class="bi bi-lightning-charge-fill text-primary me-1"></i>
      {% block brand %}Demo{% endblock %}
    </span>
    <div class="ms-auto d-flex align-items-center gap-2">
      {% block nav_extra %}{% endblock %}
      <button id="themeToggle" class="btn btn-sm btn-outline-secondary" title="Toggle theme">
        <i class="bi bi-moon-fill" id="themeIcon"></i>
      </button>
    </div>
  </nav>

  <main class="container-fluid py-3">
    {% block content %}{% endblock %}
  </main>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
  <script src="{{ url_for('static', filename='js/main.js') }}"></script>
  {% block scripts %}{% endblock %}
</body>
</html>
```

---

## File: templates/index.html

```html
{% extends "base.html" %}

{% block title %}Demo{% endblock %}
{% block brand %}Demo Name{% endblock %}

{% block content %}
<div class="row g-3">

  <!-- Left panel: input + controls -->
  <div class="col-lg-4">
    <div class="card h-100">
      <div class="card-header fw-semibold">
        <i class="bi bi-upload me-1"></i> Input
      </div>
      <div class="card-body d-flex flex-column gap-3">

        <!-- Drop zone -->
        <div id="dropZone" class="drop-zone border rounded p-4 text-center">
          <i class="bi bi-file-earmark-arrow-up fs-2 text-muted mb-2 d-block"></i>
          <p class="mb-1 text-muted small">Drag & drop a file here</p>
          <label class="btn btn-sm btn-outline-primary">
            Browse <input id="fileInput" type="file" class="d-none" accept=".pdf,.jpg,.jpeg,.png,.txt">
          </label>
        </div>

        <!-- File info -->
        <div id="fileInfo" class="d-none">
          <div class="d-flex align-items-center gap-2 p-2 bg-body-secondary rounded">
            <i class="bi bi-file-earmark text-primary"></i>
            <span id="fileName" class="small text-truncate flex-grow-1"></span>
            <span id="fileSize" class="small text-muted"></span>
          </div>
        </div>

        <!-- Submit -->
        <button id="processBtn" class="btn btn-primary" disabled>
          <i class="bi bi-play-fill me-1"></i> Process
        </button>

        <!-- How it works -->
        <div class="accordion accordion-flush" id="howItWorks">
          <div class="accordion-item">
            <h2 class="accordion-header">
              <button class="accordion-button collapsed px-0 bg-transparent" type="button"
                      data-bs-toggle="collapse" data-bs-target="#howItWorksBody">
                <i class="bi bi-info-circle me-2"></i> How it works
              </button>
            </h2>
            <div id="howItWorksBody" class="accordion-collapse collapse">
              <div class="accordion-body px-0 small text-muted">
                <ol class="ps-3 mb-0">
                  <li>Upload a file using the drop zone above.</li>
                  <li>Azure OpenAI processes your file in real time.</li>
                  <li>Results stream back as each step completes.</li>
                </ol>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  </div>

  <!-- Right panel: status + results -->
  <div class="col-lg-8">
    <div class="card h-100">
      <div class="card-header fw-semibold">
        <i class="bi bi-activity me-1"></i> Results
      </div>
      <div class="card-body d-flex flex-column gap-3">

        <!-- Status feed -->
        <div id="statusFeed" class="status-feed d-none"></div>

        <!-- Results area -->
        <div id="resultArea" class="d-none"></div>

        <!-- Empty state -->
        <div id="emptyState" class="text-center text-muted py-5">
          <i class="bi bi-arrow-left-circle fs-1 d-block mb-2 opacity-50"></i>
          <p class="small">Upload a file to get started</p>
        </div>

      </div>
    </div>
  </div>

</div>
{% endblock %}
```

---

## File: static/js/main.js

```javascript
// ── State ──────────────────────────────────────────────────────────────────
let selectedFile = null;

// ── Theme toggle ───────────────────────────────────────────────────────────
const html = document.documentElement;
const themeBtn = document.getElementById('themeToggle');
const themeIcon = document.getElementById('themeIcon');

(function initTheme() {
  const saved = localStorage.getItem('theme') || 'dark';
  html.setAttribute('data-bs-theme', saved);
  themeIcon.className = saved === 'dark' ? 'bi bi-moon-fill' : 'bi bi-sun-fill';
})();

themeBtn.addEventListener('click', () => {
  const next = html.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-bs-theme', next);
  themeIcon.className = next === 'dark' ? 'bi bi-moon-fill' : 'bi bi-sun-fill';
  localStorage.setItem('theme', next);
});

// ── File selection ─────────────────────────────────────────────────────────
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const fileSize = document.getElementById('fileSize');
const processBtn = document.getElementById('processBtn');

function onFileSelected(file) {
  selectedFile = file;
  fileName.textContent = file.name;
  fileSize.textContent = formatBytes(file.size);
  fileInfo.classList.remove('d-none');
  processBtn.disabled = false;
}

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) onFileSelected(fileInput.files[0]);
});

dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files[0]) onFileSelected(e.dataTransfer.files[0]);
});

// ── Processing ─────────────────────────────────────────────────────────────
processBtn.addEventListener('click', () => {
  if (!selectedFile) return;
  startProcessing(selectedFile);
});

function startProcessing(file) {
  const formData = new FormData();
  formData.append('file', file);

  // Reset UI
  document.getElementById('statusFeed').innerHTML = '';
  document.getElementById('statusFeed').classList.remove('d-none');
  document.getElementById('resultArea').classList.add('d-none');
  document.getElementById('emptyState').classList.add('d-none');
  processBtn.disabled = true;

  fetch('/process', { method: 'POST', body: formData })
    .then(response => {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      function read() {
        reader.read().then(({ done, value }) => {
          if (done) { processBtn.disabled = false; return; }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                handleEvent(JSON.parse(line.slice(6)));
              } catch (_) {}
            }
          }
          read();
        });
      }
      read();
    })
    .catch(err => {
      appendStatus('Error: ' + err.message, 'text-danger');
      processBtn.disabled = false;
    });
}

function handleEvent(msg) {
  if (msg.type === 'status') appendStatus(msg.message);
  if (msg.type === 'result') renderResult(msg.data);
  if (msg.type === 'error')  appendStatus('Error: ' + msg.message, 'text-danger');
}

function appendStatus(text, extraClass = '') {
  const feed = document.getElementById('statusFeed');
  const item = document.createElement('div');
  item.className = `status-item ${extraClass}`;
  item.textContent = text;
  feed.appendChild(item);
  feed.scrollTop = feed.scrollHeight;
}

function renderResult(data) {
  const area = document.getElementById('resultArea');
  // Customize this to match your demo's result shape
  area.innerHTML = `<pre class="bg-body-secondary rounded p-3 small">${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
  area.classList.remove('d-none');
}

// ── Utilities ──────────────────────────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
```

---

## File: static/css/style.css

```css
/* Drop zone */
.drop-zone {
  cursor: pointer;
  transition: border-color 0.2s, background-color 0.2s;
  border-style: dashed !important;
}
.drop-zone:hover,
.drop-zone.drag-over {
  border-color: var(--bs-primary) !important;
  background-color: rgba(var(--bs-primary-rgb), 0.05);
}

/* Status feed */
.status-feed {
  max-height: 200px;
  overflow-y: auto;
  font-size: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.status-item {
  padding: 4px 8px;
  border-radius: 4px;
  background: rgba(var(--bs-secondary-rgb), 0.15);
  animation: fadeIn 0.2s ease-in;
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

---

## File: requirements.txt

```
flask>=3.1.0
azure-identity>=1.19.0
openai>=1.30.0
python-dotenv>=1.2.0
```

---

## File: .env.example

```bash
# Azure OpenAI — from Azure portal or Bicep output
AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com/

# Deployment name — must match what you created in infra/main.bicep
AZURE_OPENAI_DEPLOYMENT=gpt-4o-mini
```

---

## File: .gitignore

```
__pycache__/
*.pyc
.env
*.json.bak
*.log
.venv/
venv/
output/
```

---

# REQUIRED: canonical activity events + Bootstrap Activity Panel

The `{type: 'status'}` messages above are the legacy floor. A world-class demo
MUST emit the **canonical event schema** from `activity_protocol.md` and render a
Bootstrap **Azure Activity Panel** so the audience sees what Azure is doing live.

## Backend — emit `activity` events instead of bare status

Use the `Activity` helper from `activity_protocol.md` inside the worker. Each
Azure call brackets an `active` then a `done` event carrying `service`,
`step_id`, `stage`, `detail`, `latency_ms`, and `tokens`. Finish with one
`result` (or `error`). `step_id` values must match the design's
`live_activity[].step_id` (and the diagram node ids).

```python
def call_openai(file_bytes, filename, status_queue):
    act = Activity(status_queue)
    t = act.step("generate", "Azure OpenAI", "Analyzing", f"Reasoning over {filename}",
                 deployment=DEPLOYMENT)
    resp = client.chat.completions.create(model=DEPLOYMENT, messages=[...],
                                          max_completion_tokens=1000)
    t.done(tokens=getattr(resp.usage, "total_tokens", None))
    return {"answer": resp.choices[0].message.content}
```

## Frontend — static/js/activity.js (Azure Activity Panel)

```javascript
// Service rail + live narrative feed driven by canonical activity events.
const roles = window.SERVICE_ROLES || {};   // {service: "plain-language role"}
const rail = document.getElementById('serviceRail');
const feed = document.getElementById('narrativeFeed');
const chips = {};

function chipFor(ev) {
  if (chips[ev.step_id]) return chips[ev.step_id];
  const el = document.createElement('div');
  el.className = 'activity-chip d-flex align-items-center gap-2 p-2 mb-2 rounded border';
  el.innerHTML = `<i class="bi bi-cloud"></i>
    <span><strong>${ev.service}</strong> <small class="text-secondary stage"></small></span>
    <span class="ms-auto meta d-flex gap-2 align-items-center"></span>`;
  if (roles[ev.service]) {
    const info = document.createElement('i');
    info.className = 'bi bi-info-circle ms-1';
    info.tabIndex = 0; info.title = roles[ev.service];
    el.querySelector('.meta').appendChild(info);
  }
  rail.appendChild(el);
  return (chips[ev.step_id] = el);
}

function onActivity(ev) {
  const el = chipFor(ev);
  el.querySelector('.stage').textContent =
    '· ' + ev.stage + (ev.deployment ? ` (${ev.deployment})` : '');
  el.classList.toggle('chip-active', ev.status === 'active');
  el.classList.toggle('chip-done', ev.status === 'done');
  const meta = el.querySelector('.meta');
  meta.querySelectorAll('.badge').forEach(b => b.remove());
  if (ev.tokens != null) meta.insertAdjacentHTML('afterbegin', `<span class="badge text-bg-info">${ev.tokens} tok</span>`);
  if (ev.latency_ms != null) meta.insertAdjacentHTML('afterbegin', `<span class="badge text-bg-secondary">${ev.latency_ms} ms</span>`);
  if (ev.status === 'active' && ev.detail) {
    const item = document.createElement('div');
    item.className = 'feed-item small px-2 py-1 mb-1 rounded';
    item.textContent = ev.detail;
    feed.appendChild(item); feed.scrollTop = feed.scrollHeight;
  }
}

async function runStream(url, body) {
  const res = await fetch(url, { method: 'POST', body });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const ev = JSON.parse(line.slice(6));
      if (ev.type === 'activity') onActivity(ev);
      if (ev.type === 'result') renderResult(ev.data);   // archetype-specific
      if (ev.type === 'error') showError(ev.message);
    }
  }
}
```

## static/css activity styles

```css
.activity-chip { transition: all .25s ease; }
.chip-active { border-color: var(--bs-primary) !important; box-shadow: 0 0 0 3px rgba(40,153,245,.25); }
.chip-done { border-color: var(--bs-success) !important; }
.feed-item { border-left: 2px solid var(--bs-primary); background: var(--bs-secondary-bg);
  animation: feedIn .25s ease; }
@keyframes feedIn { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .activity-chip, .feed-item { animation: none; transition: none; } }
```

`renderResult(data)` MUST be a purpose-built renderer for the demo archetype
(chat bubbles, cited passages, annotated image, agent trace, table/chart) — never
`JSON.stringify` into a `<pre>` as the primary output. Set `window.SERVICE_ROLES`
from the design `behind_the_scenes[]` so each chip explains its service's role.

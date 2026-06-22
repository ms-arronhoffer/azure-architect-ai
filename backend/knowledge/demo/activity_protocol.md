# Azure Activity Protocol — Canonical SSE Event Schema + Activity Panel

This is the **single most important quality differentiator** for a world-class
demo: the running UI must *visibly explain what Azure is doing behind the
scenes, live, as it happens*. Every generated demo MUST implement this protocol.

There are two halves:

1. A **canonical SSE event schema** the backend emits.
2. An **Azure Activity Panel** the frontend renders from those events.

---

## 1. Canonical SSE Event Schema

Every demo with server-side processing streams **structured JSON events** over
Server-Sent Events. The legacy `{type: status|result|error}` shape is no longer
sufficient — it carries no Azure attribution. Emit these event types instead.

### `activity` — a service-attributed processing step

The backbone of the "behind the scenes" story. One event per logical step,
emitted at least twice per step (`active` then `done`) so the UI can animate.

```json
{
  "type": "activity",
  "step_id": "embed",
  "service": "Azure OpenAI",
  "deployment": "text-embedding-3-small",
  "stage": "Generating embeddings",
  "detail": "Embedding the user's question into a 1536-dim vector",
  "status": "active",
  "latency_ms": null,
  "tokens": null
}
```

Field reference:

| Field        | Type            | Required | Notes |
|--------------|-----------------|----------|-------|
| `type`       | `"activity"`    | yes      | Discriminator. |
| `step_id`    | string          | yes      | Stable id that matches a node in the architecture diagram (see §3). |
| `service`    | string          | yes      | Exact Azure service name, e.g. `"Azure OpenAI"`, `"Azure AI Search"`. Must match an entry in `azure_services` / `behind_the_scenes`. |
| `deployment` | string          | no       | Model/deployment/index name, e.g. `"gpt-4o-mini"`. |
| `stage`      | string          | yes      | Short human label shown on the chip, e.g. `"Generating embeddings"`. |
| `detail`     | string          | no       | One-sentence plain-language explanation shown in the narrative feed. |
| `status`     | enum            | yes      | `pending` \| `active` \| `done` \| `error`. |
| `latency_ms` | number \| null  | no       | Wall-clock ms for the step; send on the `done` event. |
| `tokens`     | number \| null  | no       | Tokens used (prompt+completion) when the step calls a model. |

### `token` — streamed model output (optional, for chat/generation archetypes)

```json
{ "type": "token", "step_id": "generate", "text": "Hello" }
```

### `result` — the final, structured result payload

```json
{ "type": "result", "data": { "...": "demo-specific shape" } }
```

Never dump raw JSON to the user as the primary result. `data` is consumed by a
purpose-built renderer (see archetype variants in `react_ts_starter.md`).

### `error` — surfaced failure

```json
{ "type": "error", "step_id": "search", "service": "Azure AI Search", "message": "..." }
```

### Emission rules (backend)

1. Before each Azure call, emit `activity` with `status: "active"`.
2. After it returns, emit `activity` with `status: "done"`, `latency_ms`, and
   `tokens` when applicable.
3. `step_id` values MUST be stable and MUST match the `live_activity[].step_id`
   from the architecture design and the diagram node ids.
4. Always finish with exactly one `result` (or `error`).
5. Wrap every step in try/except and surface failures as `error` events — never
   swallow them.

A Flask helper that conforms to this protocol:

```python
import time, json, queue

class Activity:
    """Helper that emits canonical activity events to an SSE queue."""
    def __init__(self, q: "queue.Queue"):
        self.q = q

    def step(self, step_id, service, stage, detail="", deployment=None):
        self.q.put({"type": "activity", "step_id": step_id, "service": service,
                    "deployment": deployment, "stage": stage, "detail": detail,
                    "status": "active", "latency_ms": None, "tokens": None})
        return _StepTimer(self.q, step_id, service, stage, deployment)

class _StepTimer:
    def __init__(self, q, step_id, service, stage, deployment):
        self.q, self.step_id, self.service = q, step_id, service
        self.stage, self.deployment, self.t0 = stage, deployment, time.perf_counter()
    def done(self, tokens=None):
        self.q.put({"type": "activity", "step_id": self.step_id,
                    "service": self.service, "deployment": self.deployment,
                    "stage": self.stage, "detail": "", "status": "done",
                    "latency_ms": round((time.perf_counter() - self.t0) * 1000),
                    "tokens": tokens})

# usage inside the worker thread:
#   act = Activity(status_queue)
#   t = act.step("embed", "Azure OpenAI", "Generating embeddings",
#                "Embedding the question", deployment="text-embedding-3-small")
#   vec = embed(question)
#   t.done(tokens=8)
```

---

## 2. The Azure Activity Panel (frontend)

A persistent panel — always visible during processing — that turns the event
stream into a live, service-attributed story. It has three parts:

1. **Service rail** — one chip/node per Azure service. State machine:
   `idle → active (pulsing/glowing) → done (check) | error`. Shows the live
   `stage` label and, on completion, `latency_ms` and `tokens`.
2. **Narrative feed** — an append-only, auto-scrolling timeline of the `detail`
   strings ("Generating embeddings with text-embedding-3-small…"). This is the
   "explain it as it happens" surface.
3. **"What this service does" affordance** — each service chip is expandable (a
   `Popover`/`Tooltip`) showing a one-paragraph plain-language description of the
   service's role, sourced from the design's `behind_the_scenes[]` and the
   `azure_services.md` reference cards.

The reference implementation of this component lives in `react_ts_starter.md`
(`AzureActivityPanel.tsx`) and `flask_sse_starter.md` (Bootstrap variant). The
code agent MUST generate it.

---

## 3. Live Architecture Diagram

Render the design's `component` Mermaid diagram **inside the running app** and
highlight each node as its corresponding service fires. The contract that makes
this work: **`live_activity[].step_id` === diagram node id === `activity.step_id`**.

When a node has no live event yet it renders dimmed; `active` glows; `done` gets
a check accent. This ties the static architecture picture to the live run and is
a reliable "wow" moment for technical audiences.

---

## 4. Mocked playback (for previews without Azure)

So the UX can be previewed before deployment, the architecture design emits a
`live_activity` script: an ordered list of steps with `step_id`, `service`,
`stage`, `detail`, and an approximate `duration_ms`. A demo's frontend SHOULD
accept a `?mock=1` query param that replays this script with timers instead of
hitting the backend, driving the exact same Activity Panel. This is also what
the Demo Builder uses to render an in-app preview.

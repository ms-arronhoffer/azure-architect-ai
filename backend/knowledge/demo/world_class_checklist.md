# World-Class Demo Checklist

The bar every generated demo must clear before it is considered "done". The
build agents self-check against this list; the design agent encodes the
requirements that make it achievable. This is the explicit, versioned definition
of "world-class" referenced by all demo build prompts.

---

## 1. Modern, polished UI (not a toy)

- [ ] **Deliberate visual design** — refined theme, consistent spacing scale,
      typographic hierarchy. Not raw default Bootstrap or unstyled `webDarkTheme`.
- [ ] **Hero / landing state** — a clear, branded first impression that states
      what the demo does in one line and invites the first action.
- [ ] **Responsive two-pane layout** — input/controls on one side, live output on
      the other; collapses gracefully on narrow widths.
- [ ] **Motion & transitions** — chips animate between states, the narrative feed
      slides in, results fade/expand. Subtle, purposeful, never gratuitous.
- [ ] **Skeleton loaders / progress** — never a bare spinner with no context.
- [ ] **Empty, loading, and error states** — all three designed, not afterthoughts.
- [ ] **Light/dark theme toggle**, persisted.

## 2. Live "behind the scenes" Azure attribution (the core differentiator)

- [ ] Implements the **Azure Activity Protocol** (`activity_protocol.md`):
      structured SSE events with `service`, `step_id`, `stage`, `detail`,
      `status`, `latency_ms`, `tokens`.
- [ ] Renders the **Azure Activity Panel**: service rail + narrative feed +
      "what this service does" affordance.
- [ ] Renders the **live architecture diagram** with nodes highlighting as each
      service fires (`step_id` ties events ↔ diagram ↔ `live_activity`).
- [ ] Every Azure service shown carries a plain-language explanation of its role
      in the live request flow.

## 3. Scenario-appropriate UX (archetype)

- [ ] The shell matches the demo archetype — `chat`, `rag`, `vision`,
      `agentic`, or `data` — not a one-size-fits-all upload→status→JSON dump.
- [ ] The result is rendered by a **purpose-built renderer** (chat bubbles,
      cited passages, bounding boxes/annotations, agent step trace, table/chart)
      — never `JSON.stringify` as the primary output.

## 4. Accessibility & quality

- [ ] WCAG AA contrast in both themes; visible focus states; keyboard operable.
- [ ] All user input HTML-escaped before render (XSS-safe).
- [ ] Server-side input/size validation; graceful, surfaced errors.
- [ ] Keyless auth via `DefaultAzureCredential`; no API keys anywhere.

## 5. Clone-and-run & presentable

- [ ] `README.md` with a 60-second elevator pitch and a "what happens behind the
      scenes" section naming each service's role.
- [ ] `DEMO_SCRIPT.md` presenter talk track that explicitly points at the in-app
      Activity Panel and live diagram during the walkthrough.
- [ ] Quick start ≤ 5 steps; `infra/main.bicep` deploys cleanly (`az bicep build`).
- [ ] `?mock=1` preview replays the `live_activity` script with no Azure needed.

---

### Self-check rubric (build agents)

Before emitting files, the code agent confirms:

1. Is the Azure Activity Panel present and wired to canonical `activity` events?
2. Is the live diagram present and keyed by `step_id`?
3. Is the result rendered by an archetype-appropriate component (no raw JSON)?
4. Are loading / empty / error states all designed?
5. Does `?mock=1` drive the same panel without a backend?

If any answer is "no", fix it before finalizing the file set.

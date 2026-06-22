# React + TypeScript Starter Template

Reference template for React + TypeScript + Fluent UI v9 demos. Use when the demo needs a richer UI than Bootstrap or is meant to feel closer to a production product.

---

## File: src/App.tsx

```tsx
import { useState, useRef } from 'react';
import {
  FluentProvider,
  webDarkTheme,
  webLightTheme,
  Button,
  Card,
  CardHeader,
  CardPreview,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useTheme } from './hooks/useTheme';
import { UploadPanel } from './components/UploadPanel';
import { ResultPanel } from './components/ResultPanel';
import { StatusFeed } from './components/StatusFeed';

const useStyles = makeStyles({
  root: { minHeight: '100vh', padding: tokens.spacingHorizontalXL },
  layout: { display: 'grid', gridTemplateColumns: '1fr 2fr', gap: tokens.spacingHorizontalXL },
});

export default function App() {
  const styles = useStyles();
  const { theme, toggleTheme } = useTheme();
  const [statuses, setStatuses] = useState<string[]>([]);
  const [result, setResult] = useState<unknown>(null);
  const [processing, setProcessing] = useState(false);

  async function handleSubmit(file: File) {
    setProcessing(true);
    setStatuses([]);
    setResult(null);

    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/process', { method: 'POST', body: formData });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const msg = JSON.parse(line.slice(6));
          if (msg.type === 'status') setStatuses(p => [...p, msg.message]);
          if (msg.type === 'result') setResult(msg.data);
        } catch (_) {}
      }
    }
    setProcessing(false);
  }

  return (
    <FluentProvider theme={theme === 'dark' ? webDarkTheme : webLightTheme}>
      <div className={styles.root}>
        <div className={styles.layout}>
          <UploadPanel onSubmit={handleSubmit} processing={processing} onToggleTheme={toggleTheme} />
          <div>
            {statuses.length > 0 && <StatusFeed statuses={statuses} />}
            {result && <ResultPanel result={result} />}
          </div>
        </div>
      </div>
    </FluentProvider>
  );
}
```

---

## File: src/hooks/useTheme.ts

```typescript
import { useState } from 'react';

export function useTheme() {
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('theme') as 'dark' | 'light') || 'dark'
  );

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('theme', next);
  }

  return { theme, toggleTheme };
}
```

---

## File: src/components/UploadPanel.tsx

```tsx
import { useRef, useState } from 'react';
import {
  Card, CardHeader, Button, Text, Badge,
  makeStyles, tokens,
} from '@fluentui/react-components';
import { ArrowUploadRegular, WeatherMoonRegular, WeatherSunnyRegular } from '@fluentui/react-icons';

const useStyles = makeStyles({
  dropZone: {
    border: `2px dashed ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingVerticalXXL,
    textAlign: 'center',
    cursor: 'pointer',
    ':hover': { borderColor: tokens.colorBrandStroke1 },
  },
});

interface Props {
  onSubmit: (file: File) => void;
  processing: boolean;
  onToggleTheme: () => void;
}

export function UploadPanel({ onSubmit, processing, onToggleTheme }: Props) {
  const styles = useStyles();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  }

  return (
    <Card>
      <CardHeader
        header={<Text weight="semibold">Upload</Text>}
        action={
          <Button appearance="subtle" icon={<WeatherMoonRegular />} onClick={onToggleTheme} />
        }
      />
      <div
        className={styles.dropZone}
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <ArrowUploadRegular fontSize={32} />
        <Text block>Drop a file here or click to browse</Text>
        <input ref={inputRef} type="file" style={{ display: 'none' }}
          onChange={e => { if (e.target.files?.[0]) setFile(e.target.files[0]); }} />
      </div>
      {file && (
        <Badge appearance="tint" color="informative">{file.name}</Badge>
      )}
      <Button
        appearance="primary"
        disabled={!file || processing}
        onClick={() => file && onSubmit(file)}
      >
        {processing ? 'Processing...' : 'Process'}
      </Button>
    </Card>
  );
}
```

---

## File: src/components/StatusFeed.tsx

```tsx
import { makeStyles, tokens, Text } from '@fluentui/react-components';

const useStyles = makeStyles({
  feed: {
    maxHeight: '160px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    marginBottom: tokens.spacingVerticalM,
  },
  item: {
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderRadius: tokens.borderRadiusSmall,
    background: tokens.colorNeutralBackground2,
    fontSize: tokens.fontSizeBase200,
  },
});

export function StatusFeed({ statuses }: { statuses: string[] }) {
  const styles = useStyles();
  return (
    <div className={styles.feed}>
      {statuses.map((s, i) => (
        <div key={i} className={styles.item}><Text size={200}>{s}</Text></div>
      ))}
    </div>
  );
}
```

---

## File: src/components/ResultPanel.tsx

```tsx
import { Card, CardHeader, Text, makeStyles, tokens } from '@fluentui/react-components';

const useStyles = makeStyles({
  pre: {
    background: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingHorizontalM,
    overflowX: 'auto',
    fontSize: tokens.fontSizeBase200,
  },
});

export function ResultPanel({ result }: { result: unknown }) {
  const styles = useStyles();
  return (
    <Card>
      <CardHeader header={<Text weight="semibold">Result</Text>} />
      <pre className={styles.pre}>{JSON.stringify(result, null, 2)}</pre>
    </Card>
  );
}
```

---

## File: package.json

```json
{
  "name": "{demo-slug}",
  "version": "0.1.0",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@fluentui/react-components": "^9.56.0",
    "@fluentui/react-icons": "^2.0.249",
    "mermaid": "^11.4.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.3",
    "typescript": "^5.6.3",
    "vite": "^5.4.10"
  }
}
```

---

## File: vite.config.ts

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/process': 'http://localhost:5000',
      '/api': 'http://localhost:5000',
    },
  },
});
```

---

## File: tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src"]
}
```

---

## Notes for Code Generation

- The React frontend proxies `/process` and `/api` to a Flask/FastAPI backend on port 5000.
- Customize `ResultPanel.tsx` to render the specific result shape for your demo.
- For demos with richer data, replace the `<pre>` in `ResultPanel` with proper Fluent UI components (DataGrid, etc.).
- The `vite.config.ts` proxy means the backend URL never appears in frontend code.

---

# REQUIRED: Azure Activity Panel + canonical event stream

The default `App.tsx` above is the *minimal* shell. A world-class demo MUST add
the Azure Activity Panel and consume the **canonical event schema** from
`activity_protocol.md` (`activity` / `token` / `result` / `error`). The
`StatusFeed` / JSON-`<pre>` pattern above is the floor, not the bar — replace it
with the components below.

## File: src/types.ts

```typescript
export type ActivityStatus = 'pending' | 'active' | 'done' | 'error';

export interface ActivityEvent {
  type: 'activity';
  step_id: string;
  service: string;
  deployment?: string | null;
  stage: string;
  detail?: string;
  status: ActivityStatus;
  latency_ms?: number | null;
  tokens?: number | null;
}
export interface TokenEvent { type: 'token'; step_id: string; text: string; }
export interface ResultEvent { type: 'result'; data: unknown; }
export interface ErrorEvent { type: 'error'; step_id?: string; service?: string; message: string; }
export type DemoEvent = ActivityEvent | TokenEvent | ResultEvent | ErrorEvent;

/** One node in the live architecture diagram / mock script. */
export interface LiveActivityStep {
  step_id: string;
  service: string;
  stage: string;
  detail?: string;
  duration_ms?: number;
}
/** Plain-language role per Azure service, from the design behind_the_scenes[]. */
export interface ServiceRole { service: string; role: string; }
```

## File: src/hooks/useDemoStream.ts

```typescript
import { useCallback, useReducer } from 'react';
import type { ActivityEvent, DemoEvent, LiveActivityStep } from '../types';

interface State {
  steps: Record<string, ActivityEvent>;
  order: string[];
  narrative: { step_id: string; text: string }[];
  result: unknown;
  error: string | null;
  running: boolean;
}
const initial: State = { steps: {}, order: [], narrative: [], result: null, error: null, running: false };

function reduce(state: State, ev: DemoEvent | { type: 'start' } | { type: 'end' }): State {
  switch (ev.type) {
    case 'start': return { ...initial, running: true };
    case 'end': return { ...state, running: false };
    case 'activity': {
      const seen = ev.step_id in state.steps;
      const narrative = ev.detail && ev.status === 'active'
        ? [...state.narrative, { step_id: ev.step_id, text: ev.detail }]
        : state.narrative;
      return {
        ...state,
        steps: { ...state.steps, [ev.step_id]: ev },
        order: seen ? state.order : [...state.order, ev.step_id],
        narrative,
      };
    }
    case 'result': return { ...state, result: ev.data, running: false };
    case 'error': return { ...state, error: ev.message, running: false };
    default: return state;
  }
}

/** Parses an SSE byte stream of canonical demo events. */
export function useDemoStream() {
  const [state, dispatch] = useReducer(reduce, initial);

  const run = useCallback(async (url: string, body: FormData | object) => {
    dispatch({ type: 'start' });
    const res = await fetch(url, {
      method: 'POST',
      body: body instanceof FormData ? body : JSON.stringify(body),
      headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop()!;
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try { dispatch(JSON.parse(line.slice(6))); } catch { /* ignore */ }
      }
    }
    dispatch({ type: 'end' });
  }, []);

  /** Replays a design.live_activity script with timers — drives the same panel
   *  with no backend (used by ?mock=1 and the Demo Builder preview). */
  const runMock = useCallback(async (script: LiveActivityStep[]) => {
    dispatch({ type: 'start' });
    for (const s of script) {
      dispatch({ type: 'activity', step_id: s.step_id, service: s.service,
        stage: s.stage, detail: s.detail, status: 'active', latency_ms: null, tokens: null });
      await new Promise(r => setTimeout(r, s.duration_ms ?? 900));
      dispatch({ type: 'activity', step_id: s.step_id, service: s.service,
        stage: s.stage, status: 'done', latency_ms: s.duration_ms ?? 900, tokens: null });
    }
    dispatch({ type: 'end' });
  }, []);

  return { ...state, run, runMock };
}
```

## File: src/components/AzureActivityPanel.tsx

The centerpiece — service rail + live narrative + "what this service does".

```tsx
import {
  Card, CardHeader, Text, Badge, Spinner, Popover, PopoverTrigger,
  PopoverSurface, makeStyles, tokens,
} from '@fluentui/react-components';
import { CheckmarkCircleFilled, ErrorCircleFilled, CloudRegular, InfoRegular } from '@fluentui/react-icons';
import type { ActivityEvent, ServiceRole } from '../types';

const useStyles = makeStyles({
  rail: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS },
  chip: {
    display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS,
    padding: tokens.spacingHorizontalM, borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`, transition: 'all .25s ease',
  },
  active: {
    border: `1px solid ${tokens.colorBrandStroke1}`,
    boxShadow: `0 0 0 3px ${tokens.colorBrandBackground2}`,
    background: tokens.colorBrandBackground2,
  },
  done: { borderColor: tokens.colorPaletteGreenBorder2 },
  meta: { marginLeft: 'auto', display: 'flex', gap: tokens.spacingHorizontalXS, alignItems: 'center' },
  feed: {
    marginTop: tokens.spacingVerticalM, maxHeight: '200px', overflowY: 'auto',
    display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS,
  },
  feedItem: {
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderLeft: `2px solid ${tokens.colorBrandStroke1}`,
    background: tokens.colorNeutralBackground2, borderRadius: tokens.borderRadiusSmall,
    animationName: { from: { opacity: 0, transform: 'translateX(-6px)' }, to: { opacity: 1, transform: 'none' } },
    animationDuration: '.25s',
  },
});

interface Props {
  steps: Record<string, ActivityEvent>;
  order: string[];
  narrative: { step_id: string; text: string }[];
  roles: ServiceRole[];   // design.behind_the_scenes
}

export function AzureActivityPanel({ steps, order, narrative, roles }: Props) {
  const s = useStyles();
  const roleFor = (svc: string) => roles.find(r => r.service.toLowerCase() === svc.toLowerCase())?.role;
  return (
    <Card>
      <CardHeader header={<Text weight="semibold">Behind the scenes — live Azure activity</Text>} />
      <div className={s.rail}>
        {order.map(id => {
          const ev = steps[id];
          const cls = `${s.chip} ${ev.status === 'active' ? s.active : ''} ${ev.status === 'done' ? s.done : ''}`;
          return (
            <div key={id} className={cls}>
              <CloudRegular />
              <div>
                <Text weight="semibold">{ev.service}</Text>{' '}
                <Text size={200}>· {ev.stage}{ev.deployment ? ` (${ev.deployment})` : ''}</Text>
              </div>
              <div className={s.meta}>
                {ev.tokens != null && <Badge appearance="tint" color="informative">{ev.tokens} tok</Badge>}
                {ev.latency_ms != null && <Badge appearance="tint">{ev.latency_ms} ms</Badge>}
                {ev.status === 'active' && <Spinner size="tiny" />}
                {ev.status === 'done' && <CheckmarkCircleFilled style={{ color: tokens.colorPaletteGreenForeground1 }} />}
                {ev.status === 'error' && <ErrorCircleFilled style={{ color: tokens.colorPaletteRedForeground1 }} />}
                {roleFor(ev.service) && (
                  <Popover withArrow>
                    <PopoverTrigger disableButtonEnhancement>
                      <InfoRegular tabIndex={0} aria-label={`What ${ev.service} does`} style={{ cursor: 'pointer' }} />
                    </PopoverTrigger>
                    <PopoverSurface><Text size={200}>{roleFor(ev.service)}</Text></PopoverSurface>
                  </Popover>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className={s.feed}>
        {narrative.map((n, i) => (
          <div key={i} className={s.feedItem}><Text size={200}>{n.text}</Text></div>
        ))}
      </div>
    </Card>
  );
}
```

## File: src/components/LiveDiagram.tsx

Renders the design's `component` Mermaid diagram and highlights nodes by
`step_id` as their service fires. Use `mermaid` (lazy-loaded) and post-process
the SVG to add `active`/`done` classes to nodes whose id matches a `step_id`.

```tsx
import { useEffect, useRef } from 'react';
import mermaid from 'mermaid';
import type { ActivityEvent } from '../types';

mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });

export function LiveDiagram({ source, steps }: { source: string; steps: Record<string, ActivityEvent> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    mermaid.render('live-diagram', source).then(({ svg }) => {
      if (!alive || !ref.current) return;
      ref.current.innerHTML = svg;
      // Node ids in the rendered SVG contain the diagram node id; match step_id.
      for (const [id, ev] of Object.entries(steps)) {
        ref.current.querySelectorAll(`[id*="${id}"]`).forEach(n =>
          n.classList.toggle('node-active', ev.status === 'active') ||
          n.classList.toggle('node-done', ev.status === 'done'));
      }
    });
    return () => { alive = false; };
  }, [source, steps]);
  return <div ref={ref} aria-label="Live architecture diagram" />;
}
```

Add to a global stylesheet:

```css
.node-active rect, .node-active polygon, .node-active circle { stroke: #2899f5; stroke-width: 3px; filter: drop-shadow(0 0 6px #2899f5); }
.node-done   rect, .node-done   polygon, .node-done   circle { stroke: #3fb950; }
```

---

# Demo-archetype UX variants

Pick the archetype from `design.demo_archetype` and build the matching shell and
result renderer. NEVER ship the generic upload→status→JSON dump for these.

- **`chat`** — message thread (user/assistant bubbles), composer, streamed
  tokens via the `token` event, the Activity Panel docked to the side so the
  audience sees retrieval/tool calls fire per turn.
- **`rag`** — question box + answer with **inline citations**; a "sources"
  column rendering retrieved passages (title, score, snippet). Activity Panel
  shows `Azure AI Search` (retrieve) → `Azure OpenAI` (synthesize).
- **`vision`** — image/document drop zone; result overlays **bounding boxes /
  field annotations** on the original; Activity Panel shows
  `Azure AI Document Intelligence` / `Azure OpenAI (vision)`.
- **`agentic`** — an **agent step trace** (plan → tool calls → observation →
  answer); each tool call is an Activity Panel entry; render the reasoning steps
  as an expandable timeline.
- **`data`** — query/NL→SQL box; result as a **DataGrid + chart**; Activity
  Panel shows the data services and the model translating the request.

Each archetype replaces `ResultPanel`/`UploadPanel` with purpose-built
components but reuses `useDemoStream`, `AzureActivityPanel`, and `LiveDiagram`
unchanged.

# Polish requirements (all archetypes)

- Hero/landing state with a one-line value prop and a sample/"try this" action.
- Skeleton loaders for the result region; designed empty and error states.
- Subtle motion: chips transition between states, feed items slide in, results
  fade/expand. Respect `prefers-reduced-motion`.
- Custom Fluent theme overrides (brand ramp) rather than raw `webDarkTheme`.
- AA contrast, visible focus rings, full keyboard operability.
- `?mock=1` → call `runMock(design.live_activity)` so the whole experience can be
  shown with no Azure backend.


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

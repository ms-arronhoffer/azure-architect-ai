import { useCallback, useEffect, useState } from "react";

const HISTORY_CAP = 3;

export interface DiagramState {
  xml: string | null;
  html: string | null;
  history: string[];
  historyIndex: number;
  setXml: (xml: string) => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
}

function buildHtml(xml: string): string {
  const xmlLiteral = JSON.stringify(xml).replace(/<\/script>/gi, "<\\/script>");
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#fff;}</style>
</head>
<body>
<div class="mxgraph" style="width:100%;height:100%;max-width:initial;"></div>
<script>
window.mxBasePath = 'https://viewer.diagrams.net/';
(function(){
  var xml = ${xmlLiteral};
  var cfg = JSON.stringify({highlight:'#0000ff',nav:true,resize:true,xml:xml});
  document.querySelector('.mxgraph').setAttribute('data-mxgraph', cfg);
})();
</script>
<script type="text/javascript" src="https://viewer.diagrams.net/js/viewer-static.min.js"></script>
</body>
</html>`;
}

export function useDiagramState(): DiagramState {
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [html, setHtml] = useState<string | null>(null);

  const xml = historyIndex >= 0 ? history[historyIndex] : null;

  useEffect(() => {
    setHtml(xml ? buildHtml(xml) : null);
  }, [xml]);

  const setXml = useCallback((next: string) => {
    setHistory((prev) => {
      const truncated = prev.slice(0, historyIndex + 1);
      const appended = [...truncated, next];
      const trimmed = appended.length > HISTORY_CAP ? appended.slice(appended.length - HISTORY_CAP) : appended;
      setHistoryIndex(trimmed.length - 1);
      return trimmed;
    });
  }, [historyIndex]);

  const undo = useCallback(() => {
    setHistoryIndex((i) => (i > 0 ? i - 1 : i));
  }, []);

  const redo = useCallback(() => {
    setHistoryIndex((i) => (i < history.length - 1 ? i + 1 : i));
  }, [history.length]);

  const clear = useCallback(() => {
    setHistory([]);
    setHistoryIndex(-1);
  }, []);

  return { xml, html, history, historyIndex, setXml, undo, redo, clear };
}

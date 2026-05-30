export function buildDiagramSrcdoc(xml: string): string {
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
  var s = document.createElement('script');
  s.src = 'https://viewer.diagrams.net/js/viewer-static.min.js';
  document.body.appendChild(s);
})();
</script>
</body>
</html>`;
}

export function downloadDiagramFile(xml: string, filename: string): void {
  const blob = new Blob([xml], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function openDiagramInDrawIo(xml: string): void {
  const encoded = encodeURIComponent(xml);
  window.open(`https://app.diagrams.net/?src=claude#xml=${encoded}`, "_blank");
}

import { useState } from "react";
import { makeStyles, tokens, Button, Text } from "@fluentui/react-components";
import { EditRegular, ArrowDownloadRegular, ArrowUndoRegular, ArrowRedoRegular } from "@fluentui/react-icons";
import DiagramEditor from "./DiagramEditor";
import type { DiagramState } from "../hooks/useDiagramState";

const useStyles = makeStyles({
  wrapper: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    background: tokens.colorNeutralBackground1,
    borderLeft: `1px solid ${tokens.colorNeutralStroke2}`,
    minWidth: 0,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 10px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    background: tokens.colorNeutralBackground2,
    flexShrink: 0,
  },
  title: {
    fontSize: "12px",
    fontWeight: 600,
    color: tokens.colorNeutralForeground2,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginRight: "auto",
  },
  body: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
  },
  empty: {
    margin: "auto",
    padding: "24px",
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
    fontSize: "13px",
    lineHeight: "1.5",
    maxWidth: "320px",
  },
  frame: {
    flex: 1,
    border: "none",
    width: "100%",
    height: "100%",
    background: "#fff",
  },
});

interface DeskDiagramPaneProps {
  diagram: DiagramState;
}

export default function DeskDiagramPane({ diagram }: DeskDiagramPaneProps) {
  const styles = useStyles();
  const [editing, setEditing] = useState(false);

  function handleDownload() {
    if (!diagram.xml) return;
    const blob = new Blob([diagram.xml], { type: "text/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "diagram.drawio";
    a.click();
    URL.revokeObjectURL(url);
  }

  const canUndo = diagram.historyIndex > 0;
  const canRedo = diagram.historyIndex >= 0 && diagram.historyIndex < diagram.history.length - 1;
  const hasDiagram = !!diagram.xml && !!diagram.html;

  return (
    <div className={styles.wrapper}>
      <div className={styles.toolbar}>
        <span className={styles.title}>Diagram</span>
        {hasDiagram && (
          <>
            {(canUndo || canRedo) && (
              <>
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<ArrowUndoRegular />}
                  onClick={diagram.undo}
                  disabled={!canUndo}
                  title="Undo"
                />
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<ArrowRedoRegular />}
                  onClick={diagram.redo}
                  disabled={!canRedo}
                  title="Redo"
                />
              </>
            )}
            <Button
              appearance="subtle"
              size="small"
              icon={<EditRegular />}
              onClick={() => setEditing(true)}
            >
              Edit in draw.io
            </Button>
            <Button
              appearance="subtle"
              size="small"
              icon={<ArrowDownloadRegular />}
              onClick={handleDownload}
              title="Download .drawio"
            />
          </>
        )}
      </div>
      <div className={styles.body}>
        {hasDiagram ? (
          <iframe className={styles.frame} srcDoc={diagram.html!} title="Architecture diagram" />
        ) : (
          <div className={styles.empty}>
            <Text>
              No diagram yet. Ask the specialist to design an architecture and it will appear here.
            </Text>
          </div>
        )}
      </div>
      {editing && diagram.xml && (
        <DiagramEditor
          xml={diagram.xml}
          onSave={(updated) => {
            diagram.setXml(updated);
            setEditing(false);
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

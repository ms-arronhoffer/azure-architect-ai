import { useEffect, useRef } from "react";
import {
  makeStyles,
  tokens,
  Button,
} from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";

const useStyles = makeStyles({
  overlay: {
    position: "fixed",
    inset: "0",
    zIndex: 1000,
    background: tokens.colorNeutralBackground1,
    display: "flex",
    flexDirection: "column",
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    padding: "8px 12px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    flexShrink: 0,
  },
  frame: {
    flex: 1,
    border: "none",
    width: "100%",
  },
});

interface DiagramEditorProps {
  xml: string;
  onSave: (updatedXml: string) => void;
  onClose: () => void;
}

export default function DiagramEditor({ xml, onSave, onClose }: DiagramEditorProps) {
  const styles = useStyles();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    function handleMessage(evt: MessageEvent) {
      // Only accept messages from diagrams.net
      if (!evt.origin.includes("diagrams.net") && !evt.origin.includes("draw.io")) return;
      try {
        const data = typeof evt.data === "string" ? JSON.parse(evt.data) : evt.data;
        if (data.event === "init") {
          iframeRef.current?.contentWindow?.postMessage(
            JSON.stringify({ action: "load", xml }),
            "*"
          );
        } else if (data.event === "save") {
          onSave(data.xml);
          iframeRef.current?.contentWindow?.postMessage(
            JSON.stringify({ action: "exit" }),
            "*"
          );
        } else if (data.event === "exit") {
          onClose();
        }
      } catch {
        // ignore parse errors
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [xml, onSave, onClose]);

  return (
    <div className={styles.overlay}>
      <div className={styles.toolbar}>
        <Button
          appearance="subtle"
          size="small"
          icon={<DismissRegular />}
          onClick={onClose}
        >
          Close Editor
        </Button>
      </div>
      <iframe
        ref={iframeRef}
        className={styles.frame}
        src="https://embed.diagrams.net/?embed=1&spin=1&proto=json&ui=min&dark=1"
        title="draw.io diagram editor"
      />
    </div>
  );
}

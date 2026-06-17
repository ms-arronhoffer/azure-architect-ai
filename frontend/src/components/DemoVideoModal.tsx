import {
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogActions,
  Button,
  makeStyles,
  tokens,
  Text,
  Link,
} from "@fluentui/react-components";
import { Dismiss24Regular, Open24Regular } from "@fluentui/react-icons";

const useStyles = makeStyles({
  surface: {
    width: "min(860px, 92vw)",
    maxWidth: "860px",
    padding: tokens.spacingVerticalL,
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  iframeWrapper: {
    position: "relative",
    width: "100%",
    paddingBottom: "56.25%",
    height: 0,
    marginTop: tokens.spacingVerticalM,
    borderRadius: tokens.borderRadiusMedium,
    overflow: "hidden",
    backgroundColor: tokens.colorNeutralBackground3,
  },
  iframe: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    border: "none",
  },
  fallback: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingVerticalXXL,
    color: tokens.colorNeutralForeground3,
  },
});

const DIRECT_VIDEO_EXTS = ["mp4", "webm", "ogg", "mov"];

function toEmbedUrl(videoUrl: string): string | null {
  try {
    const url = new URL(videoUrl);
    if (url.hostname.includes("youtube.com") && url.searchParams.get("v")) {
      return `https://www.youtube.com/embed/${url.searchParams.get("v")}?autoplay=1`;
    }
    if (url.hostname === "youtu.be") {
      const id = url.pathname.slice(1);
      return `https://www.youtube.com/embed/${id}?autoplay=1`;
    }
    if (url.hostname.includes("vimeo.com")) {
      const id = url.pathname.split("/").filter(Boolean).pop();
      if (id) return `https://player.vimeo.com/video/${id}?autoplay=1`;
    }
  } catch {
    // ignore
  }
  return null;
}

function isDirectVideo(videoUrl: string): boolean {
  const pathname = videoUrl.startsWith("http")
    ? (() => { try { return new URL(videoUrl).pathname; } catch { return videoUrl; } })()
    : videoUrl;
  const ext = pathname.split(".").pop()?.toLowerCase() ?? "";
  return DIRECT_VIDEO_EXTS.includes(ext);
}

interface DemoVideoModalProps {
  videoUrl: string | null;
  title: string;
  open: boolean;
  onClose: () => void;
}

export function DemoVideoModal({ videoUrl, title, open, onClose }: DemoVideoModalProps) {
  const styles = useStyles();
  const embedUrl = videoUrl ? toEmbedUrl(videoUrl) : null;

  return (
    <Dialog open={open} onOpenChange={(_, data) => { if (!data.open) onClose(); }}>
      <DialogSurface className={styles.surface}>
        <DialogTitle>
          <div className={styles.titleRow}>
            {title}
            <Button
              appearance="subtle"
              icon={<Dismiss24Regular />}
              onClick={onClose}
              aria-label="Close"
            />
          </div>
        </DialogTitle>
        <DialogBody>
          {embedUrl ? (
            <div className={styles.iframeWrapper}>
              <iframe
                className={styles.iframe}
                src={embedUrl}
                title={title}
                allow="autoplay; encrypted-media; fullscreen"
                allowFullScreen
              />
            </div>
          ) : videoUrl && isDirectVideo(videoUrl) ? (
            <div className={styles.iframeWrapper}>
              <video className={styles.iframe} src={videoUrl} controls autoPlay />
            </div>
          ) : (
            <div className={styles.fallback}>
              <Text>This video cannot be embedded directly.</Text>
              {videoUrl && (
                <Link href={videoUrl} target="_blank" rel="noopener noreferrer">
                  <Button appearance="primary" icon={<Open24Regular />} iconPosition="after">
                    Open in new tab
                  </Button>
                </Link>
              )}
            </div>
          )}
        </DialogBody>
        <DialogActions>
          <Button appearance="outline" onClick={onClose}>Close</Button>
          {videoUrl && (
            <Link href={videoUrl} target="_blank" rel="noopener noreferrer">
              <Button appearance="subtle" icon={<Open24Regular />} iconPosition="after">
                Open original
              </Button>
            </Link>
          )}
        </DialogActions>
      </DialogSurface>
    </Dialog>
  );
}

import { type PluginFilePanelProps, useFileUrl } from "@getpaseo/plugin/client";
import { DocumentFrame, Loading } from "@getpaseo/plugin/client/ui";
import { Message } from "./message.js";
import { readProblem } from "./reading.js";
import { usePanelStyles } from "./use-styles.js";

/**
 * A PDF in the host's document frame: the browser's own viewer on the web and the desktop app,
 * the system's on iOS. Android has none, and the frame says so itself.
 */
export function PdfPanel(props: PluginFilePanelProps) {
  const styles = usePanelStyles(props);
  const url = useFileUrl(props.file);
  if (url.status === "loading") return <Loading />;
  if (url.status === "error")
    return <Message text={readProblem(url.error)} failed styles={styles} />;
  return <DocumentFrame url={url.url} testID="viewers-pdf" />;
}

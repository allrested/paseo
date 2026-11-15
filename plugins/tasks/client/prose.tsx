import { Text } from "react-native";
import { Markdown } from "@getpaseo/plugin/client/ui";
import type { TasksStyles } from "./tasks-styles.js";

export interface ProseProps {
  text: string;
  markdown: boolean;
  styles: TasksStyles;
}

/** A tracker's text. GitLab writes Markdown; Jira's is plain, and its marks are not emphasis. */
export function Prose({ text, markdown, styles }: ProseProps) {
  if (markdown) return <Markdown>{text}</Markdown>;
  return (
    <Text selectable style={styles.body}>
      {text}
    </Text>
  );
}

import { Text, View } from "react-native";
import type { ViewerStyles } from "./styles.js";

export interface MessageProps {
  text: string;
  /** Something went wrong, as against there being nothing to show. */
  failed?: boolean;
  styles: ViewerStyles;
}

/** One sentence in place of a file's content. */
export function Message({ text, failed = false, styles }: MessageProps) {
  return (
    <View style={styles.message}>
      <Text
        accessibilityRole={failed ? "alert" : undefined}
        style={failed ? styles.danger : styles.muted}
      >
        {text}
      </Text>
    </View>
  );
}

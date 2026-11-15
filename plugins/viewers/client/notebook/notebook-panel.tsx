import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Image, Text, View, type ListRenderItemInfo } from "react-native";
import { type PluginFile, type PluginFilePanelProps, useFileText } from "@getpaseo/plugin/client";
import { FlatList, Loading, Markdown } from "@getpaseo/plugin/client/ui";
import { Message } from "../message.js";
import { NOTEBOOK_MAX_BYTES, readProblem, tooLarge } from "../reading.js";
import type { ViewerStyles } from "../styles.js";
import { usePanelStyles } from "../use-styles.js";
import { moreLabel, otherLabel, runLabel } from "./labels.js";
import { fenced, readNotebook, type NotebookCell, type NotebookOutput } from "./notebook.js";

interface PictureProps {
  output: Extract<NotebookOutput, { kind: "image" }>;
  styles: ViewerStyles;
}

/** A plot. Its size is read from its bytes, so it is drawn at its own shape and no wider. */
function Picture({ output, styles }: PictureProps) {
  const uri = `data:${output.mime};base64,${output.data}`;
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    let current = true;
    Image.getSize(
      uri,
      (width, height) => {
        if (!current) return;
        if (width > 0 && height > 0) setSize({ width, height });
        else setBroken(true);
      },
      () => {
        if (current) setBroken(true);
      },
    );
    return () => {
      current = false;
    };
  }, [uri]);
  const source = useMemo(() => ({ uri }), [uri]);
  const frame = useMemo(
    () =>
      size === null
        ? null
        : [styles.picture, { maxWidth: size.width, aspectRatio: size.width / size.height }],
    [styles, size],
  );
  if (broken) return <Text style={styles.outputLabel}>A picture that cannot be drawn here</Text>;
  if (frame === null) return null;
  return (
    <Image
      accessibilityRole="image"
      accessibilityLabel="Picture output"
      source={source}
      style={frame}
      resizeMode="contain"
    />
  );
}

interface OutputProps {
  output: NotebookOutput;
  styles: ViewerStyles;
}

function Output({ output, styles }: OutputProps) {
  if (output.kind === "image") return <Picture output={output} styles={styles} />;
  if (output.kind === "markdown") return <Markdown>{output.text}</Markdown>;
  if (output.kind === "other") return <Text style={styles.outputLabel}>{otherLabel(output)}</Text>;
  if (output.kind === "error") {
    return (
      <Text selectable style={styles.errorText}>
        {output.text}
      </Text>
    );
  }
  const failed = output.stream === "stderr";
  return (
    <View style={styles.output}>
      {/* Named in words: the colour alone does not say which stream this is. */}
      {failed ? <Text style={styles.outputLabel}>stderr</Text> : null}
      <Text selectable style={failed ? styles.stderr : styles.mono}>
        {output.text}
      </Text>
      {output.more === 0 ? null : <Text style={styles.outputLabel}>{moreLabel(output.more)}</Text>}
    </View>
  );
}

interface CellProps {
  cell: NotebookCell;
  language: string;
  styles: ViewerStyles;
}

const Cell = memo(function Cell({ cell, language, styles }: CellProps) {
  if (cell.kind === "markdown") {
    return cell.source.trim() === "" ? null : <Markdown>{cell.source}</Markdown>;
  }
  if (cell.kind === "raw") {
    return (
      <Text selectable style={styles.mono}>
        {cell.source}
      </Text>
    );
  }
  return (
    <View style={styles.codeCell}>
      <Text style={styles.run}>{runLabel(cell.count)}</Text>
      {cell.source.trim() === "" ? null : <Markdown>{fenced(cell.source, language)}</Markdown>}
      {cell.outputs.length === 0 ? null : (
        <View style={styles.outputs}>
          {cell.outputs.map((output, index) => (
            // An output has no id but its place.
            // oxlint-disable-next-line react/no-array-index-key
            <Output key={index} output={output} styles={styles} />
          ))}
        </View>
      )}
    </View>
  );
});

const cellKey = (_cell: NotebookCell, index: number) => String(index);

interface ReadingProps {
  file: PluginFile;
  styles: ViewerStyles;
}

function Reading({ file, styles }: ReadingProps) {
  const read = useFileText(file);
  const text = read.status === "ready" ? read.text : null;
  const result = useMemo(() => (text === null ? null : readNotebook(text)), [text]);
  const language = result?.ok ? result.notebook.language : "";
  const renderCell = useCallback(
    ({ item }: ListRenderItemInfo<NotebookCell>) => (
      <Cell cell={item} language={language} styles={styles} />
    ),
    [language, styles],
  );
  if (read.status === "loading") return <Loading />;
  if (read.status === "error") {
    return <Message text={readProblem(read.error)} failed styles={styles} />;
  }
  if (result === null || !result.ok) {
    return (
      <Message
        text={result?.reason ?? "This file is not a notebook Paseo can read."}
        styles={styles}
      />
    );
  }
  const { cells } = result.notebook;
  if (cells.length === 0) return <Message text="This notebook has no cells." styles={styles} />;
  return (
    <FlatList
      data={cells}
      renderItem={renderCell}
      keyExtractor={cellKey}
      style={styles.panel}
      contentContainerStyle={styles.cells}
    />
  );
}

/** A Jupyter notebook, read only: its text, its code, and what the code printed and drew. */
export function NotebookPanel(props: PluginFilePanelProps) {
  const styles = usePanelStyles(props);
  const { file } = props;
  // The size is known before a read, and a notebook too large to hold is not read.
  if (file.size > NOTEBOOK_MAX_BYTES) {
    return <Message text={tooLarge("a notebook", file.size, NOTEBOOK_MAX_BYTES)} styles={styles} />;
  }
  return <Reading file={file} styles={styles} />;
}

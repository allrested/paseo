import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal, TextInput } from "@getpaseo/plugin/client/ui";
import { createFileRpc, removeFileRpc, renameFileRpc, type FileRow } from "../shared/contracts.js";
import { ActionButton } from "./action-button.js";
import type { DesignStyles } from "./styles.js";

export type Sheet = { mode: "new" } | { mode: "file"; file: FileRow } | null;

interface BodyProps {
  name: string;
  styles: DesignStyles;
  workspaceId: string;
  onChanged(created: string | null): Promise<void> | void;
}

function NewBody(props: BodyProps) {
  const { name, styles, workspaceId, onChanged } = props;
  const create = useRpc(createFileRpc);
  const submit = useCallback(async () => {
    const result = await create({ workspaceId, name: name.trim() });
    if (!result.ok) throw new Error(result.error);
    await onChanged(result.file.id);
  }, [create, name, onChanged, workspaceId]);
  return (
    <>
      <Text style={styles.sheetText}>
        Paseo keeps it on this host&apos;s FigCraft server and loads design/tokens.json into it
      </Text>
      <View style={styles.sheetActions}>
        <ActionButton
          label="Create"
          pendingLabel="Creating..."
          primary
          disabled={name.trim() === ""}
          styles={styles}
          onPress={submit}
        />
      </View>
    </>
  );
}

function FileBody(props: BodyProps & { file: FileRow }) {
  const { file, name, styles, onChanged } = props;
  const rename = useRpc(renameFileRpc);
  const remove = useRpc(removeFileRpc);
  const [confirming, setConfirming] = useState(false);
  const ask = useCallback(() => setConfirming(true), []);
  const cancel = useCallback(() => setConfirming(false), []);
  const submitRename = useCallback(async () => {
    const result = await rename({ fileId: file.id, name: name.trim() });
    if (!result.ok) throw new Error(result.error);
    await onChanged(null);
  }, [file.id, name, onChanged, rename]);
  const submitRemove = useCallback(async () => {
    const result = await remove({ fileId: file.id });
    if (!result.ok) throw new Error(result.error);
    await onChanged(null);
  }, [file.id, onChanged, remove]);

  if (confirming) {
    return (
      <>
        <Text style={styles.sheetText}>
          Paseo stops listing this design. The file stays on the FigCraft server.
        </Text>
        <View style={styles.sheetActions}>
          <ActionButton label="Cancel" pendingLabel="Cancel" styles={styles} onPress={cancel} />
          <ActionButton
            label="Remove"
            pendingLabel="Removing..."
            danger
            styles={styles}
            onPress={submitRemove}
          />
        </View>
      </>
    );
  }
  return (
    <View style={styles.sheetActions}>
      <ActionButton
        label="Remove from Paseo"
        pendingLabel="Remove from Paseo"
        styles={styles}
        onPress={ask}
      />
      <ActionButton
        label="Rename"
        pendingLabel="Renaming..."
        disabled={name.trim() === "" || name.trim() === file.name}
        styles={styles}
        onPress={submitRename}
      />
    </View>
  );
}

/** New design, or a design's Rename and Remove. Remove asks once more before any red shows. */
export function FileSheet(props: {
  sheet: Sheet;
  workspaceId: string;
  styles: DesignStyles;
  onClose(): void;
  /** After a change; `created` is the new design's id, to open it. */
  onChanged(created: string | null): Promise<void> | void;
}) {
  const { sheet, styles, onClose } = props;
  const [name, setName] = useState("");
  useEffect(() => {
    setName(sheet?.mode === "file" ? sheet.file.name : "");
  }, [sheet]);
  const openChange = useCallback((open: boolean) => !open && onClose(), [onClose]);
  const body = { name, styles, workspaceId: props.workspaceId, onChanged: props.onChanged };

  return (
    <Modal
      title={sheet?.mode === "file" ? sheet.file.name : "New design"}
      open={sheet !== null}
      onOpenChange={openChange}
    >
      <Modal.Content>
        {sheet === null ? null : (
          <View style={styles.sheet}>
            <TextInput
              accessibilityLabel="Design name"
              value={name}
              onChangeText={setName}
              placeholder="Name, such as Login screen"
              placeholderTextColor={styles.placeholderColor}
              maxLength={80}
              autoFocus={sheet.mode === "new"}
              style={styles.input}
            />
            {sheet.mode === "new" ? (
              <NewBody {...body} />
            ) : (
              <FileBody key={sheet.file.id} {...body} file={sheet.file} />
            )}
          </View>
        )}
      </Modal.Content>
    </Modal>
  );
}

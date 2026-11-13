import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { agentsRpc, sendRpc, type FileRow } from "../shared/contracts.js";
import { ActionButton } from "./action-button.js";
import { Chip } from "./controls.js";
import type { DesignStyles } from "./styles.js";

interface Agent {
  id: string;
  title: string;
}
type Agents = { status: "loading" } | { status: "ready"; agents: Agent[] };

const LOADING: Agents = { status: "loading" };

/**
 * Sends the user's current FigCraft selection, its code export and a picture of it to an agent in
 * this workspace. A non-null `note` opens the sheet; on the phone it is the comment being sent.
 */
export function SendSheet(props: {
  note: string | null;
  onClose(): void;
  workspaceId: string;
  file: FileRow;
  styles: DesignStyles;
}) {
  const { styles, file, onClose, workspaceId } = props;
  const listAgents = useRpc(agentsRpc);
  const send = useRpc(sendRpc);
  const toast = useToast();
  const open = props.note !== null;
  const [agents, setAgents] = useState<Agents>(LOADING);
  const [chosen, setChosen] = useState<string | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    setNote(props.note ?? "");
    setAgents(LOADING);
    let current = true;
    void listAgents({ workspaceId }).then(
      (result) => {
        if (!current) return undefined;
        setAgents({ status: "ready", agents: result.agents });
        const last = result.agents.find((agent) => agent.id === file.lastAgentId);
        setChosen(last?.id ?? result.agents[0]?.id ?? null);
        return undefined;
      },
      () => {
        if (current) setAgents({ status: "ready", agents: [] });
      },
    );
    return () => {
      current = false;
    };
  }, [file.lastAgentId, listAgents, open, props.note, workspaceId]);

  const submit = useCallback(async () => {
    if (chosen === null) return;
    const result = await send({ fileId: file.id, agentId: chosen, note });
    if (!result.ok) throw new Error(result.error);
    const title =
      agents.status === "ready" ? agents.agents.find((agent) => agent.id === chosen)?.title : null;
    toast.show(`Sent to ${title ?? "the agent"}`, { variant: "success" });
    onClose();
  }, [agents, chosen, file.id, note, onClose, send, toast]);
  const openChange = useCallback((next: boolean) => !next && onClose(), [onClose]);

  const list = agents.status === "ready" ? agents.agents : [];
  const none = agents.status === "ready" && list.length === 0;
  return (
    <Modal title="Send to agent" open={open} onOpenChange={openChange}>
      <Modal.Content>
        <View style={styles.sheet}>
          <Text style={styles.sheetText}>
            Sends what you have selected in the design, its code export and a picture of it
          </Text>
          {none ? (
            <Text style={styles.sheetText}>No agent in this workspace. Start one, then send.</Text>
          ) : null}
          {list.length > 0 ? (
            <View style={styles.chips} accessibilityRole="radiogroup">
              {list.map((agent) => (
                <Chip
                  key={agent.id}
                  id={agent.id}
                  label={agent.title}
                  chosen={agent.id === chosen}
                  styles={styles}
                  onChoose={setChosen}
                />
              ))}
            </View>
          ) : null}
          <TextInput
            accessibilityLabel="Note for the agent"
            value={note}
            onChangeText={setNote}
            placeholder="What should the agent do with it?"
            placeholderTextColor={styles.placeholderColor}
            multiline
            maxLength={4000}
            style={styles.inputMultiline}
          />
          <View style={styles.sheetActions}>
            <ActionButton
              label="Send"
              pendingLabel="Sending..."
              primary
              disabled={chosen === null || none}
              styles={styles}
              onPress={submit}
            />
          </View>
        </View>
      </Modal.Content>
    </Modal>
  );
}

import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { stackRpc } from "../shared/stack.js";
import { ResourceCard, type CardsState } from "./card-views.js";
import { formatAge, type CardSummary } from "./cards.js";
import { androidSummary, deploySummary, figcraftSummary, paseoSummary } from "./stack-cards.js";
import type { ScreenStyles } from "./styles.js";

// The readings run commands and reach the network, so they are slower and rarer than the
// instance tab's.
const POLL_MS = 60_000;

interface StackTabProps {
  hostId: string;
  cards: CardsState;
  styles: ScreenStyles;
}

export function StackTab({ hostId, cards, styles }: StackTabProps) {
  const fetchStack = useRpc(stackRpc);
  const reading = useQuery({
    queryKey: ["resource-manager", hostId, "stack"],
    queryFn: () => fetchStack({}),
    refetchInterval: POLL_MS,
    retry: false,
  });
  const data = reading.data;
  if (data === undefined) {
    if (reading.isError) {
      return (
        <Text accessibilityRole="alert" style={styles.error}>
          Unable to read the stack: {reading.error.message}
        </Text>
      );
    }
    return <Text style={styles.muted}>Reading the stack...</Text>;
  }
  const now = Math.max(reading.dataUpdatedAt, reading.errorUpdatedAt);
  const age = formatAge(data.readAt, now);
  const { figcraft, deploy } = data;
  let figcraftMeta = "Not set up";
  if (figcraft.status === "on") {
    figcraftMeta =
      figcraft.cliVersion === null
        ? "figcraft-cli not found"
        : `figcraft-cli ${figcraft.cliVersion}`;
  }
  let deployMeta = "Not set up";
  if (deploy.status === "on") {
    deployMeta =
      deploy.runAt === null ? deploy.repo : `${deploy.repo} · run ${formatAge(deploy.runAt, now)}`;
  }
  const { open, toggle } = cards;
  const card = (id: string, title: string, meta: string, summary: CardSummary) => (
    <ResourceCard
      id={`stack/${id}`}
      title={title}
      meta={meta}
      summary={summary}
      expandable={false}
      open={open.has(`stack/${id}`)}
      onToggle={toggle}
      styles={styles}
    />
  );
  return (
    <View style={styles.cards}>
      {reading.isError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          Refresh failed: {reading.error.message}
        </Text>
      ) : null}
      {card("paseo", "Paseo", age, paseoSummary(data))}
      {card("figcraft", "FigCraft", figcraftMeta, figcraftSummary(data))}
      {card(
        "android",
        "Android device",
        data.android.status === "on" ? age : "Not set up",
        androidSummary(data),
      )}
      {card("deploy", "Deploy", deployMeta, deploySummary(data))}
    </View>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { Image, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import { taskImageRpc, type TaskImage } from "../shared/contracts.js";
import { Button } from "./button.js";
import { morePictures } from "./format.js";
import { reason } from "./reason.js";
import type { TasksStyles } from "./tasks-styles.js";

/** A task with many pictures reads this many; the rest wait for a press. */
export const PICTURES_AT_FIRST = 4;

interface Size {
  width: number;
  height: number;
}

interface PictureProps {
  taskId: string;
  image: TaskImage;
  styles: TasksStyles;
}

/**
 * One picture of a description. The daemon reads it with the saved sign-in and hands the bytes
 * over: the client has no token, and a tracker's file link needs one.
 */
function Picture({ taskId, image, styles }: PictureProps) {
  const read = useRpc(taskImageRpc);
  const file = useQuery({
    queryKey: ["tasks", "image", taskId, image.id],
    queryFn: () => read({ id: taskId, image: image.id }),
    // An upload does not change under its name.
    staleTime: Infinity,
    retry: false,
  });
  const uri = file.data === undefined ? null : `data:${file.data.mime};base64,${file.data.data}`;
  const [size, setSize] = useState<Size | null>(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    if (uri === null) return undefined;
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
  const source = useMemo(() => (uri === null ? null : { uri }), [uri]);
  // Never wider than it is: a small picture is not blown up to the column.
  const frame = useMemo(
    () =>
      size === null
        ? null
        : [styles.picture, { maxWidth: size.width, aspectRatio: size.width / size.height }],
    [styles, size],
  );
  const { refetch } = file;
  const again = useCallback(async () => {
    await refetch();
  }, [refetch]);
  if (file.isError) {
    return (
      <View style={styles.block}>
        <Text style={styles.muted}>{`${image.name}: ${reason(file.error)}`}</Text>
        <Button label="Try again" onPress={again} styles={styles} />
      </View>
    );
  }
  if (broken) {
    return <Text style={styles.muted}>{`${image.name}: this picture cannot be drawn here`}</Text>;
  }
  if (source === null || frame === null) {
    return <Text style={styles.muted}>{`Loading ${image.name}...`}</Text>;
  }
  return (
    <Image
      accessibilityRole="image"
      accessibilityLabel={image.name}
      source={source}
      style={frame}
      resizeMode="contain"
    />
  );
}

export interface TaskImagesProps {
  taskId: string;
  images: readonly TaskImage[];
  styles: TasksStyles;
}

/** The pictures a task's description held, under its text, in the order they stood. */
export function TaskImages({ taskId, images, styles }: TaskImagesProps) {
  const [all, setAll] = useState(false);
  const showAll = useCallback(() => setAll(true), []);
  if (images.length === 0) return null;
  const shown = all ? images : images.slice(0, PICTURES_AT_FIRST);
  const waiting = images.length - shown.length;
  return (
    <View style={styles.pictures}>
      {shown.map((image) => (
        <Picture key={image.id} taskId={taskId} image={image} styles={styles} />
      ))}
      {waiting === 0 ? null : (
        <Button label={morePictures(waiting)} onPress={showAll} styles={styles} />
      )}
    </View>
  );
}

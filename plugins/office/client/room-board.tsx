import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import type { Post } from "../shared/contracts.js";
import { ActionButton } from "./action-button.js";
import { boardPreview, postMeta, todoPreview } from "./board-text.js";
import type { OfficeRoom } from "../shared/model.js";
import type { OfficeStyles } from "./styles.js";

export interface PostRowProps {
  post: Post;
  name(author: string): string;
  styles: OfficeStyles;
  /** In a room card: one line of who and what, two of text. The board sheet shows all of both. */
  brief?: boolean;
}

export function PostRow({ post, name, styles, brief = false }: PostRowProps) {
  return (
    <View style={styles.post}>
      <Text style={styles.postMeta} numberOfLines={brief ? 1 : undefined}>
        {postMeta(post, name)}
      </Text>
      <Text style={styles.postText} numberOfLines={brief ? 2 : undefined}>
        {post.text}
      </Text>
    </View>
  );
}

export interface RoomBoardProps {
  room: OfficeRoom;
  name(author: string): string;
  styles: OfficeStyles;
  onOpenBoard(roomId: string): void;
}

/**
 * The room's board under its agents: the first open tasks, claimed tasks and notes, and how many
 * more the board holds. The lobby's shows its unfinished to-dos instead. An empty board is one
 * line, so a list of quiet rooms stays short.
 */
export function RoomBoard({ room, name, styles, onOpenBoard }: RoomBoardProps) {
  const open = useCallback(() => onOpenBoard(room.id), [onOpenBoard, room.id]);
  const preview = useMemo(
    () => (room.lobby ? todoPreview(room.todos) : boardPreview(room.posts)),
    [room.lobby, room.todos, room.posts],
  );
  return (
    <View style={styles.boardSection}>
      <View style={styles.boardTitleRow}>
        <View style={styles.boardHeading}>
          <Text style={styles.boardTitle}>{room.lobby ? "To-do" : "Board"}</Text>
          {preview.shown.length === 0 ? (
            <Text style={styles.postMeta}>{room.lobby ? "No to-dos" : "No posts"}</Text>
          ) : null}
        </View>
        <ActionButton label="Open board" pendingLabel="Opening..." onPress={open} styles={styles} />
      </View>
      {preview.shown.map((post) => (
        <PostRow key={post.id} post={post} name={name} styles={styles} brief />
      ))}
      {preview.more > 0 ? <Text style={styles.postMeta}>{preview.more} more</Text> : null}
    </View>
  );
}

import { Maximize2 } from "lucide-react-native";
import { useMemo, type ReactNode } from "react";
import {
  SheetHeaderIconButton,
  SheetHeaderSubtitle,
  SheetHeaderView,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";

export interface BesideHeaderProps {
  /** The target's icon, or null when it has none. */
  icon: ReactNode;
  title: string;
  subtitle?: string;
  /** The leading action: opens the target in its own place and closes the side area. */
  action: { label: string; onPress(): void };
  onClose(): void;
}

/**
 * The side area's header, the sheet pane's header in both layouts: icon, title, a second line, the
 * leading action and Close. The action is the full-screen glyph that Open as tab uses, labelled for
 * its tooltip and screen readers, because the header's trailing rail holds icon buttons only.
 */
export function BesideHeader({ icon, title, subtitle, action, onClose }: BesideHeaderProps) {
  const { label, onPress } = action;
  const header = useMemo<SheetHeader>(
    () => ({
      title,
      leading: icon ?? undefined,
      subtitle: subtitle ? <SheetHeaderSubtitle text={subtitle} /> : undefined,
      actions: (
        <SheetHeaderIconButton
          icon={Maximize2}
          label={label}
          onPress={onPress}
          testID="beside-header-action"
        />
      ),
    }),
    [icon, label, onPress, subtitle, title],
  );
  return (
    <SheetHeaderView
      header={header}
      onClose={onClose}
      testID="beside-header"
      closeTestID="beside-header-close"
    />
  );
}

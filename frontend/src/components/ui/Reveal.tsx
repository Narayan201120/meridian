import { memo } from "react";
import { View, type ViewProps } from "react-native";

const playedOnce = new Set<string>();

// Animations removed for startup performance. The old version created two
// Animated.Value per card and ran a parallel timing on every mount, which
// cost frames on weak devices. Content renders instantly now.
export const Reveal = memo(function Reveal({
  children,
  once,
  ...props
}: {
  children: React.ReactNode;
  delay?: number;
  once?: string;
} & ViewProps) {
  if (once !== undefined) playedOnce.add(once);
  return <View {...props}>{children}</View>;
});

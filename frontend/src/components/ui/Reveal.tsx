import { useEffect, useRef } from "react";
import { Animated, type ViewProps } from "react-native";
import { useReducedMotion } from "../../hooks/useReducedMotion";

const playedOnce = new Set<string>();

// Fade-and-rise mount animation. Pass `once` with a stable id to play
// a single time per session (cold-start stagger); otherwise replays
// on every mount. Renders instantly when reduced motion is enabled.
export function Reveal({
  children,
  delay = 0,
  once,
  ...props
}: {
  children: React.ReactNode;
  delay?: number;
  once?: string;
} & ViewProps) {
  const reduced = useReducedMotion();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(8)).current;

  useEffect(() => {
    if (reduced) {
      opacity.setValue(1);
      translateY.setValue(0);
      return;
    }
    if (once !== undefined) {
      if (playedOnce.has(once)) {
        opacity.setValue(1);
        translateY.setValue(0);
        return;
      }
      playedOnce.add(once);
    }
    const animation = Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 220, delay, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 220, delay, useNativeDriver: true }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [reduced, delay, once, opacity, translateY]);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }} {...props}>
      {children}
    </Animated.View>
  );
}

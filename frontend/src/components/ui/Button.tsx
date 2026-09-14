import { useRef } from "react";
import { AccessibilityInfo, ActivityIndicator, Animated, Pressable, Text } from "react-native";
import { cn } from "../../lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "destructive";
type Size = "sm" | "md";

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className,
  textClassName,
  children,
  ...props
}: {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
  textClassName?: string;
  children: string;
} & React.ComponentProps<typeof Pressable>) {
  const base = "items-center justify-center rounded-xl flex-row gap-2 min-h-[44px] min-w-[44px] px-4";
  const sizes = { sm: "h-9 px-3", md: "h-11 px-4" }[size];
  const variants: Record<Variant, string> = {
    primary: "bg-primary active:bg-primarypressed",
    secondary: "bg-secondarybtn active:bg-secondarybtnpressed",
    ghost: "bg-transparent active:bg-black/5 dark:active:bg-white/10 border border-borderfaint dark:border-nightborder",
    destructive: "bg-redbg active:bg-redbgpressed",
  };
  const textVariants: Record<Variant, string> = {
    primary: "text-creamtext font-sans-bold",
    secondary: "text-secondarybtntext font-sans-bold",
    ghost: "text-secondarybtntext dark:text-nighttext font-sans-bold",
    destructive: "text-redtext font-sans-bold",
  };

  const scale = useRef(new Animated.Value(1)).current;

  function pressIn() {
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (!reduced) {
        Animated.timing(scale, { toValue: 0.97, duration: 90, useNativeDriver: true }).start();
      }
    });
  }

  function pressOut() {
    Animated.timing(scale, { toValue: 1, duration: 140, useNativeDriver: true }).start();
  }

  return (
    <Pressable
      disabled={disabled || loading}
      onPressIn={pressIn}
      onPressOut={pressOut}
      className={cn(base, sizes, variants[variant], (disabled || loading) && "opacity-60", className)}
      style={{ transform: [{ scale }] }}
      {...props}
    >
      {loading ? <ActivityIndicator size="small" color={variant === "primary" ? "#FFF8EE" : "#27443E"} /> : null}
      <Text className={cn("text-[13px] text-center", textVariants[variant], textClassName)}>{children}</Text>
    </Pressable>
  );
}

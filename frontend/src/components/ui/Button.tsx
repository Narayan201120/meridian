import { ActivityIndicator, Pressable, Text } from "react-native";
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
  const base = "items-center justify-center rounded-full flex-row gap-2 min-h-[44px] min-w-[44px] px-4";
  const sizes = { sm: "h-9 px-3", md: "h-11 px-4" }[size];
  const variants: Record<Variant, string> = {
    primary: "bg-[#09261E] active:bg-[#0a2f25]",
    secondary: "bg-[#E8EEE8] active:bg-[#dbe7db]",
    ghost: "bg-transparent active:bg-black/5 border border-[#E2E8F0]",
    destructive: "bg-[#F6DED3] active:bg-[#f3c9b8]",
  };
  const textVariants: Record<Variant, string> = {
    primary: "text-[#FFF8EE] font-bold",
    secondary: "text-[#27443E] font-bold",
    ghost: "text-[#27443E] font-bold",
    destructive: "text-[#7F2E14] font-bold",
  };

  return (
    <Pressable
      disabled={disabled || loading}
      className={cn(base, sizes, variants[variant], (disabled || loading) && "opacity-60", className)}
      {...props}
    >
      {loading ? <ActivityIndicator size="small" color={variant === "primary" ? "#FFF8EE" : "#27443E"} /> : null}
      <Text className={cn("text-[13px] font-bold text-center", textVariants[variant], textClassName)}>{children}</Text>
    </Pressable>
  );
}

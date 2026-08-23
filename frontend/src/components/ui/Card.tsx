import { View } from "react-native";
import { cn } from "../../lib/cn";

export function Card({
  variant = "floating",
  className,
  children,
  ...props
}: {
  variant?: "floating" | "hero" | "ghost";
  className?: string;
  children: React.ReactNode;
} & React.ComponentProps<typeof View>) {
  const variants: Record<string, string> = {
    floating: "bg-[#FFFDF8] border border-[#E2E8F0] rounded-2xl p-6 md:p-8 shadow-sm",
    hero: "bg-[#09261E] rounded-3xl p-6 md:p-8",
    ghost: "bg-transparent",
  };
  return (
    <View className={cn(variants[variant], className)} {...props}>
      {children}
    </View>
  );
}

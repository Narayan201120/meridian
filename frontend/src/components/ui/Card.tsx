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
    floating:
      "bg-cardsurf border border-borderfaint rounded-2xl p-6 md:p-8 shadow-[0_2px_16px_rgba(9,38,30,0.06)]",
    hero: "bg-primary rounded-3xl p-6 md:p-8 border-t-2 border-t-brass",
    ghost: "bg-transparent",
  };
  return (
    <View className={cn(variants[variant], className)} {...props}>
      {children}
    </View>
  );
}

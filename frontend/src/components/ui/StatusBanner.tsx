import { Pressable, Text, View } from "react-native";
import { AlertCircle, CheckCircle2, Info } from "lucide-react-native";
import { cn } from "../../lib/cn";

export function StatusBanner({
  variant = "info",
  title,
  message,
  actionLabel,
  onAction,
  className,
}: {
  variant?: "error" | "success" | "warning" | "info";
  title?: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}) {
  const variants: Record<string, string> = {
    error: "bg-red-50 border-red-200",
    success: "bg-successbg border-successborder",
    warning: "bg-amber-50 border-amber-200",
    info: "bg-slate-50 border-slate-200",
  };
  const Icon = variant === "error" ? AlertCircle : variant === "success" ? CheckCircle2 : Info;
  // Icon colors mirror the banner text tokens (red-800 / successtext / slate500);
  // hex is required here because Lucide takes a runtime color prop, not a class.
  const iconColor = variant === "error" ? "#991B1B" : variant === "success" ? "#355B22" : "#64748B";

  return (
    <View className={cn("flex-row items-start gap-3 rounded-xl border px-4 py-3", variants[variant], className)}>
      <Icon size={16} color={iconColor} style={{ marginTop: 2 }} />
      <View className="flex-1 gap-1">
        {title ? <Text className="text-[12px] font-extrabold uppercase tracking-wide text-redtext">{title}</Text> : null}
        <Text className="text-[14px] leading-5 text-neutral900">{message}</Text>
      </View>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} className="ml-auto min-h-[44px] justify-center px-3 rounded-full bg-white border border-borderfaint">
          <Text className="text-[13px] font-bold text-primary">{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

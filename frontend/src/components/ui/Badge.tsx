import { Text, View } from "react-native";
import { cn } from "../../lib/cn";

const map: Record<string, string> = {
  inbox: "bg-[#E4F0E7] text-[#204636]",
  scheduled: "bg-[#F3E2B8] text-[#7B5D17]",
  due_now: "bg-[#F7D9BD] text-[#8A4A16]",
  completed: "bg-[#D7E1EF] text-[#324F75]",
  archived: "bg-slate-100 text-slate-600",
};

export function Badge({ status, className }: { status: string; className?: string }) {
  return (
    <View className={cn("rounded-full px-2.5 py-1.5 self-start", map[status] ?? "bg-slate-100", className)}>
      <Text className={cn("text-[11px] font-extrabold uppercase tracking-wide", map[status]?.split(" ").pop() ?? "text-slate-600")}>{status}</Text>
    </View>
  );
}

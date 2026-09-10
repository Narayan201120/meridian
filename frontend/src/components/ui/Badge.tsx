import { Text, View } from "react-native";
import { cn } from "../../lib/cn";

const map: Record<string, string> = {
  inbox: "bg-inboxbg text-inboxtext",
  scheduled: "bg-scheduledbg text-scheduledtext",
  due_now: "bg-duenowbg text-duenowtext",
  completed: "bg-completedbg text-completedtext",
};

export function Badge({ status, className }: { status: string; className?: string }) {
  return (
    <View className={cn("rounded-full px-2.5 py-1.5 self-start", map[status] ?? "bg-slate-100", className)}>
      <Text className={cn("text-[11px] font-extrabold uppercase tracking-wide", map[status]?.split(" ").pop() ?? "text-slate-600")}>{status}</Text>
    </View>
  );
}

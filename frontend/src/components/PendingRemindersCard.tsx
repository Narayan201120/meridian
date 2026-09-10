import { Pressable, Text, View } from "react-native";
import { acknowledgeReminder, describeTaskError, type Reminder } from "../lib/tasks";

function formatTaskTime(value: string | null) {
  if (!value) return "No time set";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

export function PendingRemindersCard({ pending, onAcked, onError }: { pending: Reminder[]; onAcked: (id: string) => void; onError: (m: string) => void }) {
  if (pending.length === 0) return null;
  return (
    <View className="bg-cardsurf border border-borderfaint rounded-2xl p-6 md:p-8 shadow-sm gap-4">
      <Text className="text-brass text-[12px] font-bold tracking-[1.1px] uppercase">Pending reminders</Text>
      <Text className="text-bodytext text-[15px] leading-6">
        {pending.length} reminder{pending.length > 1 ? "s" : ""} waiting for delivery. Tap ack when seen.
      </Text>
      {pending.map((r) => (
        <View key={r.id} className="bg-sandbg rounded-2xl p-3 border border-sandborder gap-1">
          <Text className="text-ink text-[14px] font-bold">{r.type === "scheduled_block" ? "Block" : "Due"} — {formatTaskTime(r.scheduled_for)}</Text>
          {__DEV__ ? (
            <Text className="text-bodytext text-[13px]">{r.status} · {r.id.slice(0, 8)}</Text>
          ) : null}
          <Pressable
            className="rounded-full bg-secondarybtn px-3 py-2 min-h-[44px] justify-center items-center"
            onPress={async () => {
              try {
                await acknowledgeReminder(r.id);
                onAcked(r.id);
              } catch (e: any) {
                onError(describeTaskError(e));
              }
            }}
          >
            <Text className="text-secondarybtntext text-[12px] font-bold">Ack</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

import { Text, View } from "react-native";
import { acknowledgeReminder, describeTaskError, type Reminder } from "../lib/tasks";
import { formatTaskTime } from "../lib/datetime";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

export function PendingRemindersCard({ pending, onAcked, onError }: { pending: Reminder[]; onAcked: (id: string) => void; onError: (m: string) => void }) {
  if (pending.length === 0) return null;
  return (
    <Card variant="floating" className="gap-4">
      <Text className="text-brass text-[13px] font-sans-medium">Pending reminders</Text>
      <Text className="text-bodytext text-[15px] leading-6">
        {pending.length} reminder{pending.length > 1 ? "s" : ""} waiting for delivery. Tap ack when seen.
      </Text>
      {pending.map((r) => (
        <View key={r.id} className="bg-sandbg rounded-2xl p-3 border border-sandborder gap-1">
          <Text className="text-ink text-[14px] font-sans-bold">{r.type === "scheduled_block" ? "Block" : "Due"} — {formatTaskTime(r.scheduled_for)}</Text>
          {__DEV__ ? (
            <Text className="text-bodytext text-[13px]">{r.status} · {r.id.slice(0, 8)}</Text>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            onPress={async () => {
              try {
                await acknowledgeReminder(r.id);
                onAcked(r.id);
              } catch (e: any) {
                onError(describeTaskError(e));
              }
            }}
          >
            Ack
          </Button>
        </View>
      ))}
    </Card>
  );
}

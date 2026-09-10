import { Text, View } from "react-native";
import { Button } from "./ui/Button";
import { DateTimeField } from "./ui/DateTimeField";

export function ScheduleEditor({
  value,
  isBusy,
  onValue,
  onSave,
  onCancel,
}: {
  value: string;
  isBusy: boolean;
  onValue: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <View className="gap-3 pt-1">
      <Text className="text-[13px] font-bold text-bodytext">Schedule time</Text>
      <DateTimeField label="Date and time" value={value} onChange={onValue} />
      <View className="flex-row flex-wrap gap-2">
        <Button variant="primary" size="sm" loading={isBusy} onPress={onSave}>
          Save schedule
        </Button>
        <Button variant="ghost" size="sm" onPress={onCancel}>
          Cancel
        </Button>
      </View>
    </View>
  );
}

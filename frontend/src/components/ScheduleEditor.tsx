import { Text, View } from "react-native";
import { Button } from "./ui/Button";
import { InputField } from "./ui/InputField";

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
      <InputField
        label="Date and time"
        placeholder="YYYY-MM-DDTHH:MM"
        value={value}
        onChangeText={onValue}
        autoCapitalize="none"
      />
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

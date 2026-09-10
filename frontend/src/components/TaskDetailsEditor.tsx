import { Text, View } from "react-native";
import { Button } from "./ui/Button";
import { InputField, TextArea } from "./ui/InputField";
import { Chip } from "./ui/Chip";
import type { Task } from "../lib/tasks";

export function TaskDetailsEditor({
  title,
  notes,
  duration,
  priority,
  isBusy,
  onTitle,
  onNotes,
  onDuration,
  onPriority,
  onSave,
  onCancel,
}: {
  title: string;
  notes: string;
  duration: string;
  priority: Task["priority"];
  isBusy: boolean;
  onTitle: (v: string) => void;
  onNotes: (v: string) => void;
  onDuration: (v: string) => void;
  onPriority: (v: Task["priority"]) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <View className="gap-3 pt-1">
      <Text className="text-[13px] font-bold text-bodytext">Task details</Text>
      <InputField label="Title" placeholder="Task title" value={title} onChangeText={onTitle} />
      <TextArea label="Notes" placeholder="Notes (optional)" value={notes} onChangeText={onNotes} />
      <InputField
        label="Estimated duration"
        placeholder="Minutes (optional)"
        value={duration}
        onChangeText={onDuration}
        keyboardType="number-pad"
      />
      <View className="flex-row flex-wrap gap-2">
        {(["low", "medium", "high"] as const).map((p) => (
          <Chip key={p} label={p} active={priority === p} onPress={() => onPriority(p)} />
        ))}
      </View>
      <View className="flex-row flex-wrap gap-2">
        <Button variant="primary" size="sm" loading={isBusy} onPress={onSave}>
          Save details
        </Button>
        <Button variant="ghost" size="sm" onPress={onCancel}>
          Cancel
        </Button>
      </View>
    </View>
  );
}

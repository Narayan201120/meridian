import { View, Text } from "react-native";
import { Card } from "./ui/Card";
import { InputField, TextArea } from "./ui/InputField";
import { Button } from "./ui/Button";
import { Chip } from "./ui/Chip";
import { SectionHeader } from "./ui/SectionHeader";
import { StatusBanner } from "./ui/StatusBanner";
import { useTaskCreate } from "../hooks/useTaskCreate";

export function CreateTaskForm() {
  const {
    title,
    setTitle,
    notes,
    setNotes,
    draftPriority,
    setDraftPriority,
    draftDuration,
    setDraftDuration,
    scheduledForInput,
    setScheduledForInput,
    draftStatus,
    setDraftStatus,
    isSubmitting,
    isStructuring,
    errorMessage,
    handleStructureCapture,
    handleCreateTask,
  } = useTaskCreate();

  return (
    <Card variant="floating" className="gap-4">
      <SectionHeader eyebrow="CREATE TASK" title="Add something real" body="Keep this first flow narrow: title, optional notes, then decide whether it lands in inbox or scheduled work with a real activation time." />
      <View className="flex-row flex-wrap gap-2">
        {[
          { key: "inbox", label: "Send to inbox" },
          { key: "scheduled", label: "Mark scheduled" },
        ].map((opt) => (
          <Chip key={opt.key} label={opt.label} active={draftStatus === opt.key} onPress={() => setDraftStatus(opt.key as any)} />
        ))}
      </View>
      <InputField label="Task title" placeholder="Task title" value={title} onChangeText={setTitle} />
      <TextArea label="Notes (optional)" placeholder="Notes (optional)" value={notes} onChangeText={setNotes} />
      <Button variant="secondary" size="sm" loading={isStructuring} onPress={handleStructureCapture}>
        {isStructuring ? "Structuring..." : "Structure details"}
      </Button>
      <InputField label="Estimated duration (minutes)" placeholder="Estimated duration in minutes (optional)" value={draftDuration} onChangeText={setDraftDuration} keyboardType="number-pad" />
      <View className="flex-row flex-wrap gap-2">
        {(["low", "medium", "high"] as const).map((p) => (
          <Chip key={p} label={p} active={draftPriority === p} onPress={() => setDraftPriority(p)} />
        ))}
      </View>
      {draftStatus === "scheduled" ? <InputField label="Schedule time" placeholder="Schedule time: YYYY-MM-DDTHH:MM" value={scheduledForInput} onChangeText={setScheduledForInput} autoCapitalize="none" /> : null}
      <Button variant="primary" size="md" loading={isSubmitting} onPress={handleCreateTask}>
        {isSubmitting ? "Adding task..." : draftStatus === "scheduled" ? "Add scheduled task" : "Add task"}
      </Button>
      {errorMessage ? <StatusBanner variant="error" message={errorMessage} /> : null}
    </Card>
  );
}

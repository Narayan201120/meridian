import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";

// Native date/time picker (web uses DateTimeField.web.tsx).
// Value is an ISO string (or "" when unset).
export function DateTimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (iso: string) => void;
}) {
  const [step, setStep] = useState<"date" | "time" | null>(null);
  const [draft, setDraft] = useState<Date | null>(null);

  const parsed = value ? new Date(value) : null;
  const shown = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleString() : "Pick a date and time";

  function open() {
    setDraft(parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date());
    setStep("date");
  }

  function onPick(event: DateTimePickerEvent, selected?: Date) {
    if (event.type === "dismissed") {
      setStep(null);
      return;
    }
    const base = selected ?? draft ?? new Date();
    if (step === "date") {
      setDraft(base);
      setStep("time");
      return;
    }
    setStep(null);
    onChange(base.toISOString());
  }

  return (
    <View className="gap-1.5">
      <Text className="text-[13px] font-semibold text-graphite ml-1">{label}</Text>
      <Pressable
        onPress={open}
        className="bg-cardsurf border border-borderfaint rounded-xl px-4 py-3 min-h-[44px] justify-center"
      >
        <Text className="text-[15px] text-graphite">{shown}</Text>
      </Pressable>
      {step !== null && draft !== null ? (
        <DateTimePicker value={draft} mode={step} is24Hour onChange={onPick} />
      ) : null}
    </View>
  );
}

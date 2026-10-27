import { Suspense, lazy, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

const NativePicker = lazy(() => import("@react-native-community/datetimepicker"));

// Native date/time picker (web uses DateTimeField.web.tsx).
// The native picker module loads only after the user taps the field, so
// scheduling UI costs nothing for users who never schedule.
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

  const shown = useMemo(() => {
    const parsed = value ? new Date(value) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleString() : "Pick a date and time";
  }, [value]);

  function open() {
    const parsed = value ? new Date(value) : null;
    setDraft(parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date());
    setStep("date");
  }

  function onPick(event: { type: string }, selected?: Date) {
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
      <Text className="text-[13px] font-semibold text-graphite dark:text-nighttext ml-1">{label}</Text>
      <Pressable
        onPress={open}
        className="bg-cardsurf border border-borderfaint rounded-xl px-4 py-3 min-h-[44px] justify-center"
      >
        <Text className="text-[15px] text-graphite dark:text-nighttext">{shown}</Text>
      </Pressable>
      {step !== null && draft !== null ? (
        <Suspense fallback={null}>
          <NativePicker value={draft} mode={step} is24Hour onChange={onPick as any} />
        </Suspense>
      ) : null}
    </View>
  );
}

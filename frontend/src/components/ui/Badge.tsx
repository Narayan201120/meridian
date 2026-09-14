import { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, Text, View } from "react-native";
import { cn } from "../../lib/cn";

const tones: Record<string, { bg: string; text: string; dot: string; border: string; label: string }> = {
  inbox: { bg: "bg-inboxbg", text: "text-inboxtext", dot: "bg-inboxtext", border: "border-inboxtext/20", label: "Inbox" },
  scheduled: { bg: "bg-brasstint", text: "text-brass", dot: "bg-brass", border: "border-brass/25", label: "Scheduled" },
  due_now: { bg: "bg-redbg", text: "text-redtext", dot: "bg-redtext", border: "border-redtext/25", label: "Due now" },
  completed: { bg: "bg-completedbg", text: "text-completedtext", dot: "bg-completedtext", border: "border-completedtext/20", label: "Completed" },
  archived: { bg: "bg-slate-100", text: "text-slate-600", dot: "bg-slate-400", border: "border-slate-300", label: "Archived" },
};

export function Badge({ status, className }: { status: string; className?: string }) {
  const tone = tones[status] ?? tones["archived"]!;
  const dotOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let stopped = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (stopped || reduced) {
        dotOpacity.setValue(1);
        return;
      }
      dotOpacity.setValue(0);
      Animated.timing(dotOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    });
    return () => {
      stopped = true;
    };
  }, [status, dotOpacity]);

  return (
    <View
      className={cn(
        "flex-row items-center gap-1.5 self-start rounded-full border px-2.5 py-1.5",
        tone.bg,
        tone.border,
        className
      )}
    >
      <Animated.View key={status} style={{ opacity: dotOpacity }} className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} />
      <Text className={cn("text-[12px] font-sans-medium", tone.text)}>{tone.label}</Text>
    </View>
  );
}

import { Text, View } from "react-native";

export function SectionHeader({ eyebrow, title, body, className }: { eyebrow?: string; title: string; body?: string; className?: string }) {
  return (
    <View className={["gap-2", className].filter(Boolean).join(" ")}>
      {eyebrow ? <Text className="text-[12px] font-bold tracking-[1.1px] uppercase text-eyebrow">{eyebrow}</Text> : null}
      <Text className="text-[20px] md:text-[24px] font-bold leading-7 text-ink">{title}</Text>
      {body ? <Text className="text-[15px] leading-6 text-bodytext">{body}</Text> : null}
    </View>
  );
}

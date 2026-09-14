import { Text, View } from "react-native";

export function SectionHeader({ eyebrow, title, body, className }: { eyebrow?: string; title: string; body?: string; className?: string }) {
  return (
    <View className={["gap-2", className].filter(Boolean).join(" ")}>
      {eyebrow ? <Text className="text-[13px] font-sans-medium text-brass">{eyebrow}</Text> : null}
      <Text className="text-[20px] md:text-[24px] font-heading leading-7 text-ink dark:text-nighttext">{title}</Text>
      {body ? <Text className="text-[15px] font-sans leading-6 text-bodytext dark:text-nightmuted">{body}</Text> : null}
    </View>
  );
}

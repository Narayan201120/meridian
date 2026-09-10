import { Pressable, Text, View } from "react-native";
import { cn } from "../../lib/cn";

export function Chip({
  active,
  label,
  count,
  onPress,
  className,
}: {
  active?: boolean;
  label: string;
  count?: number;
  onPress?: () => void;
  className?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={cn(
        "flex-row items-center gap-2 rounded-full px-3 py-2 border min-h-[44px]",
        active ? "bg-primary border-primary" : "bg-chipbg border-chipborder",
        className
      )}
    >
      <Text className={cn("text-[13px] font-bold", active ? "text-white" : "text-chiptext")}>{label}</Text>
      {count !== undefined ? (
        <View className={cn("min-w-[20px] rounded-full px-1.5 py-0.5 items-center", active ? "bg-chipcountbg" : "bg-white")}>
          <Text className={cn("text-[11px] font-extrabold", active ? "text-white" : "text-sandtext")}>{count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

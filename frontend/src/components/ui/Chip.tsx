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
        active ? "bg-[#09261E] border-[#09261E]" : "bg-[#F5EADB] border-[#E0D0B5]",
        className
      )}
    >
      <Text className={cn("text-[13px] font-bold", active ? "text-white" : "text-[#26413C]")}>{label}</Text>
      {count !== undefined ? (
        <View className={cn("min-w-[20px] rounded-full px-1.5 py-0.5 items-center", active ? "bg-[#33594F]" : "bg-white")}>
          <Text className={cn("text-[11px] font-extrabold", active ? "text-white" : "text-[#5B615D]")}>{count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

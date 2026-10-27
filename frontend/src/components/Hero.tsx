import { Text, View } from "react-native";
import { Card } from "./ui/Card";
import { MeridianMark } from "./MeridianMark";

export function Hero() {
  return (
    <Card variant="hero">
      <View className="flex-row items-center gap-2 mb-2">
        <MeridianMark size={16} />
        <Text className="text-kicker text-[13px] font-sans-bold tracking-[1.4px] uppercase">Meridian</Text>
      </View>
      <Text className="text-creamtext text-[28px] leading-[34px] sm:text-[32px] sm:leading-[38px] lg:text-[36px] lg:leading-[42px] font-display mb-3">Capture a task, then give it somewhere real to go.</Text>
      <Text className="text-herosub text-[15px] md:text-[16px] font-sans leading-6">Capture fast, schedule around your calendar, and get reminded at the right moment.</Text>
    </Card>
  );
}

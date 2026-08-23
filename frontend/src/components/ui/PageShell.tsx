import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView className="flex-1 bg-[#FDFBF7]">
      <ScrollView contentContainerClassName="flex-grow items-center w-full">
        <View className="w-full max-w-[720px] md:max-w-[840px] lg:max-w-[960px] px-4 md:px-6 py-6 gap-6">{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

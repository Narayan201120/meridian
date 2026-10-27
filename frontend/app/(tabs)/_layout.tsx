import { memo } from "react";
import { Tabs } from "expo-router";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BellRing, CalendarClock, CircleCheck, House, Inbox } from "../../src/components/icons";
import { TasksProvider, useTasksContext } from "../../src/context/TasksContext";
import { StatusBanner } from "../../src/components/ui/StatusBanner";
import { useTheme } from "../../src/context/ThemeContext";

function tabIcon(Icon: typeof House) {
  return ({ color, size }: { color: string; size: number }) => <Icon size={Math.min(size, 22)} color={color} />;
}

const ThemedTabs = memo(function ThemedTabs() {
  const { scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const dark = scheme === "dark";
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: dark ? "#E8D9B0" : "#09261E",
        tabBarInactiveTintColor: dark ? "#9AA79E" : "#64748B",
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: { fontSize: 11 },
        tabBarItemStyle: { minHeight: 56, paddingVertical: 8 },
        tabBarStyle: {
          backgroundColor: dark ? "#14201B" : "#FFFDF8",
          borderTopColor: dark ? "#24352C" : "#E2E8F0",
          minHeight: 56 + (Platform.OS === "ios" ? insets.bottom : 0),
          paddingBottom: Platform.OS === "ios" ? insets.bottom : 8,
        },
      }}
    >
        <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: tabIcon(House) }} />
        <Tabs.Screen name="inbox" options={{ title: "Inbox", tabBarIcon: tabIcon(Inbox) }} />
        <Tabs.Screen name="scheduled" options={{ title: "Scheduled", tabBarIcon: tabIcon(CalendarClock) }} />
        <Tabs.Screen name="due_now" options={{ title: "Due now", tabBarIcon: tabIcon(BellRing) }} />
        <Tabs.Screen name="completed" options={{ title: "Completed", tabBarIcon: tabIcon(CircleCheck) }} />
    </Tabs>
  );
});

export default function TabsLayout() {
  return (
    <TasksProvider>
      <GlobalErrorBanner />
      <ThemedTabs />
    </TasksProvider>
  );
}

function GlobalErrorBanner() {
  const { errorMessage } = useTasksContext();
  if (!errorMessage) return null;
  return (
    <View className="w-full items-center px-4 sm:px-5 pt-4">
      <View className="w-full max-w-[720px] md:max-w-[840px] lg:max-w-[960px]">
        <StatusBanner variant="error" title="Current issue" message={errorMessage} />
      </View>
    </View>
  );
}

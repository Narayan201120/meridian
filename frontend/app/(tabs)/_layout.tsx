import { Tabs } from "expo-router";
import { View } from "react-native";
import { BellRing, CalendarClock, CircleCheck, House, Inbox } from "lucide-react-native";
import { TasksProvider, useTasksContext } from "../../src/context/TasksContext";
import { StatusBanner } from "../../src/components/ui/StatusBanner";
import { useTheme } from "../../src/context/ThemeContext";

function tabIcon(Icon: typeof House) {
  return ({ color, size }: { color: string; size: number }) => <Icon size={size} color={color} strokeWidth={1.5} />;
}

function ThemedTabs() {
  const { scheme } = useTheme();
  const dark = scheme === "dark";
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: dark ? "#E8D9B0" : "#09261E",
        tabBarInactiveTintColor: dark ? "#9AA79E" : "#64748B",
        tabBarStyle: {
          backgroundColor: dark ? "#14201B" : "#FFFDF8",
          borderTopColor: dark ? "#24352C" : "#E2E8F0",
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
}

export default function TabsLayout() {
  return (
    <TasksProvider>
      <GlobalErrorBanner />
      <ThemedTabs />
    </TasksProvider>
  );
}

// Reported once for every tab. TaskCardConnected mutations on the
// Inbox/Scheduled/Due now/Completed tabs notify through
// TasksContext.setErrorMessage, but no tab screen rendered that text: only
// Home rendered its own local errorMessage, and Inbox read the context value
// as a boolean. A banner here, above the tab screens, is seen from whichever
// tab the user acted on, so a failed write cannot be filed where nobody looks.
// Home keeps its own banners: they render Home-local state (useState in
// index.tsx, including the signed-out copy), not this context value, so
// removing them would hide Home-strip errors instead of deduplicating.
function GlobalErrorBanner() {
  const { errorMessage } = useTasksContext();
  if (!errorMessage) return null;
  return (
    <View className="w-full items-center px-4 pt-4">
      <View className="w-full max-w-[720px] md:max-w-[840px] lg:max-w-[960px]">
        <StatusBanner variant="error" title="Current issue" message={errorMessage} />
      </View>
    </View>
  );
}

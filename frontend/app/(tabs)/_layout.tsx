import { Tabs } from "expo-router";
import { BellRing, CalendarClock, CircleCheck, House, Inbox } from "lucide-react-native";
import { TasksProvider } from "../../src/context/TasksContext";
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
      <ThemedTabs />
    </TasksProvider>
  );
}

import { Text, View } from "react-native";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";
import { tasksRuntime } from "../lib/tasks";
import { useTheme } from "../context/ThemeContext";
import type { AuthSession } from "../lib/auth";

export function ModeStatus({
  authSession,
  calendarStatus,
  isSyncing,
  isSigningOut,
  onRefresh,
  onSync,
  onSignOut,
}: {
  authSession: AuthSession | null;
  calendarStatus: string | null;
  isSyncing: boolean;
  isSigningOut: boolean;
  onRefresh: () => void;
  onSync: () => void;
  onSignOut: () => void;
}) {
  const calendarDot = calendarStatus === "active" ? "bg-brass" : "bg-slate500";
  const { scheme, toggle } = useTheme();
  return (
    <Card variant="floating" className="shadow-none">
      <View>
        <Text className="text-brass text-[13px] font-sans-medium mb-2">{tasksRuntime.isApiMode ? "API mode" : "Demo mode"}</Text>
        <Text className="text-ink text-[18px] leading-6 font-bold">
          {tasksRuntime.isApiMode
            ? authSession
              ? "Frontend is calling the backend with a Supabase bearer token."
              : "Sign in with your Supabase user to load live tasks."
            : "Frontend is using local demo data until Supabase auth is configured."}
        </Text>
        {__DEV__ ? (
          <Text className="text-captiontext text-[14px] leading-5">Base URL: {tasksRuntime.apiBaseUrl}</Text>
        ) : null}
        {tasksRuntime.isApiMode && authSession ? (
          <>
            <Text className="text-captiontext text-[14px] leading-5">Signed in as {authSession.user.email ?? "your account"}</Text>
            <View className="flex-row items-center gap-1.5">
              <View className={`h-1.5 w-1.5 rounded-full ${calendarDot}`} />
              <Text className="text-captiontext text-[14px] leading-5">Calendar: {calendarStatus ?? "checking..."}</Text>
            </View>
          </>
        ) : null}
      </View>
      {tasksRuntime.isApiMode && authSession ? (
        <View className="flex-row flex-wrap gap-2">
          <Button variant="ghost" size="sm" onPress={toggle}>{scheme === "dark" ? "Light mode" : "Dark mode"}</Button>
          <Button variant="secondary" size="sm" onPress={onRefresh}>Refresh</Button>
          {calendarStatus === "active" ? (
            <Button variant="secondary" size="sm" loading={isSyncing} onPress={onSync}>{isSyncing ? "Syncing..." : "Sync calendar"}</Button>
          ) : null}
          <Button variant="destructive" size="sm" loading={isSigningOut} onPress={onSignOut}>{isSigningOut ? "Signing out..." : "Sign out"}</Button>
        </View>
      ) : (
        <View className="flex-row flex-wrap gap-2">
          <Button variant="ghost" size="sm" onPress={toggle}>{scheme === "dark" ? "Light mode" : "Dark mode"}</Button>
          <Button variant="secondary" size="sm" onPress={onRefresh}>{tasksRuntime.isApiMode ? "Retry" : "Refresh"}</Button>
        </View>
      )}
    </Card>
  );
}

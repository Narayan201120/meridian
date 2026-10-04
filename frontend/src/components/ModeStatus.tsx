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
  isConnecting,
  isSigningOut,
  pushState,
  pushMessage,
  isPushBusy,
  onRefresh,
  onSync,
  onConnect,
  onSignOut,
  onEnablePush,
  onDisablePush,
}: {
  authSession: AuthSession | null;
  calendarStatus: string | null;
  isSyncing: boolean;
  isConnecting: boolean;
  isSigningOut: boolean;
  pushState: { supported: boolean; reason?: string; subscribed?: boolean; permission?: string } | null;
  pushMessage: string | null;
  isPushBusy: boolean;
  onRefresh: () => void;
  onSync: () => void;
  onConnect: () => void;
  onSignOut: () => void;
  onEnablePush: () => void;
  onDisablePush: () => void;
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
            {pushState?.supported ? (
              <View className="flex-row items-center gap-1.5">
                <View className={`h-1.5 w-1.5 rounded-full ${pushState.subscribed ? "bg-brass" : "bg-slate500"}`} />
                <Text className="text-captiontext text-[14px] leading-5">
                  Reminders: {pushState.subscribed ? "on" : "only while the app is open"}
                </Text>
              </View>
            ) : null}
          </>
        ) : null}
      </View>
      {tasksRuntime.isApiMode && authSession ? (
        <View className="flex-row flex-wrap gap-2">
          <Button variant="ghost" size="sm" onPress={toggle}>{scheme === "dark" ? "Light mode" : "Dark mode"}</Button>
          <Button variant="secondary" size="sm" onPress={onRefresh}>Refresh</Button>
          {calendarStatus === "active" ? (
            <Button variant="secondary" size="sm" loading={isSyncing} onPress={onSync}>{isSyncing ? "Syncing..." : "Sync calendar"}</Button>
          ) : (
            <Button variant="secondary" size="sm" loading={isConnecting} onPress={onConnect}>
              {isConnecting ? "Opening Google..." : "Connect calendar"}
            </Button>
          )}
          {pushState?.supported ? (
            pushState.subscribed ? (
              <Button variant="ghost" size="sm" loading={isPushBusy} onPress={onDisablePush}>
                {isPushBusy ? "Turning off..." : "Turn off reminders"}
              </Button>
            ) : (
              <Button variant="secondary" size="sm" loading={isPushBusy} onPress={onEnablePush}>
                {isPushBusy ? "Enabling..." : "Enable reminders"}
              </Button>
            )
          ) : null}
          {pushMessage ? (
            <Text className="text-captiontext text-[14px] leading-5 w-full">{pushMessage}</Text>
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

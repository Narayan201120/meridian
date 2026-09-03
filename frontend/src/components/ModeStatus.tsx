import { Text, View } from "react-native";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";
import { tasksRuntime } from "../lib/tasks";
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
  return (
    <Card variant="floating">
      <View>
        <Text className="text-[#B45A36] text-[12px] font-bold tracking-[1.1px] uppercase mb-2">{tasksRuntime.isApiMode ? "API mode" : "Demo mode"}</Text>
        <Text className="text-[#1D2A2C] text-[18px] leading-6 font-bold">
          {tasksRuntime.isApiMode
            ? authSession
              ? "Frontend is calling the backend with a Supabase bearer token."
              : "Sign in with your Supabase user to load live tasks."
            : "Frontend is using local demo data until Supabase auth is configured."}
        </Text>
        <Text className="text-[#4C4A43] text-[14px] leading-5">Base URL: {tasksRuntime.apiBaseUrl}</Text>
        {tasksRuntime.isApiMode && authSession ? (
          <>
            <Text className="text-[#4C4A43] text-[14px] leading-5">Signed in as {authSession.user.email ?? authSession.user.id}</Text>
            <Text className="text-[#4C4A43] text-[14px] leading-5">Calendar: {calendarStatus ?? "checking..."}</Text>
          </>
        ) : null}
      </View>
      {tasksRuntime.isApiMode && authSession ? (
        <View className="flex-row flex-wrap gap-2">
          <Button variant="secondary" size="sm" onPress={onRefresh}>Refresh</Button>
          {calendarStatus === "active" ? (
            <Button variant="secondary" size="sm" loading={isSyncing} onPress={onSync}>{isSyncing ? "Syncing..." : "Sync calendar"}</Button>
          ) : null}
          <Button variant="destructive" size="sm" loading={isSigningOut} onPress={onSignOut}>{isSigningOut ? "Signing out..." : "Sign out"}</Button>
        </View>
      ) : (
        <Button variant="secondary" size="sm" onPress={onRefresh}>{tasksRuntime.isApiMode ? "Retry" : "Refresh"}</Button>
      )}
    </Card>
  );
}

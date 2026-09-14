import { useEffect, useState } from "react";
import "../global.css";
import { Stack } from "expo-router";
import { StatusBar } from "react-native";
import { View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts as useSpaceGrotesk, SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold } from "@expo-google-fonts/space-grotesk";
import { useFonts as usePublicSans, PublicSans_400Regular, PublicSans_600SemiBold, PublicSans_700Bold } from "@expo-google-fonts/public-sans";
import { ThemeProvider, useTheme } from "../src/context/ThemeContext";

try {
  void SplashScreen.preventAutoHideAsync();
} catch {
  // Web / environments without a native splash screen.
}

function ThemedShell() {
  const { scheme } = useTheme();
  return (
    <View className={`flex-1 bg-canvas ${scheme === "dark" ? "dark bg-night" : ""}`}>
      <StatusBar barStyle={scheme === "dark" ? "light-content" : "dark-content"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "transparent" } }} />
    </View>
  );
}

export default function RootLayout() {
  const [groteskLoaded] = useSpaceGrotesk({ SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold });
  const [sansLoaded] = usePublicSans({ PublicSans_400Regular, PublicSans_600SemiBold, PublicSans_700Bold });
  const [timedOut, setTimedOut] = useState(false);
  // Never block the app on fonts: fall back to system fonts after 3s.
  const fontsLoaded = (groteskLoaded && sansLoaded) || timedOut;

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (fontsLoaded) {
      try {
        void SplashScreen.hideAsync();
      } catch {
        // Splash may already be hidden or unsupported.
      }
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ThemedShell />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

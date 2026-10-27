import { useEffect } from "react";
import "../global.css";
import { Stack } from "expo-router";
import { Platform, StatusBar, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts as useSpaceGrotesk, SpaceGrotesk_700Bold } from "@expo-google-fonts/space-grotesk";
import { useFonts as usePublicSans, PublicSans_400Regular, PublicSans_600SemiBold } from "@expo-google-fonts/public-sans";
import { ThemeProvider, useTheme } from "../src/context/ThemeContext";

try {
  void SplashScreen.preventAutoHideAsync();
} catch {
  // Web / environments without a native splash screen.
}

function registerServiceWorker() {
  if (Platform.OS !== "web") return;
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  const swUrl = "/service-worker.js";
  void navigator.serviceWorker.register(swUrl).catch(() => {
    // Offline support is progressive enhancement. A failed registration
    // must not break the app.
  });
}

function addPreconnect() {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL;
  const hosts = new Set<string>();
  try {
    if (apiBase) hosts.add(new URL(apiBase).origin);
  } catch {
    // Ignore malformed base URL.
  }
  hosts.add("https://fonts.gstatic.com");
  for (const href of hosts) {
    if (document.querySelector(`link[rel="preconnect"][href="${href}"]`)) continue;
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = href;
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
  }
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
  // Load only 3 weights up front. The old 5-weight set blocked paint on the
  // font files. System fonts render instantly and swap when these arrive.
  const [groteskLoaded] = useSpaceGrotesk({ SpaceGrotesk_700Bold });
  const [sansLoaded] = usePublicSans({ PublicSans_400Regular, PublicSans_600SemiBold });
  const fontsLoaded = groteskLoaded && sansLoaded;

  useEffect(() => {
    registerServiceWorker();
    addPreconnect();
    // Hide splash on mount, not on fonts. Fonts swap in when ready.
    const t = setTimeout(() => {
      try {
        void SplashScreen.hideAsync();
      } catch {
        // Already hidden or unsupported.
      }
    }, 300);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (fontsLoaded) {
      try {
        void SplashScreen.hideAsync();
      } catch {
        // Already hidden.
      }
    }
  }, [fontsLoaded]);

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ThemedShell />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

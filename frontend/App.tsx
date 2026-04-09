import { ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

const pillars = [
  {
    eyebrow: "Capture",
    title: "Voice or text, without losing intent",
    body: "Meridian is built around fast capture first, then structure. The first job is to preserve what the user meant before anything tries to optimize it.",
  },
  {
    eyebrow: "Plan",
    title: "Calendar-aware, never calendar-aggressive",
    body: "Scheduling suggestions should respect the user's real calendar and always stay user-approved. No silent writes. No fake certainty.",
  },
  {
    eyebrow: "Ship",
    title: "Backend-first foundation, mobile-first product",
    body: "The current repo has the first FastAPI task slice and database schema. This frontend is now the real Expo base to build on instead of a Bun placeholder.",
  },
];

export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.hero}>
            <Text style={styles.kicker}>Meridian</Text>
            <Text style={styles.title}>Turn spoken intent into scheduled action.</Text>
            <Text style={styles.subtitle}>
              Mobile-first planning for fast task capture, thoughtful scheduling, and the work
              that actually gets done.
            </Text>
          </View>

          <View style={styles.grid}>
            {pillars.map((pillar) => (
              <View key={pillar.eyebrow} style={styles.card}>
                <Text style={styles.cardEyebrow}>{pillar.eyebrow}</Text>
                <Text style={styles.cardTitle}>{pillar.title}</Text>
                <Text style={styles.cardBody}>{pillar.body}</Text>
              </View>
            ))}
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerLabel}>Current build checkpoint</Text>
            <Text style={styles.footerText}>
              Backend task CRUD and the first Supabase migration are already in the repo. Next up
              is wiring the frontend task flows to the real API surface.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F3EBDD",
  },
  container: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
    gap: 18,
  },
  hero: {
    backgroundColor: "#132A24",
    borderRadius: 28,
    paddingHorizontal: 22,
    paddingVertical: 26,
    shadowColor: "#132A24",
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  kicker: {
    color: "#DAB785",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  title: {
    color: "#FFF8EE",
    fontSize: 32,
    lineHeight: 38,
    fontWeight: "800",
    marginBottom: 12,
  },
  subtitle: {
    color: "#D9E3DC",
    fontSize: 16,
    lineHeight: 24,
  },
  grid: {
    gap: 14,
  },
  card: {
    backgroundColor: "#FFF9F0",
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 18,
    borderWidth: 1,
    borderColor: "#E5D6BF",
  },
  cardEyebrow: {
    color: "#B45A36",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  cardTitle: {
    color: "#1D2A2C",
    fontSize: 21,
    lineHeight: 27,
    fontWeight: "700",
    marginBottom: 10,
  },
  cardBody: {
    color: "#415255",
    fontSize: 15,
    lineHeight: 22,
  },
  footer: {
    borderRadius: 22,
    backgroundColor: "#DAB785",
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  footerLabel: {
    color: "#4B250E",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  footerText: {
    color: "#2E221A",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
  },
});

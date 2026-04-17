import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import {
  authRuntime,
  getCurrentSession,
  signInWithPassword,
  signOut,
  type AuthSession,
} from "./src/lib/auth";
import {
  createTask,
  deleteTask,
  describeTaskError,
  listTasks,
  tasksRuntime,
  type Task,
  updateTask,
} from "./src/lib/tasks";

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [authSession, setAuthSession] = useState<AuthSession | null>(() => getCurrentSession());
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeTaskAction, setActiveTaskAction] = useState<"complete" | "reopen" | "delete" | null>(
    null,
  );

  async function loadTasks() {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const nextTasks = await listTasks();
      setTasks(nextTasks);
    } catch (error) {
      setErrorMessage(describeTaskError(error));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (tasksRuntime.isApiMode && authSession === null) {
      setTasks([]);
      setIsLoading(false);
      return;
    }

    void loadTasks();
  }, [authSession]);

  function replaceTask(nextTask: Task) {
    setTasks((currentTasks) =>
      currentTasks.map((task) => (task.id === nextTask.id ? nextTask : task)),
    );
  }

  async function handleCreateTask() {
    if (!title.trim()) {
      setErrorMessage("Give the task a title before adding it.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const nextTask = await createTask({ title, notes });
      setTasks((currentTasks) => [nextTask, ...currentTasks]);
      setTitle("");
      setNotes("");
    } catch (error) {
      setErrorMessage(describeTaskError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignIn() {
    if (!authEmail.trim() || !authPassword) {
      setErrorMessage("Enter the email and password for your Supabase user.");
      return;
    }

    setIsSigningIn(true);
    setErrorMessage(null);

    try {
      const session = await signInWithPassword(authEmail, authPassword);
      setAuthSession(session);
      setAuthPassword("");
    } catch (error) {
      setErrorMessage(describeTaskError(error));
    } finally {
      setIsSigningIn(false);
    }
  }

  async function handleSignOut() {
    setIsSigningOut(true);
    setErrorMessage(null);

    try {
      await signOut();
      setAuthSession(null);
      setTasks([]);
    } catch (error) {
      setErrorMessage(describeTaskError(error));
    } finally {
      setIsSigningOut(false);
    }
  }

  async function handleToggleTaskStatus(task: Task) {
    const nextStatus = task.status === "completed" ? "inbox" : "completed";
    const nextAction = task.status === "completed" ? "reopen" : "complete";

    setActiveTaskId(task.id);
    setActiveTaskAction(nextAction);
    setErrorMessage(null);

    try {
      const nextTask = await updateTask(task.id, { status: nextStatus });
      replaceTask(nextTask);
    } catch (error) {
      setErrorMessage(describeTaskError(error));
    } finally {
      setActiveTaskId(null);
      setActiveTaskAction(null);
    }
  }

  async function handleDeleteTask(taskId: string) {
    setActiveTaskId(taskId);
    setActiveTaskAction("delete");
    setErrorMessage(null);

    try {
      await deleteTask(taskId);
      setTasks((currentTasks) => currentTasks.filter((task) => task.id !== taskId));
    } catch (error) {
      setErrorMessage(describeTaskError(error));
    } finally {
      setActiveTaskId(null);
      setActiveTaskAction(null);
    }
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.hero}>
            <Text style={styles.kicker}>Meridian</Text>
            <Text style={styles.title}>Capture a task, then give it somewhere real to go.</Text>
            <Text style={styles.subtitle}>
              This is the first live task flow. In demo mode it runs locally. In API mode it talks
              to the FastAPI backend with the temporary dev user header.
            </Text>
          </View>

          <View style={styles.modeCard}>
            <View>
              <Text style={styles.cardEyebrow}>
                {tasksRuntime.isApiMode ? "API mode" : "Demo mode"}
              </Text>
              <Text style={styles.modeTitle}>
                {tasksRuntime.isApiMode
                  ? authSession
                    ? "Frontend is calling the backend with a Supabase bearer token."
                    : "Sign in with your Supabase user to load live tasks."
                  : "Frontend is using local demo data until Supabase auth is configured."}
              </Text>
              <Text style={styles.modeBody}>Base URL: {tasksRuntime.apiBaseUrl}</Text>
              {tasksRuntime.isApiMode && authSession ? (
                <Text style={styles.modeBody}>
                  Signed in as {authSession.user.email ?? authSession.user.id}
                </Text>
              ) : null}
            </View>

            {tasksRuntime.isApiMode && authSession ? (
              <View style={styles.modeActions}>
                <Pressable style={styles.secondaryButton} onPress={() => void loadTasks()}>
                  <Text style={styles.secondaryButtonText}>Refresh</Text>
                </Pressable>

                <Pressable
                  style={[styles.secondaryButton, styles.signOutButton]}
                  onPress={() => void handleSignOut()}
                  disabled={isSigningOut}
                >
                  <Text style={[styles.secondaryButtonText, styles.signOutButtonText]}>
                    {isSigningOut ? "Signing out..." : "Sign out"}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <Pressable style={styles.secondaryButton} onPress={() => void loadTasks()}>
                <Text style={styles.secondaryButtonText}>
                  {tasksRuntime.isApiMode ? "Retry" : "Refresh"}
                </Text>
              </Pressable>
            )}
          </View>

          {tasksRuntime.isApiMode && authSession === null ? (
            <View style={styles.card}>
              <Text style={styles.cardEyebrow}>Sign in</Text>
              <Text style={styles.sectionTitle}>Use your Supabase user</Text>
              <Text style={styles.sectionBody}>
                Sign in with the local auth user you created in Supabase Studio so the task flow
                uses a real bearer token instead of the old dev header.
              </Text>

              <TextInput
                placeholder="Email"
                placeholderTextColor="#7D7A70"
                style={styles.input}
                value={authEmail}
                onChangeText={setAuthEmail}
                autoCapitalize="none"
                keyboardType="email-address"
              />
              <TextInput
                placeholder="Password"
                placeholderTextColor="#7D7A70"
                style={styles.input}
                value={authPassword}
                onChangeText={setAuthPassword}
                secureTextEntry
              />

              <Pressable
                style={[styles.primaryButton, isSigningIn ? styles.buttonDisabled : null]}
                onPress={() => void handleSignIn()}
                disabled={isSigningIn}
              >
                <Text style={styles.primaryButtonText}>
                  {isSigningIn ? "Signing in..." : "Sign in"}
                </Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.card}>
                <Text style={styles.cardEyebrow}>Create task</Text>
                <Text style={styles.sectionTitle}>Add something real</Text>
                <Text style={styles.sectionBody}>
                  Keep this first flow narrow: title, optional notes, then send it to the list.
                </Text>

                <TextInput
                  placeholder="Task title"
                  placeholderTextColor="#7D7A70"
                  style={styles.input}
                  value={title}
                  onChangeText={setTitle}
                />
                <TextInput
                  placeholder="Notes (optional)"
                  placeholderTextColor="#7D7A70"
                  style={[styles.input, styles.notesInput]}
                  value={notes}
                  onChangeText={setNotes}
                  multiline
                />

                <Pressable
                  style={[styles.primaryButton, isSubmitting ? styles.buttonDisabled : null]}
                  onPress={() => void handleCreateTask()}
                  disabled={isSubmitting}
                >
                  <Text style={styles.primaryButtonText}>
                    {isSubmitting ? "Adding task..." : "Add task"}
                  </Text>
                </Pressable>
              </View>

              {errorMessage ? (
                <View style={styles.errorCard}>
                  <Text style={styles.errorLabel}>Current issue</Text>
                  <Text style={styles.errorText}>{errorMessage}</Text>
                </View>
              ) : null}

              <View style={styles.card}>
                <Text style={styles.cardEyebrow}>Task list</Text>
                <Text style={styles.sectionTitle}>Inbox</Text>
                <Text style={styles.sectionBody}>
                  The UI is now wired for the first real backend-aligned entity in the product.
                </Text>

                {isLoading ? (
                  <View style={styles.loadingState}>
                    <ActivityIndicator size="small" color="#132A24" />
                    <Text style={styles.loadingText}>Loading tasks...</Text>
                  </View>
                ) : null}

                {!isLoading && tasks.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyTitle}>No tasks yet</Text>
                    <Text style={styles.emptyBody}>
                      Add a task above to seed the first real workflow in the app.
                    </Text>
                  </View>
                ) : null}

                {!isLoading ? (
                  <View style={styles.taskList}>
                    {tasks.map((task) => (
                      <View key={task.id} style={styles.taskCard}>
                        <View style={styles.taskHeader}>
                          <Text style={styles.taskTitle}>{task.title}</Text>
                          <View
                            style={[
                              styles.badge,
                              task.status === "completed" ? styles.completedBadge : null,
                            ]}
                          >
                            <Text style={styles.badgeText}>{task.status}</Text>
                          </View>
                        </View>

                        {task.notes ? <Text style={styles.taskNotes}>{task.notes}</Text> : null}

                        <View style={styles.metaRow}>
                          <Text style={styles.metaText}>Priority: {task.priority}</Text>
                          <Text style={styles.metaText}>
                            {task.estimated_duration_minutes
                              ? `${task.estimated_duration_minutes} min`
                              : "No estimate"}
                          </Text>
                        </View>

                        <View style={styles.taskActionsRow}>
                          <Pressable
                            style={[
                              styles.taskActionButton,
                              activeTaskId === task.id ? styles.buttonDisabled : null,
                            ]}
                            onPress={() => void handleToggleTaskStatus(task)}
                            disabled={activeTaskId === task.id}
                          >
                            <Text style={styles.taskActionButtonText}>
                              {activeTaskId === task.id && activeTaskAction === "complete"
                                ? "Completing..."
                                : activeTaskId === task.id && activeTaskAction === "reopen"
                                  ? "Reopening..."
                                  : task.status === "completed"
                                    ? "Reopen"
                                    : "Complete"}
                            </Text>
                          </Pressable>

                          <Pressable
                            style={[
                              styles.taskActionButton,
                              styles.deleteButton,
                              activeTaskId === task.id ? styles.buttonDisabled : null,
                            ]}
                            onPress={() => void handleDeleteTask(task.id)}
                            disabled={activeTaskId === task.id}
                          >
                            <Text style={[styles.taskActionButtonText, styles.deleteButtonText]}>
                              {activeTaskId === task.id && activeTaskAction === "delete"
                                ? "Deleting..."
                                : "Delete"}
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            </>
          )}

          {tasksRuntime.isApiMode && authSession === null && errorMessage ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorLabel}>Current issue</Text>
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}
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
  card: {
    backgroundColor: "#FFF9F0",
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 18,
    borderWidth: 1,
    borderColor: "#E5D6BF",
    gap: 12,
  },
  modeCard: {
    backgroundColor: "#FFF3D7",
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 18,
    borderWidth: 1,
    borderColor: "#E8C994",
    gap: 14,
  },
  modeActions: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  cardEyebrow: {
    color: "#B45A36",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  modeTitle: {
    color: "#1D2A2C",
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
  },
  modeBody: {
    color: "#4C4A43",
    fontSize: 14,
    lineHeight: 20,
  },
  sectionTitle: {
    color: "#1D2A2C",
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "700",
  },
  sectionBody: {
    color: "#415255",
    fontSize: 15,
    lineHeight: 22,
  },
  input: {
    backgroundColor: "#FFFDF8",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#DDCFB7",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#1D2A2C",
  },
  notesInput: {
    minHeight: 108,
    textAlignVertical: "top",
  },
  primaryButton: {
    backgroundColor: "#132A24",
    borderRadius: 16,
    alignItems: "center",
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: "#FFF8EE",
    fontSize: 15,
    fontWeight: "700",
  },
  secondaryButton: {
    alignSelf: "flex-start",
    backgroundColor: "#132A24",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryButtonText: {
    color: "#FFF8EE",
    fontSize: 13,
    fontWeight: "700",
  },
  signOutButton: {
    backgroundColor: "#F6DED3",
  },
  signOutButtonText: {
    color: "#7F2E14",
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  errorCard: {
    borderRadius: 20,
    backgroundColor: "#F9D4C7",
    borderWidth: 1,
    borderColor: "#E4A08B",
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 8,
  },
  errorLabel: {
    color: "#7F2E14",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  errorText: {
    color: "#602512",
    fontSize: 14,
    lineHeight: 20,
  },
  loadingState: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
  },
  loadingText: {
    color: "#415255",
    fontSize: 14,
  },
  emptyState: {
    borderRadius: 22,
    backgroundColor: "#F6EFE1",
    paddingHorizontal: 18,
    paddingVertical: 18,
    borderWidth: 1,
    borderColor: "#E2D8C3",
  },
  emptyTitle: {
    color: "#1D2A2C",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 6,
  },
  emptyBody: {
    color: "#5B615D",
    fontSize: 14,
    lineHeight: 20,
  },
  taskList: {
    gap: 12,
  },
  taskCard: {
    borderRadius: 18,
    backgroundColor: "#FFFDF8",
    borderWidth: 1,
    borderColor: "#E4D5BD",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  taskHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  taskTitle: {
    flex: 1,
    color: "#152325",
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
  },
  badge: {
    borderRadius: 999,
    backgroundColor: "#E4F0E7",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  completedBadge: {
    backgroundColor: "#D7E1EF",
  },
  badgeText: {
    color: "#204636",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  taskNotes: {
    color: "#5C6462",
    fontSize: 14,
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  metaText: {
    color: "#6A6258",
    fontSize: 12,
    fontWeight: "600",
  },
  taskActionsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  taskActionButton: {
    borderRadius: 999,
    backgroundColor: "#132A24",
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  taskActionButtonText: {
    color: "#FFF8EE",
    fontSize: 12,
    fontWeight: "700",
  },
  deleteButton: {
    backgroundColor: "#F6DED3",
  },
  deleteButtonText: {
    color: "#7F2E14",
  },
});

import { Suspense, lazy, memo, useCallback, useMemo, useState } from "react";
import { ActivityIndicator, StatusBar, Text, View } from "react-native";
import { Link } from "expo-router";
import { Reveal } from "../../src/components/ui/Reveal";
import { Card } from "../../src/components/ui/Card";
import { SectionHeader } from "../../src/components/ui/SectionHeader";
import { PageShell } from "../../src/components/ui/PageShell";
import { StatusBanner } from "../../src/components/ui/StatusBanner";
import { CreateTaskForm } from "../../src/components/CreateTaskForm";
import { Hero } from "../../src/components/Hero";
import { ModeStatus } from "../../src/components/ModeStatus";
import { AuthCard } from "../../src/components/AuthCard";
import { PendingRemindersCard } from "../../src/components/PendingRemindersCard";
import TaskCardEditor from "../../src/components/TaskCardEditor";
import { useAuth } from "../../src/hooks/useAuth";
import { useCalendarSync } from "../../src/hooks/useCalendarSync";
import { usePushNotifications } from "../../src/hooks/usePushNotifications";

import { tasksRuntime, type Task } from "../../src/lib/tasks";
import { useTaskMutations } from "../../src/hooks/useTaskMutations";
import { useTaskSync } from "../../src/hooks/useTaskSync";

const VoiceCaptureCard = lazy(() =>
  import("../../src/components/VoiceCaptureCard").then((m) => ({ default: m.VoiceCaptureCard })),
);

const DueNowStrip = memo(function DueNowStrip({ tasks, isLoading, renderCard }: { tasks: Task[]; isLoading: boolean; renderCard: (t: Task) => React.ReactNode }) {
  const due = useMemo(() => tasks.filter((t) => t.status === "due_now"), [tasks]);
  return (
    <Card variant="floating" className="gap-4">
      <SectionHeader eyebrow="Needs attention" title="Due now" body="The most urgent work, inline. Everything else lives in its tab." />
      {isLoading ? (
        <View className="gap-3" aria-busy>
          <View className="flex-row items-center gap-2 py-1">
            <ActivityIndicator size="small" color="#09261E" />
            <Text className="text-bodytext dark:text-nightmuted text-[14px]">Loading tasks...</Text>
          </View>
          <View className="rounded-2xl bg-cardsurf border border-borderfaint p-4 gap-2">
            <View className="h-4 rounded-full bg-borderfaint w-3/4" />
            <View className="h-3 rounded-full bg-borderfaint w-1/2" />
          </View>
        </View>
      ) : due.length === 0 ? (
        <View className="bg-sandbg dark:bg-nightcard rounded-2xl p-4 border border-sandborder dark:border-nightborder gap-1">
          <Text className="text-ink dark:text-nighttext font-bold">Nothing is due right now</Text>
          <Text className="text-sandtext dark:text-nightmuted text-[14px]">When scheduled work activates, it shows up here first.</Text>
        </View>
      ) : (
        <View className="gap-3">{due.map((t) => renderCard(t))}</View>
      )}
      <Link href="/(tabs)/due_now" className="min-h-[44px] justify-center text-[13px] font-bold text-primary">
        Open Due now tab →
      </Link>
    </Card>
  );
});

export default function HomeTab() {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { authSession, authEmail, setAuthEmail, authPassword, setAuthPassword, isSigningIn, isSigningOut, handleSignIn, handleSignOut } = useAuth(setErrorMessage);
  const { tasks, setTasks, isLoading, dueNotice, remindersByTask, pendingReminders, dispatchNotice, setPendingReminders, loadTasks, refreshRemindersForTask, replaceTask } = useTaskSync(authSession, setErrorMessage);
  const [calendarNotice, setCalendarNotice] = useState<string | null>(null);
  const { calendarStatus, isSyncing, isConnecting, handleSyncCalendar, handleConnectCalendar } = useCalendarSync(authSession, setErrorMessage, setCalendarNotice);
  const { state: pushState, message: pushMessage, isBusy: isPushBusy, enable: enablePush, disable: disablePush } = usePushNotifications();
  const {
    activeTaskId, activeTaskAction, scheduleEditorTaskId, scheduleEditorValue, setScheduleEditorValue,
    taskEditorTaskId, taskEditorTitle, taskEditorNotes, taskEditorPriority, taskEditorDuration,
    setTaskEditorTitle, setTaskEditorNotes, setTaskEditorPriority, setTaskEditorDuration,
    suggestionsByTask, handleToggleTaskStatus, handleDeleteTask, handleOpenTaskEditor, closeTaskEditor,
    handleSaveTaskDetails, handleOpenScheduleEditor, closeScheduleEditor, handleSaveSchedule, handleUnscheduleTask,
    handleSuggestBlocks, handleApplySuggestion,
  } = useTaskMutations({
    replaceTask,
    removeTask: useCallback((id: string) => setTasks((prev) => prev.filter((x) => x.id !== id)), [setTasks]),
    refreshReminders: useCallback((id: string) => void refreshRemindersForTask(id), [refreshRemindersForTask]),
    notify: setErrorMessage,
    calendarStatus,
    activeFilter: "all",
    onFilterChange: useCallback(() => {}, []),
  });

  const handleSignOutAndClear = useCallback(async () => {
    await handleSignOut();
    setTasks([]);
    setCalendarNotice(null);
  }, [handleSignOut, setTasks]);

  const renderTaskCard = useCallback((task: Task) => {
    const reminders = remindersByTask[task.id];
    const suggestions = suggestionsByTask[task.id] ?? [];
    const isActive = activeTaskId === task.id;
    return (
      <TaskCardEditor
        key={task.id}
        task={task}
        isBusy={isActive}
        activeAction={isActive ? activeTaskAction : null}
        isEditingSchedule={scheduleEditorTaskId === task.id}
        isEditingTask={taskEditorTaskId === task.id}
        scheduleEditorValue={scheduleEditorValue}
        taskEditorTitle={taskEditorTitle}
        taskEditorNotes={taskEditorNotes}
        taskEditorPriority={taskEditorPriority}
        taskEditorDuration={taskEditorDuration}
        suggestions={suggestions}
        reminders={reminders}
        callbacks={{
          onOpenTaskEditor: () => handleOpenTaskEditor(task),
          onCloseTaskEditor: closeTaskEditor,
          onSaveTaskDetails: () => void handleSaveTaskDetails(task),
          onOpenScheduleEditor: () => handleOpenScheduleEditor(task),
          onCloseScheduleEditor: closeScheduleEditor,
          onSaveSchedule: () => void handleSaveSchedule(task),
          onUnschedule: () => void handleUnscheduleTask(task),
          onToggleStatus: () => void handleToggleTaskStatus(task),
          onDelete: () => void handleDeleteTask(task.id),
          onSuggest: () => void handleSuggestBlocks(task),
          onApplySuggestion: (block) => void handleApplySuggestion(task, block),
          setScheduleEditorValue,
          setTaskEditorTitle,
          setTaskEditorNotes,
          setTaskEditorPriority,
          setTaskEditorDuration,
        }}
      />
    );
  }, [remindersByTask, suggestionsByTask, activeTaskId, activeTaskAction, scheduleEditorTaskId, taskEditorTaskId, scheduleEditorValue, taskEditorTitle, taskEditorNotes, taskEditorPriority, taskEditorDuration, handleOpenTaskEditor, closeTaskEditor, handleSaveTaskDetails, handleOpenScheduleEditor, closeScheduleEditor, handleSaveSchedule, handleUnscheduleTask, handleToggleTaskStatus, handleDeleteTask, handleSuggestBlocks, handleApplySuggestion, setScheduleEditorValue, setTaskEditorTitle, setTaskEditorNotes, setTaskEditorPriority, setTaskEditorDuration]);

  const showAuth = tasksRuntime.isApiMode && authSession === null;

  return (
    <>
      <StatusBar barStyle="dark-content" />
      <PageShell>
          <Reveal once="home-hero">
            <Hero />
          </Reveal>
          <ModeStatus
            authSession={authSession}
            calendarStatus={calendarStatus}
            isSyncing={isSyncing}
            isConnecting={isConnecting}
            pushState={pushState}
            pushMessage={pushMessage}
            isPushBusy={isPushBusy}
            onEnablePush={() => void enablePush()}
            onDisablePush={() => void disablePush()}
            isSigningOut={isSigningOut}
            onRefresh={() => void loadTasks()}
            onSync={() => void handleSyncCalendar()}
            onConnect={() => void handleConnectCalendar()}
            onSignOut={() => void handleSignOutAndClear()}
          />

          {showAuth ? (
            <AuthCard
              authEmail={authEmail}
              setAuthEmail={setAuthEmail}
              authPassword={authPassword}
              setAuthPassword={setAuthPassword}
              isSigningIn={isSigningIn}
              onSignIn={() => void handleSignIn()}
            />

          ) : (
            <>
              <CreateTaskForm />
              <Suspense fallback={null}>
                <VoiceCaptureCard />
              </Suspense>

              {errorMessage ? <StatusBanner variant="error" title="Current issue" message={errorMessage} /> : null}

              {dueNotice ? <StatusBanner variant="success" title="Due now" message={dueNotice} /> : null}

              {dispatchNotice ? <StatusBanner variant="success" title="Tasks" message={dispatchNotice} /> : null}

              {calendarNotice ? (
                <StatusBanner
                  variant={calendarNotice.startsWith("Calendar synced") ? "success" : "info"}
                  title="Calendar"
                  message={calendarNotice}
                />
              ) : null}

              <PendingRemindersCard pending={pendingReminders} onAcked={(id) => setPendingReminders((prev) => prev.filter((x) => x.id !== id))} onError={(m) => setErrorMessage(m)} />

              <Reveal once="home-due-now">
                <DueNowStrip
                  tasks={tasks}
                  isLoading={isLoading}
                  renderCard={renderTaskCard}
                />
              </Reveal>
            </>
          )}

          {showAuth && errorMessage ? <StatusBanner variant="error" title="Current issue" message={errorMessage} /> : null}
        </PageShell>
    </>
  );
}

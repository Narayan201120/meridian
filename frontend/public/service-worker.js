/* Meridian service worker: receives Web Push and shows a notification.
 *
 * Kept deliberately small. The app polls for reminders while open, so this only
 * has to handle the case where the tab is closed, which is the whole point of
 * push: a reminder that only exists while you happen to be looking at the app is
 * not a reminder.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Meridian", body: event.data ? event.data.text() : "You have a reminder." };
  }

  const title = payload.title || "Meridian";
  const options = {
    body: payload.body || "",
    tag: payload.reminder_id || "meridian-reminder",
    data: {
      reminderId: payload.reminder_id || null,
      taskId: payload.task_id || null,
    },
    icon: "/favicon.ico",
    badge: "/favicon.ico",
  };

  // showNotification is the promise-based form so we can catch a failure rather
  // than leaving the push silently dropped.
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const taskId = (event.notification.data && event.notification.data.taskId) || null;
  const target = taskId ? `/?task=${taskId}` : "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
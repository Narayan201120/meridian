/* Meridian service worker: Web Push plus offline caching.
 *
 * Push handles the closed-tab case, the whole point of reminders. The fetch
 * handler keeps the shell usable on weak connections: app shell cache-first,
 * API network-first with a short timeout, fonts and images stale-while-revalidate.
 */

const SHELL_CACHE = "meridian-shell-v1";
const RUNTIME_CACHE = "meridian-runtime-v1";
const SHELL_URLS = ["/", "/index.html", "/favicon.ico", "/assets/icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS).catch(() => undefined)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    // Cross-origin fonts and images: serve stale, refresh in background.
    if (request.destination === "font" || request.destination === "image") {
      event.respondWith(
        caches.open(RUNTIME_CACHE).then(async (cache) => {
          const cached = await cache.match(request);
          const network = fetch(request).then((res) => {
            if (res.ok) void cache.put(request, res.clone());
            return res;
          }).catch(() => cached);
          return cached || network;
        }),
      );
    }
    return;
  }

  // API: network first, fall back to cache, then fail fast.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          void caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
        }
        return res;
      }).catch(() => caches.open(RUNTIME_CACHE).then((cache) => cache.match(request))),
    );
    return;
  }

  // App shell and static assets: cache first.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        void fetch(request).then((res) => {
          if (res.ok) void caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, res));
        }).catch(() => undefined);
        return cached;
      }
      return fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          void caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
        }
        return res;
      }).catch(() => caches.open(SHELL_CACHE).then((cache) => cache.match("/index.html")));
    }),
  );
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

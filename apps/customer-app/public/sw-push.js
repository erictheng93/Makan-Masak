self.addEventListener("push", (event) => {
  const payload = parsePushPayload(event);
  const title = payload.title || "MakanMasak";
  const url = payload.url || "/";

  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "您有新的通知。",
      icon: "/pwa-192x192.png",
      badge: "/badge-72x72.png",
      tag: payload.tag || payload.type || "makanmakan-notification",
      data: {
        ...payload,
        url,
      },
      requireInteraction: payload.type === "waiting_called",
      actions:
        payload.type === "waiting_called"
          ? [{ action: "view_ticket", title: "查看候位" }]
          : [],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const targetUrl = new URL(url, self.location.origin).href;
        const sameOriginClient = clients.find((client) =>
          client.url.startsWith(self.location.origin),
        );

        if (sameOriginClient) {
          return sameOriginClient.focus().then((client) => {
            if ("navigate" in client) {
              return client.navigate(targetUrl);
            }
            return client;
          });
        }

        return self.clients.openWindow(targetUrl);
      }),
  );
});

function parsePushPayload(event) {
  if (!event.data) {
    return {};
  }

  try {
    return event.data.json();
  } catch {
    return {
      body: event.data.text(),
    };
  }
}

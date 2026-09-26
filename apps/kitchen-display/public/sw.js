self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  const payload = parsePushPayload(event);
  const title = payload.title || "廚房新通知";
  const data = normalizeNotificationData(payload);

  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "廚房有新的訂單更新。",
      icon: payload.icon || "/icons/kitchen-icon-192.png",
      badge: payload.badge || "/icons/kitchen-badge-72.png",
      tag: payload.tag || notificationTag(data),
      data,
      requireInteraction: shouldRequireInteraction(payload, data),
      actions: notificationActions(data),
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(
    event.notification.data?.url || "/",
    self.location.origin,
  ).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
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
  if (!event.data) return {};

  try {
    return event.data.json();
  } catch {
    return {
      body: event.data.text(),
    };
  }
}

function normalizeNotificationData(payload) {
  const rawData =
    payload.data && typeof payload.data === "object" ? payload.data : {};
  const restaurantId =
    payload.restaurantId ||
    payload.restaurant_id ||
    rawData.restaurantId ||
    rawData.restaurant_id;
  const orderId =
    payload.orderId || payload.order_id || rawData.orderId || rawData.order_id;
  const orderSource =
    payload.orderSource ||
    payload.order_source ||
    rawData.orderSource ||
    rawData.order_source;
  const url = payload.url || buildKitchenOrderUrl({ restaurantId, orderId });

  return {
    ...rawData,
    ...payload,
    restaurantId,
    orderId,
    orderSource,
    url,
  };
}

function buildKitchenOrderUrl(input) {
  if (!input.restaurantId) return "/";

  const params = new URLSearchParams();
  if (input.orderId) {
    params.set("orderId", String(input.orderId));
  }

  const suffix = params.toString();
  return `/kitchen/${encodeURIComponent(input.restaurantId)}${
    suffix ? `?${suffix}` : ""
  }`;
}

function notificationTag(data) {
  if (data.orderId) return `kitchen-order-${data.orderId}`;
  return data.type || "kitchen-notification";
}

function shouldRequireInteraction(payload, data) {
  return Boolean(
    payload.requireInteraction ||
    payload.priority === "high" ||
    payload.priority === "urgent" ||
    data.orderSource === "market_checkout",
  );
}

function notificationActions(data) {
  if (!data.orderId) return [];

  return [
    {
      action: "view_order",
      title: "查看訂單",
    },
  ];
}

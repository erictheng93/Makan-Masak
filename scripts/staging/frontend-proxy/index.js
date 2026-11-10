// Serves the staging Pages apps from *-staging.makanmasak.com so they share a
// site with api-staging.makanmasak.com. The API's CSRF and refresh cookies are
// SameSite=Lax; from *.pages.dev to *.workers.dev the browser never sends them,
// so every staging write failed CSRF_TOKEN_INVALID. Pages custom domains would
// do this without a Worker but need a DNS write the deploy token lacks.
const ORIGINS = {
  "admin-staging.makanmasak.com": "makanmasak-admin-staging.pages.dev",
  "kitchen-staging.makanmasak.com": "makanmasak-kitchen-staging.pages.dev",
  "customer-staging.makanmasak.com": "makanmasak-customer-staging.pages.dev",
};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = ORIGINS[url.hostname];
    if (!origin) return new Response("Not found", { status: 404 });
    url.hostname = origin;
    return fetch(new Request(url, request));
  },
};

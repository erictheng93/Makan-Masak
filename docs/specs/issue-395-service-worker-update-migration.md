# Service-worker update migration (#395)

The customer app explicitly registers the Vite PWA worker and reloads the
document when an updated worker takes control. The worker also navigates its
controlled window clients for the one-time migration from the old registration.
It records a marker in its own migration cache before doing so. Together these
make a returning diner run the current deployed bundle
during the same visit once the update check finishes, including the first
migration from the old injected registration script. Later updates use only
the client registration listener, so they cause one reload.

There is one browser lifecycle limit: a client controlled by the pre-#395
worker cannot run this registration code until it has first navigated and
received the new HTML. The replacement worker's activation handler reloads
that old client once the update has been discovered. The fix still cannot
retroactively change an already installed worker before its next navigation,
and an old `/sw.js` HTTP cache entry can delay that discovery for up to its
previous four-hour lifetime. Serving `/sw.js` with `Cache-Control: no-cache`
prevents an additional delay on later checks.

The migration also deletes the old `api-cache` during worker activation. The
customer service worker no longer runtime-caches any API response. Public API
responses remain eligible for the API's server-side cache; all client API
reads, including orders and tracking, bypass Cache Storage.

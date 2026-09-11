import restaurantRoutes from "./routes/restaurant";
import marketRoutes from "./routes/market";

export { default as restaurantRoutes } from "./routes/restaurant";
export { default as marketRoutes } from "./routes/market";
export { BroadcastService } from "./services/BroadcastService";
export * from "./schemas/validation";
export * from "./types";

/**
 * Broadcasts hang off two different resources — a restaurant and a market —
 * so the feature ships two routers that app-factory merges into the existing
 * `/restaurants` and `/markets` prefixes, the way reviews does (#286).
 */
export default {
  get restaurantRoutes() {
    return restaurantRoutes;
  },
  get marketRoutes() {
    return marketRoutes;
  },
};

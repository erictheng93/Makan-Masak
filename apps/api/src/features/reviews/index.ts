import orderRoutes from "./routes/order-reviews";

export { default as orderRoutes } from "./routes/order-reviews";
export { ReviewService } from "./services/ReviewService";
export * from "./schemas/validation";
export * from "./types";

/**
 * Reviews hang off whichever resource the audience is looking at. The diner
 * reviews an *order*, so this router mounts under /orders — see app-factory.ts.
 */
export default {
  get orderRoutes() {
    return orderRoutes;
  },
};

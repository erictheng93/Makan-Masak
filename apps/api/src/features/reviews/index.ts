import routes from "./routes";
import orderRoutes from "./routes/order-reviews";
import publicRoutes from "./routes/public";

export { default as routes } from "./routes";
export { default as orderRoutes } from "./routes/order-reviews";
export { default as publicRoutes } from "./routes/public";
export { ReviewService } from "./services/ReviewService";
export * from "./schemas/validation";
export * from "./types";

/**
 * Reviews span three mounts, because the resource they hang off differs by
 * audience: a diner reviews an *order*, an owner works through a
 * *restaurant's* reviews, and the public list belongs to the *restaurant*
 * page. One feature module, three routers — see app-factory.ts.
 */
export default {
  get routes() {
    return routes;
  },
  get orderRoutes() {
    return orderRoutes;
  },
  get publicRoutes() {
    return publicRoutes;
  },
};

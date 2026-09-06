import routes from "./routes";

export { default as routes } from "./routes";
export * from "./schemas/validation";
export * from "./types";

export default {
  get routes() {
    return routes;
  },
};

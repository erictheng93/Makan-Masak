import routes from "./routes";

export { default as routes } from "./routes";
export { PnlService } from "./services/PnlService";

export default {
  get routes() {
    return routes;
  },
};

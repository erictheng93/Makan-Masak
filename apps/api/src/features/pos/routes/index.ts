/**
 * POS路由模組入口
 */

import { Hono } from "hono";
import promotionsRouter from "./promotions";
import registersRouter from "./registers";
import printAgentsRouter from "./print-agents";
import shiftsRouter from "./shifts";
import cashMovementsRouter from "./cash-movements";
import receiptsRouter from "./receipts";
import refundsRouter from "./refunds";
import reportsRouter from "./reports";
import marketCheckoutsRouter from "./market-checkouts";
import type { Env } from "../../../types/env";

const app = new Hono<{ Bindings: Env }>();

// 掛載子路由
app.route("/promotions", promotionsRouter);
app.route("/registers", registersRouter);
app.route("/print-agents", printAgentsRouter);
app.route("/shifts", shiftsRouter);
app.route("/", cashMovementsRouter); // cash-movements 路由包含在根路徑下
app.route("/receipts", receiptsRouter);
app.route("/refunds", refundsRouter);
app.route("/reports", reportsRouter);
app.route("/", marketCheckoutsRouter);

export default app;

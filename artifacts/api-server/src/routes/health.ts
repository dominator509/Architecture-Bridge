import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/healthz", async (_req, res) => {
  let dbStatus: "ok" | "error" = "ok";
  try {
    await db.execute(sql`SELECT 1`);
  } catch (err) {
    logger.error({ err }, "Health check DB ping failed");
    dbStatus = "error";
  }

  const status = dbStatus === "ok" ? "ok" : "degraded";
  const httpStatus = dbStatus === "ok" ? 200 : 503;

  res.status(httpStatus).json({
    status,
    db: dbStatus,
    version: process.env["npm_package_version"] ?? "0.0.0",
    uptime: Math.floor(process.uptime()),
  });
});

export default router;

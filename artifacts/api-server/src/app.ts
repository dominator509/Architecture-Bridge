import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// ── Rate limiting ──────────────────────────────────────────────────────────────
// 500 requests per 15 minutes per IP. Applies to all routes.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 500,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: "Too many requests, please try again later.",
    code: "RATE_LIMITED",
  },
  skip: () => process.env["NODE_ENV"] === "test",
});
app.use(limiter);

app.use("/api", router);

// ── Global error handler ───────────────────────────────────────────────────────
// Must have 4 parameters — Express identifies error handlers by arity.
// Catches unhandled synchronous throws and errors passed to next(err).
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "Unhandled error");

  // Zod validation errors surfaced via throw (not safeParse)
  if (err.name === "ZodError") {
    res.status(400).json({
      error: "Validation failed",
      code: "VALIDATION_ERROR",
      details: (err as any).flatten?.(),
    });
    return;
  }

  // Known HTTP status errors (e.g. from Express 5)
  const status: number = (err as any).status ?? (err as any).statusCode ?? 500;
  const isDev = process.env["NODE_ENV"] !== "production";

  res.status(status).json({
    error: isDev ? err.message : "Internal server error",
    code: "INTERNAL_ERROR",
  });
});

export default app;

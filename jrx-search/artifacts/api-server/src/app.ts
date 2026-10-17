import path from "node:path";
import { existsSync } from "node:fs";
import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import authRouter, { authGuard } from "./routes/auth";
import mcpRouter from "./routes/mcp";
import specRouter from "./routes/spec";
import { logger } from "./lib/logger";
import { errorHandler, notFoundHandler } from "./middlewares/error";
import { usageLogger } from "./middlewares/usage";

const app: Express = express();

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
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use("/api", usageLogger);
app.use("/api", authRouter);
// MCP has its own bearer-token auth (MCP clients can't hold session cookies),
// so it mounts before the cookie-session authGuard.
app.use("/api", mcpRouter);
// The OpenAPI spec is a public, read-only document (no secrets); serve it
// before the cookie-session authGuard so docs/tooling can fetch it without a
// session. The endpoints described within still require auth.
app.use("/api", specRouter);
app.use("/api", authGuard);
app.use("/api", router);

const staticDir = process.env.STATIC_DIR;
if (staticDir && existsSync(staticDir)) {
  app.use(express.static(staticDir));
  app.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
  logger.info({ staticDir }, "Serving dashboard static files");
}

app.use(notFoundHandler);
app.use(errorHandler);

export default app;

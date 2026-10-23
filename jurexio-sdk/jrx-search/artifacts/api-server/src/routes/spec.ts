import { Router, type IRouter } from "express";
import { getOpenApiSpec } from "../lib/openapiSpec";

const router: IRouter = Router();

router.get("/openapi.json", (_req, res) => {
  const spec = getOpenApiSpec();
  if (!spec) {
    res.status(404).json({ error: "OpenAPI spec is not available on this server." });
    return;
  }
  res.json(spec);
});

export default router;

import { Router, type IRouter } from "express";
import healthRouter from "./health";
import catalogRouter from "./catalog";
import runsRouter from "./runs";
import dashboardRouter from "./dashboard";
import caselawRouter from "./caselaw";
import chatRouter from "./chat";
import statutesRouter from "./statutes";
import retrievalRouter from "./retrieval";
import templatesRouter from "./templates";
import analyticsRouter from "./analytics";
import athenaRouter from "./athena";
import patraMitraRouter from "./patra-mitra";
import cnrRouter from "./cnr";

const router: IRouter = Router();

router.use(healthRouter);
router.use(catalogRouter);
router.use(runsRouter);
router.use(dashboardRouter);
router.use(caselawRouter);
router.use(chatRouter);
router.use(statutesRouter);
router.use(retrievalRouter);
router.use(templatesRouter);
router.use(analyticsRouter);
router.use(athenaRouter);
router.use(patraMitraRouter);
router.use(cnrRouter);

export default router;

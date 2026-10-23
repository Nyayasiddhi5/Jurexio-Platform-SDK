import { Router } from 'express';
export class AdvancedOrchestrationRoutes {
  router: Router = Router();
  mount(app: any): void {
    app.use('/api/jrx/orchestration', this.router);
  }
}

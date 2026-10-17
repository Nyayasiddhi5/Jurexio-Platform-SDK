import { Router } from 'express';
export class ComprehensivePlatformRoutes {
  router: Router = Router();
  mount(app: any): void {
    app.use('/api/jrx/platform', this.router);
  }
}

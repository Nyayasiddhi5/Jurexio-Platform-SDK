import { Router } from 'express';
export class EnterpriseRoutes {
  router: Router = Router();
  mount(app: any): void {
    app.use('/api/jrx/enterprise', this.router);
  }
}

import type { Router } from 'express';
export class RouteRegistry {
  private routes: Map<string, Router> = new Map();
  register(name: string, router: Router): void {
    this.routes.set(name, router);
  }
  get(name: string): Router | undefined {
    return this.routes.get(name);
  }
}

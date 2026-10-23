interface Dashboard {
  id: string;
  title: string;
  widgets: Array<{ id: string; type: string; data: any; position: { x: number; y: number; w: number; h: number } }>;
  createdAt: string;
}

class VisualAnalyticsDashboardService {
  private dashboards: Map<string, Dashboard> = new Map();

  async createDashboard(input: { title: string; description?: string; layout?: string }): Promise<Dashboard> {
    const id = `dash-${Date.now()}`;
    const dashboard: Dashboard = {
      id,
      title: input.title,
      widgets: [],
      createdAt: new Date().toISOString(),
    };
    this.dashboards.set(id, dashboard);
    return dashboard;
  }

  async addWidget(dashboardId: string, widget: { type: string; data: any; position?: any }): Promise<Dashboard | null> {
    const dash = this.dashboards.get(dashboardId);
    if (!dash) return null;
    dash.widgets.push({
      id: `widget-${dash.widgets.length + 1}`,
      type: widget.type,
      data: widget.data,
      position: widget.position || { x: 0, y: 0, w: 4, h: 3 },
    });
    return dash;
  }

  async getDashboard(dashboardId: string): Promise<Dashboard | null> {
    return this.dashboards.get(dashboardId) || null;
  }

  async exportDashboard(dashboardId: string, format: string): Promise<{ content: string; mimeType: string }> {
    const dash = this.dashboards.get(dashboardId);
    return { content: JSON.stringify(dash || {}), mimeType: 'application/json' };
  }

  getStats(): { dashboardCount: number; widgetCount: number } {
    let widgetCount = 0;
    this.dashboards.forEach(d => { widgetCount += d.widgets.length; });
    return { dashboardCount: this.dashboards.size, widgetCount };
  }
}

export const visualAnalyticsDashboardService = new VisualAnalyticsDashboardService();

// Database dependency
const db: any = { select: () => ({ from: () => Promise.resolve([]) }) };
// External schema dependency
type AnalyticsEvent = any;
type InsertAnalyticsEvent = any;
const analyticsEvents: any = {};

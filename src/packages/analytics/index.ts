/**
 * Jurexio Enterprise Platform SDK v5.0.0 Analytics Package
 *
 * Advanced analytics services including:
 * - Token cost prediction and optimization
 * - Predictive analytics engine
 * - Cost optimization algorithms
 * - Advanced analytics dashboards
 */

export * from './advanced-analytics.js';
export * from './analytics-service.js';
export * from './cost-optimization-engine.js';
export * from './cost-optimization-wiring-service.js';
export { PredictiveAnalyticsEngine } from './predictive-analytics-engine.js';
export type { PredictiveAnalyticsConfig } from './predictive-analytics-engine.js';
export * from './token-cost-prediction-service.js';

export const analyticsPackageInfo = {
  name: 'jurexio-sdk-analytics',
  version: '3.1.0',
  services: [
    'advanced-analytics',
    'analytics-service',
    'cost-optimization-engine',
    'cost-optimization-wiring-service',
    'predictive-analytics-engine',
    'token-cost-prediction-service'
  ],
  capabilities: [
    'Token Cost Prediction',
    'Cost Optimization',
    'Predictive Analytics',
    'Usage Analytics',
    'Performance Metrics',
    'Budget Management'
  ]
};

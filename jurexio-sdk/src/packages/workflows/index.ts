/**
 * Jurexio Enterprise Platform SDK Workflows Package — public surface.
 *
 * Only the actively-wired workflow scheduler is re-exported. The continuous /
 * autonomous execution engines are experimental and consumers must import them
 * directly if needed.
 */
export * from './workflow-scheduler-service.js';

export const NYAYAVIGYA_WORKFLOWS_VERSION = '3.1.0';

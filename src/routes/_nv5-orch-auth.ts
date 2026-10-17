/**
 * Auth shim for /api/nv5/orch/* sub-routers (Session-10 Batch A).
 */
export { sdkGatewayAuth as requireSdkKey } from '../middleware/sdk-gateway.js';
export { safeError } from '../utils/jrx-api-error.js';

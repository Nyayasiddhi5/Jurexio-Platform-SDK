/**
 * API Versioning Middleware
 * 
 * Handles API version detection, validation, and deprecation warnings.
 * Supports X-API-Version header and api_version query parameter.
 */

import { Request, Response, NextFunction } from 'express';
import { getSunsetDate, isDeprecatedVersion, isSupportedVersion } from '../config/api-versions.js';
import { createLogger } from '../utils/logger.js';


const logger = createLogger('api-versioning');

/**
 * Extended Request type with apiVersion property
 */
export interface VersionedRequest extends Request {
  apiVersion?: string;
  platform?: string;
}

/**
 * Middleware: Detect and validate API version
 * 
 * Reads version from:
 * 1. X-API-Version header (highest priority)
 * 2. api_version query parameter
 * 3. Default to 'v1'
 * 
 * Attaches version to req.apiVersion and sets response header
 * 
 * @example
 * app.use(apiVersion);
 * // Now req.apiVersion will contain the detected version
 */
export function apiVersion(req: VersionedRequest, res: Response, next: NextFunction): void {
  // Try to get version from header first
  let version = req.get('X-API-Version');
  
  // Fall back to query parameter
  if (!version) {
    version = (req.query.api_version as string) || undefined;
  }
  
  // Default to v1
  if (!version) {
    version = 'v1';
  }
  
  // Normalize version format (e.g., "v1" stays "v1", "1" becomes "v1")
  if (!version.startsWith('v')) {
    version = `v${version}`;
  }
  
  // Attach to request object
  req.apiVersion = version;
  
  // Set response header
  res.setHeader('X-API-Version', version);
  
  next();
}

/**
 * Middleware Factory: Create deprecation warning middleware
 * 
 * Adds deprecation headers to response for deprecated API versions.
 * Sets Deprecation, Sunset, and Link headers per RFC 8594.
 * 
 * @param platform - Platform code (e.g., 'ni', 'nmin', 'nacad')
 * @param alternatives - Optional message about alternative endpoints
 * 
 * @example
 * app.use('/api/ni', deprecationWarning('ni', 'Use /api/ni/v1/* instead'));
 * 
 * @returns Middleware function
 */
export function deprecationWarning(
  platform: string,
  alternatives?: string
) {
  return (req: VersionedRequest, res: Response, next: NextFunction): void => {
    const version = req.apiVersion || 'v1';
    
    // Check if version is deprecated
    if (isDeprecatedVersion(platform, version)) {
      // Set Deprecation header (RFC 8594)
      res.setHeader('Deprecation', 'true');
      
      // Set Sunset header with date when API will be removed
      const sunsetDate = getSunsetDate(platform, version);
      if (sunsetDate) {
        // Convert to HTTP-date format (RFC 7231)
        const sunsetDateTime = new Date(sunsetDate).toUTCString();
        res.setHeader('Sunset', sunsetDateTime);
      }
      
      // Set Link header with alternative endpoint
      if (alternatives) {
        res.setHeader('Link', `<${alternatives}>; rel="successor-version"`);
      }
      
      // Log deprecation warning
      logger.warn(
        `[API Deprecation] Platform: ${platform}, Version: ${version}, ` +
        `Path: ${req.path}, Sunset: ${sunsetDate || 'TBD'}`
      );
    }
    
    next();
  };
}

/**
 * Middleware Factory: Validate API version support
 * 
 * Rejects requests with unsupported API versions.
 * Returns 400 Bad Request with helpful error message.
 * 
 * @param platform - Platform code (e.g., 'ni', 'nmin', 'nacad')
 * 
 * @example
 * app.use('/api/ni', validateVersion('ni'));
 * 
 * @returns Middleware function
 */
export function validateVersion(platform: string) {
  return (req: VersionedRequest, res: Response, next: NextFunction): void => {
    const version = req.apiVersion || 'v1';
    
    // Check if version is supported
    if (!isSupportedVersion(platform, version)) {
      res.status(400).json({
        success: false,
        error: `API version ${version} is not supported for platform ${platform}`,
        supportedVersions: getSupportedVersions(platform),
        hint: `Use X-API-Version header or ?api_version=${getSupportedVersions(platform)[0]} query parameter`
      });
      return;
    }
    
    // Attach platform to request
    req.platform = platform;
    
    next();
  };
}

/**
 * Middleware: Log API version information
 * 
 * Logs version information for monitoring and debugging.
 * 
 * @example
 * app.use(logVersionInfo);
 */
export function logVersionInfo(req: VersionedRequest, res: Response, next: NextFunction): void {
  const version = req.apiVersion || 'v1';
  const platform = req.platform || 'unknown';
  
  // Add version info to response locals for logging
  res.locals = res.locals || {};
  res.locals.apiVersion = version;
  res.locals.platform = platform;
  
  next();
}

/**
 * Helper: Get supported versions for a platform
 */
export function getSupportedVersions(platform: string): string[] {
  const config = require('../config/api-versions.js');
  const platformKey = platform.toLowerCase();
  return config.API_VERSIONS[platformKey]?.supported || ['v1'];
}

/**
 * Helper: Get current version for a platform
 */
export function getCurrentVersion(platform: string): string {
  const config = require('../config/api-versions.js');
  const platformKey = platform.toLowerCase();
  return config.API_VERSIONS[platformKey]?.current || 'v1';
}

/**
 * Middleware Composition: Complete versioning setup
 * 
 * Combines all version-related middleware in correct order:
 * 1. Detect version
 * 2. Validate version (optional)
 * 3. Add deprecation warnings (optional)
 * 4. Log version info
 * 
 * @example
 * app.use('/api/ni', setupVersioning('ni', true, '/api/ni/v1'));
 * 
 * @param platform - Platform code
 * @param validateRequired - Whether to validate version is supported
 * @param currentAlternative - URL of current version endpoint (for deprecation)
 * 
 * @returns Array of middleware functions
 */
export function setupVersioning(
  platform: string,
  validateRequired: boolean = true,
  currentAlternative?: string
) {
  const middleware = [
    apiVersion,
    deprecationWarning(platform, currentAlternative),
    logVersionInfo
  ];
  
  if (validateRequired) {
    // Insert validation after detection but before warnings
    middleware.splice(1, 0, validateVersion(platform));
  }
  
  return middleware;
}

/**
 * Response interceptor: Add version info to JSON responses
 * 
 * Automatically adds apiVersion to JSON response bodies.
 * Useful for client-side version detection.
 * 
 * @example
 * app.use(apiVersionResponseInterceptor);
 */
export function apiVersionResponseInterceptor(
  req: VersionedRequest,
  res: Response,
  next: NextFunction
): void {
  // Store original json method
  const originalJson = res.json.bind(res);
  
  // Override json method
  res.json = function(data: any) {
    // If data is an object and not null, add apiVersion
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      data.apiVersion = req.apiVersion || 'v1';
    }
    
    return originalJson(data) as any;
  };
  
  next();
}

/**
 * Error handler for version-related errors
 * 
 * Catches and formats version-related errors appropriately.
 * 
 * @example
 * app.use(versionErrorHandler);
 */
export function versionErrorHandler(
  err: any,
  req: VersionedRequest,
  res: Response,
  next: NextFunction
): void {
  if (err.message && err.message.includes('version')) {
    res.status(400).json({
      success: false,
      error: err.message,
      apiVersion: req.apiVersion || 'v1',
      platform: req.platform || 'unknown'
    });
    return;
  }
  
  next(err);
}

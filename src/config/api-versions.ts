/**
 * API Versions Configuration
 * 
 * Defines version strategies for each Jurexio platform.
 * Supported versions, deprecation timelines, and migration paths.
 */

export const API_VERSIONS = {
  // Jurexio Intelligence Layer (Primary orchestrator)
  nv: {
    current: 'v5.0.0',
    supported: ['v3.1', 'v3.0'],
    deprecated: ['v2'],
    description: 'Jurexio - Global Legal Operating System Intelligence Layer',
    releaseDate: '2025-12-01',
    sunsetDate: {
      v2: '2026-06-01' // v2 sunset date
    }
  },

  // Jurexio Professional (Firm/Solo Lawyer Platform)
  ns: {
    current: 'v1',
    supported: ['v1'],
    deprecated: [],
    description: 'Jurexio Professional™ - Solo & Firm Practice Management',
    releaseDate: '2025-06-01',
    sunsetDate: {}
  },

  // Jurexio Institutional (Enterprise Legal Platform)
  ni: {
    current: 'v1',
    supported: ['v1'],
    deprecated: [],
    description: 'Jurexio Institutional™ - Enterprise Legal Governance Platform',
    releaseDate: '2025-09-15',
    sunsetDate: {}
  },

  // Jurexio Ministry (Sovereign Regulatory Governance)
  nmin: {
    current: 'v1',
    supported: ['v1'],
    deprecated: [],
    description: 'Jurexio Ministry™ - Sovereign Regulatory Governance Infrastructure',
    releaseDate: '2025-10-01',
    sunsetDate: {}
  },

  // Jurexio Academy (Legal Training & Certification)
  nacad: {
    current: 'v1',
    supported: ['v1'],
    deprecated: [],
    description: 'Jurexio Academy™ - Legal Training, Certification & Mentorship',
    releaseDate: '2025-11-01',
    sunsetDate: {}
  },

  // Nyayamitra (Citizen Legal Platform)
  nm: {
    current: 'v1',
    supported: ['v1'],
    deprecated: [],
    description: 'Nyayamitra - Citizen Legal Assistance & Guidance',
    releaseDate: '2025-07-01',
    sunsetDate: {}
  },

  // Jurexio SDK (External API for Integrators)
  sdk: {
    current: 'v1',
    supported: ['v1'],
    deprecated: [],
    description: 'Jurexio SDK - External SaaS API for Third-Party Apps',
    releaseDate: '2025-08-01',
    sunsetDate: {}
  }
};

/**
 * API Route Mapping by Platform
 * Maps platform code to its current route prefix
 */
export const PLATFORM_ROUTES = {
  nv: '/api/jrx',           // Jurexio primary gateway
  ns: '/ns/v1',            // Jurexio Professional (spec-compliant)
  ni: '/api/ni',           // Jurexio Institutional
  nmin: '/api/nmin',       // Jurexio Ministry
  nacad: '/api/nacad',     // Jurexio Academy
  nm: '/api/nm',           // Nyayamitra
  sdk: '/api/v1/sdk'       // SDK External API
};

/**
 * Legacy Routes (Backward Compatibility)
 * Maps old route patterns to new versioned endpoints
 */
export const LEGACY_ROUTES = {
  '/api/nyayasiddhi': { platform: 'ns', version: 'v1', note: 'Redirect to /ns/v1' },
  '/api/nyayasiddhi-professional': { platform: 'ns', version: 'v1', note: 'Redirect to /ns/v1' },
  '/api/nyayasiddhi-lite': { platform: 'ns', version: 'v1', note: 'Redirect to /ns/v1' },
  '/api/nyayasiddhi-institutional': { platform: 'ni', version: 'v1', note: 'Redirect to /api/ni/v1' },
  '/api/nyayasiddhi-enterprise': { platform: 'ni', version: 'v1', note: 'Redirect to /api/ni/v1' },
  '/api/nyayasiddhi-ministry': { platform: 'nmin', version: 'v1', note: 'Redirect to /api/nmin/v1' },
  '/api/nyayasiddhi-academy': { platform: 'nacad', version: 'v1', note: 'Redirect to /api/nacad/v1' }
};

/**
 * Version Metadata - Extended Info
 */
export const VERSION_METADATA = {
  v1: {
    status: 'active',
    releaseNotes: 'Initial version - full feature support',
    features: ['base', 'enterprise', 'governance'],
    breakingChanges: []
  },
  v2: {
    status: 'deprecated',
    releaseNotes: 'Legacy version - use v3 or later',
    features: ['base', 'legacy-only'],
    breakingChanges: ['Removed deprecated audit endpoints']
  },
  v3: {
    status: 'active',
    releaseNotes: 'Enhanced with compliance and security',
    features: ['base', 'enterprise', 'governance', 'compliance'],
    breakingChanges: ['Restructured response payloads']
  },
  v3_1: {
    status: 'active',
    releaseNotes: 'Performance optimizations and new AI features',
    features: ['base', 'enterprise', 'governance', 'compliance', 'ai-enhanced'],
    breakingChanges: []
  }
};

/**
 * Helper function to get current API version for platform
 */
export function getCurrentVersion(platform: string): string {
  const platformKey = platform.toLowerCase() as keyof typeof API_VERSIONS;
  return API_VERSIONS[platformKey]?.current || 'v1';
}

/**
 * Helper function to check if version is supported
 */
export function isSupportedVersion(platform: string, version: string): boolean {
  const platformKey = platform.toLowerCase() as keyof typeof API_VERSIONS;
  return API_VERSIONS[platformKey]?.supported.includes(version) || false;
}

/**
 * Helper function to check if version is deprecated
 */
export function isDeprecatedVersion(platform: string, version: string): boolean {
  const platformKey = platform.toLowerCase() as keyof typeof API_VERSIONS;
  return (API_VERSIONS[platformKey]?.deprecated as readonly string[])?.includes(version) || false;
}

/**
 * Helper function to get sunset date for deprecated version
 */
export function getSunsetDate(platform: string, version: string): string | null {
  const platformKey = platform.toLowerCase() as keyof typeof API_VERSIONS;
  const config = API_VERSIONS[platformKey];
  if (!config) return null;
  
  return config.sunsetDate[version as keyof typeof config.sunsetDate] || null;
}

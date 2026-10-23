/**
 * MANDATORY: Application Configuration - Single Source of Truth
 * All configuration MUST go through this module.
 * 
 * Usage:
 *   import { getConfig, validateConfig } from './config/settings.js';
 *   
 *   const config = getConfig();
 *   const dbUrl = config.database.url;
 *   
 *   const errors = validateConfig(config);
 *   if (errors.length > 0) {
 *     console.error('Configuration errors:', errors);
 *     process.exit(1);
 *   }
 */

// Configuration interfaces
export interface DatabaseConfig {
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
  poolSize: number;
  maxOverflow: number;
}

export interface CacheConfig {
  backend: string;
  host: string;
  port: number;
  db: number;
  ttl: number;
}

export interface AppConfig {
  env: string;
  debug: boolean;
  logLevel: string;
  secretKey: string;
  database: DatabaseConfig;
  cache: CacheConfig;
}

// Singleton instance
let configInstance: AppConfig | null = null;

/**
 * Load database configuration from environment
 */
function loadDatabaseConfig(): DatabaseConfig {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    name: process.env.DB_NAME || 'app_database',
    user: process.env.DB_USER || 'app_user',
    password: process.env.DB_PASSWORD || '',
    poolSize: parseInt(process.env.DB_POOL_SIZE || '10', 10),
    maxOverflow: parseInt(process.env.DB_MAX_OVERFLOW || '20', 10),
  };
}

/**
 * Load cache configuration from environment
 */
function loadCacheConfig(): CacheConfig {
  return {
    backend: process.env.CACHE_BACKEND || 'redis',
    host: process.env.CACHE_HOST || 'localhost',
    port: parseInt(process.env.CACHE_PORT || '6379', 10),
    db: parseInt(process.env.CACHE_DB || '0', 10),
    ttl: parseInt(process.env.CACHE_TTL || '3600', 10),
  };
}

/**
 * MANDATORY: Get application configuration - single entry point
 * This function ensures configuration is loaded only once
 */
export function getConfig(): AppConfig {
  if (!configInstance) {
    configInstance = {
      env: process.env.APP_ENV || 'development',
      debug: (process.env.APP_DEBUG || 'false').toLowerCase() === 'true',
      logLevel: process.env.LOG_LEVEL || 'INFO',
      secretKey: process.env.SECRET_KEY || '',
      database: loadDatabaseConfig(),
      cache: loadCacheConfig(),
    };
  }
  return configInstance;
}

/**
 * Reset configuration (useful for testing)
 */
export function resetConfig(): void {
  configInstance = null;
}

/**
 * MANDATORY: Configuration validation
 * Validates that all required configuration is present
 */
export function validateConfig(config: AppConfig): string[] {
  const errors: string[] = [];

  // Required fields
  if (!config.secretKey) {
    errors.push('SECRET_KEY is required');
  }

  if (config.secretKey.length < 32) {
    errors.push('SECRET_KEY must be at least 32 characters');
  }

  // Database validation
  if (!config.database.password) {
    errors.push('DB_PASSWORD is required');
  }

  // Environment-specific validation
  if (config.env === 'production') {
    if (config.debug) {
      errors.push('DEBUG cannot be true in production');
    }
    if (config.logLevel === 'DEBUG') {
      errors.push('LOG_LEVEL should not be DEBUG in production');
    }
  }

  return errors;
}

/**
 * Validate configuration and exit if invalid
 */
export function validateConfigOrExit(): void {
  const config = getConfig();
  const errors = validateConfig(config);

  if (errors.length > 0) {
    console.error('Configuration errors:');
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }
}

export default getConfig;

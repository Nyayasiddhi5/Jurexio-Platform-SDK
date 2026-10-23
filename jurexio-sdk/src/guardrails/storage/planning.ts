/**
 * MANDATORY: Storage Planning Framework
 * Plan and validate storage architecture for all data persistence decisions.
 * 
 * Usage:
 *   import { StoragePlanner, PersistenceLevel, StorageType } from './storage/planning.js';
 *   
 *   const requirement = {
 *     dataName: 'user_sessions',
 *     persistenceLevel: PersistenceLevel.SESSION,
 *     expectedSizeMb: 10,
 *     accessPattern: 'read-heavy'
 *   };
 *   
 *   const warnings = StoragePlanner.validateStorageChoice(requirement, StorageType.DATABASE);
 */

export enum PersistenceLevel {
  EPHEMERAL = 'ephemeral',   // Lost on restart is OK
  SESSION = 'session',       // Must survive restart
  PERMANENT = 'permanent',   // Must be backed up
  CRITICAL = 'critical',     // Must be replicated
}

export enum StorageType {
  MEMORY = 'memory',           // In-memory only
  FILE = 'file',               // Local filesystem
  DATABASE = 'database',       // SQL database
  CACHE = 'cache',             // Redis/Memcached
  OBJECT_STORAGE = 'object',   // S3/MinIO
  QUEUE = 'queue',             // Message queue
}

export interface StorageRequirement {
  dataName: string;
  persistenceLevel: PersistenceLevel;
  expectedSizeMb: number;
  accessPattern: 'read-heavy' | 'write-heavy' | 'balanced';
  ttlSeconds?: number;
  backupRequired: boolean;
  encryptionRequired: boolean;
}

export interface StorageValidationWarning {
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  message: string;
}

export class StoragePlanner {
  private static readonly STORAGE_RECOMMENDATIONS: Record<PersistenceLevel, StorageType[]> = {
    [PersistenceLevel.EPHEMERAL]: [StorageType.MEMORY, StorageType.CACHE],
    [PersistenceLevel.SESSION]: [StorageType.CACHE, StorageType.DATABASE],
    [PersistenceLevel.PERMANENT]: [StorageType.DATABASE, StorageType.OBJECT_STORAGE],
    [PersistenceLevel.CRITICAL]: [StorageType.DATABASE, StorageType.OBJECT_STORAGE],
  };

  /**
   * Validate if storage choice meets requirements
   */
  public static validateStorageChoice(
    requirement: StorageRequirement,
    chosenStorage: StorageType
  ): StorageValidationWarning[] {
    const warnings: StorageValidationWarning[] = [];

    const recommended = this.STORAGE_RECOMMENDATIONS[requirement.persistenceLevel];

    if (!recommended.includes(chosenStorage)) {
      warnings.push({
        severity: 'WARNING',
        message: `${chosenStorage} may not be appropriate for ` +
          `${requirement.persistenceLevel} data. Recommended: ${recommended.join(', ')}`,
      });
    }

    // Check persistence level
    if (
      (requirement.persistenceLevel === PersistenceLevel.PERMANENT ||
        requirement.persistenceLevel === PersistenceLevel.CRITICAL) &&
      chosenStorage === StorageType.MEMORY
    ) {
      warnings.push({
        severity: 'CRITICAL',
        message: `Memory storage for ${requirement.dataName} will cause data loss on restart!`,
      });
    }

    // Check backup requirements
    if (requirement.backupRequired && chosenStorage === StorageType.MEMORY) {
      warnings.push({
        severity: 'CRITICAL',
        message: `${requirement.dataName} requires backup but uses memory storage`,
      });
    }

    // Check encryption requirements
    if (requirement.encryptionRequired && chosenStorage === StorageType.MEMORY) {
      warnings.push({
        severity: 'WARNING',
        message: `${requirement.dataName} requires encryption. Memory storage may not provide encryption at rest.`,
      });
    }

    return warnings;
  }

  /**
   * Get recommended storage types for a persistence level
   */
  public static getRecommendations(level: PersistenceLevel): StorageType[] {
    return this.STORAGE_RECOMMENDATIONS[level] || [];
  }

  /**
   * Plan storage for new data
   */
  public static planStorage(
    dataName: string,
    persistenceLevel: PersistenceLevel
  ): {
    dataName: string;
    persistenceLevel: string;
    recommendedStorage: string[];
    warnings: StorageValidationWarning[];
  } {
    const requirement: StorageRequirement = {
      dataName,
      persistenceLevel,
      expectedSizeMb: 0,
      accessPattern: 'balanced',
      backupRequired: false,
      encryptionRequired: false,
    };

    const recommendations = this.STORAGE_RECOMMENDATIONS[persistenceLevel] || [];

    return {
      dataName,
      persistenceLevel,
      recommendedStorage: recommendations,
      warnings: [],
    };
  }
}

/**
 * Pre-defined storage requirements for common data types
 */
export const STORAGE_REQUIREMENTS_TEMPLATE: Record<string, StorageRequirement> = {
  user_sessions: {
    dataName: 'user_sessions',
    persistenceLevel: PersistenceLevel.SESSION,
    expectedSizeMb: 10,
    accessPattern: 'read-heavy',
    ttlSeconds: 3600,
    backupRequired: false,
    encryptionRequired: true,
  },
  user_profiles: {
    dataName: 'user_profiles',
    persistenceLevel: PersistenceLevel.PERMANENT,
    expectedSizeMb: 100,
    accessPattern: 'balanced',
    backupRequired: true,
    encryptionRequired: true,
  },
  task_queue: {
    dataName: 'task_queue',
    persistenceLevel: PersistenceLevel.SESSION,
    expectedSizeMb: 50,
    accessPattern: 'write-heavy',
    ttlSeconds: 86400,
    backupRequired: false,
    encryptionRequired: false,
  },
  application_logs: {
    dataName: 'application_logs',
    persistenceLevel: PersistenceLevel.PERMANENT,
    expectedSizeMb: 1000,
    accessPattern: 'write-heavy',
    backupRequired: true,
    encryptionRequired: false,
  },
};

export default StoragePlanner;

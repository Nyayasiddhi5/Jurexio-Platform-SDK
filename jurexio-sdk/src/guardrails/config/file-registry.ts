/**
 * MANDATORY: File Registry
 * Centralized registry of all project files.
 * Update when adding new files.
 */

export interface FileRegistryEntry {
  purpose: string;
  owner: string;
  created: string;
  dependencies: string[];
}

export interface FileRegistry {
  metadata: {
    version: string;
    lastUpdated: string;
    maintainer: string;
  };
  files: Record<string, FileRegistryEntry>;
  namingStandards: {
    modules: string;
    classes: string;
    functions: string;
    constants: string;
    variables: string;
  };
}

/**
 * Central file registry
 * UPDATE THIS when adding new files to the project
 */
export const FILE_REGISTRY: FileRegistry = {
  metadata: {
    version: '1.0.0',
    lastUpdated: '2024-01-01',
    maintainer: 'platform-team',
  },
  files: {
    'config/settings.ts': {
      purpose: 'Application configuration',
      owner: 'platform-team',
      created: '2024-01-01',
      dependencies: [],
    },
    'config/file-registry.ts': {
      purpose: 'File registry',
      owner: 'platform-team',
      created: '2024-01-01',
      dependencies: [],
    },
    'guardrails/file-creation.ts': {
      purpose: 'Duplicate file prevention',
      owner: 'qa-team',
      created: '2024-01-01',
      dependencies: ['config/settings.ts'],
    },
    'guardrails/functionality-search.ts': {
      purpose: 'Functionality search',
      owner: 'qa-team',
      created: '2024-01-01',
      dependencies: [],
    },
    'scripts/detect-duplicates.ts': {
      purpose: 'Duplicate file detection',
      owner: 'qa-team',
      created: '2024-01-01',
      dependencies: [],
    },
    'scripts/detect-hardcoded.ts': {
      purpose: 'Hardcoded value detection',
      owner: 'security-team',
      created: '2024-01-01',
      dependencies: [],
    },
    'scripts/audit-config.ts': {
      purpose: 'Configuration audit',
      owner: 'qa-team',
      created: '2024-01-01',
      dependencies: [],
    },
    'storage/planning.ts': {
      purpose: 'Storage planning',
      owner: 'data-team',
      created: '2024-01-01',
      dependencies: [],
    },
    'security/data-isolation.ts': {
      purpose: 'User data isolation',
      owner: 'security-team',
      created: '2024-01-01',
      dependencies: [],
    },
    'standards/naming.ts': {
      purpose: 'Naming conventions',
      owner: 'qa-team',
      created: '2024-01-01',
      dependencies: [],
    },
    'standards/naming-linter.ts': {
      purpose: 'Naming convention linter',
      owner: 'qa-team',
      created: '2024-01-01',
      dependencies: ['standards/naming.ts'],
    },
    'database/schema-validation.ts': {
      purpose: 'Schema validation',
      owner: 'data-team',
      created: '2024-01-01',
      dependencies: [],
    },
    'session/audit.ts': {
      purpose: 'Session audit',
      owner: 'security-team',
      created: '2024-01-01',
      dependencies: [],
    },
  },
  namingStandards: {
    modules: 'snake_case',
    classes: 'PascalCase',
    functions: 'snake_case',
    constants: 'UPPER_SNAKE_CASE',
    variables: 'snake_case',
  },
};

/**
 * Get information about a registered file
 */
export function getFileInfo(filePath: string): FileRegistryEntry | undefined {
  return FILE_REGISTRY.files[filePath];
}

/**
 * Register a new file in the registry
 */
export function registerFile(
  filePath: string,
  purpose: string,
  owner: string,
  dependencies: string[] = []
): void {
  FILE_REGISTRY.files[filePath] = {
    purpose,
    owner,
    created: new Date().toISOString(),
    dependencies,
  };
}

/**
 * List all files owned by a specific team
 */
export function listFilesByOwner(owner: string): string[] {
  return Object.entries(FILE_REGISTRY.files)
    .filter(([, info]) => info.owner === owner)
    .map(([path]) => path);
}

/**
 * Check if a file is registered
 */
export function isFileRegistered(filePath: string): boolean {
  return filePath in FILE_REGISTRY.files;
}

/**
 * Get all registered files
 */
export function getAllRegisteredFiles(): string[] {
  return Object.keys(FILE_REGISTRY.files);
}

export default FILE_REGISTRY;

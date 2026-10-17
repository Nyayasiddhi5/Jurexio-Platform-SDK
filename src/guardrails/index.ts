/**
 * AI Agentic Platform Guardrails
 * 
 * This package provides guardrails and standards for building AI agentic
 * orchestration platforms with TypeScript/Node.js.
 * 
 * @module ai-platform-guardrails
 */

// Guardrails
export { 
  FileCreationGuardrail, 
  createFileGuarded,
  VerificationResult as FileVerificationResult 
} from './guardrails/file-creation.js';

export { 
  FunctionalitySearchGuardrail, 
  createFunctionGuarded,
  FunctionalitySearchResult,
  FunctionalityVerificationResult 
} from './guardrails/functionality-search.js';

// Security
export { 
  DataIsolationGuardrail, 
  userScoped, 
  UserScopedModel,
  IsolationWarning 
} from './security/data-isolation.js';

// Storage
export { 
  StoragePlanner, 
  PersistenceLevel, 
  StorageType,
  StorageRequirement,
  StorageValidationWarning,
  STORAGE_REQUIREMENTS_TEMPLATE 
} from './storage/planning.js';

// Database
export { 
  SchemaValidator, 
  ColumnNamingStandards,
  SchemaValidationError,
  ColumnValidationResult 
} from './database/schema-validation.js';

// Session
export { 
  SessionAuditor, 
  CrossPlatformSession,
  SESSION_SCHEMA,
  SessionRequirement,
  SessionValidationError,
  SessionSecurityIssue 
} from './session/audit.js';

// Standards
export { 
  NamingStandards,
  NamingValidationResult,
  NameType 
} from './standards/naming.js';

export { 
  NamingConventionLinter as NamingLinter,
  NamingViolation as LinterNamingViolation,
  LintResults as LinterResults 
} from './standards/naming-linter.js';

// Config
export { 
  getConfig, 
  validateConfig, 
  validateConfigOrExit,
  resetConfig,
  AppConfig,
  DatabaseConfig,
  CacheConfig 
} from './config/settings.js';

export { 
  FILE_REGISTRY,
  getFileInfo,
  registerFile,
  listFilesByOwner,
  isFileRegistered,
  getAllRegisteredFiles,
  FileRegistryEntry 
} from './config/file-registry.js';

export { 
  TERMINOLOGY_GLOSSARY,
  getPreferredTerm,
  validateTermUsage,
  printGlossary,
  getDeprecatedTerms,
  TermDefinition,
  TermViolation,
  Domain 
} from './config/terminology-glossary.js';

// Scripts
export { 
  HardcodedValueDetector, 
  printResults as printHardcodedResults,
  HardcodedFinding,
  ScanResults 
} from './scripts/detect-hardcoded.js';

export { 
  ConfigAuditor, 
  printResults as printAuditResults,
  ConfigViolation,
  AuditResults 
} from './scripts/audit-config.js';

export { 
  findDuplicateFiles, 
  printResults as printDuplicateResults,
  DuplicateResults 
} from './scripts/detect-duplicates.js';

// Re-exports for convenience
export { default } from './guardrails/file-creation.js';

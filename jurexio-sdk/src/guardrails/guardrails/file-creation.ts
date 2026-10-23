/**
 * MANDATORY: File Creation Guardrail
 * Prevents duplicate file creation through verification and registry checks.
 * 
 * Usage:
 *   import { FileCreationGuardrail, createFileGuarded } from './guardrails/file-creation.js';
 *   
 *   const result = FileCreationGuardrail.verifyBeforeCreation('src/services/user.ts', 'User service');
 *   if (result.canCreate) {
 *     // Proceed with file creation
 *   }
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

export interface VerificationResult {
  canCreate: boolean;
  warnings: string[];
  similarFiles: string[];
  suggestedName?: string;
  message?: string;
}

export interface FileRegistryEntry {
  purpose: string;
  owner: string;
  created: string;
  dependencies: string[];
}

export class FileCreationGuardrail {
  /** Centralized file registry - update when adding new files */
  private static readonly FILE_REGISTRY: Record<string, string[]> = {
    'config': ['config.ts', 'settings.ts', 'configuration.ts', 'config.yaml', 'config.json'],
    'database': ['database.ts', 'db.ts', 'models.ts', 'schema.ts', 'migrations/'],
    'utils': ['utils.ts', 'helpers.ts', 'common.ts', 'shared.ts'],
    'auth': ['auth.ts', 'authentication.ts', 'login.ts', 'session.ts'],
    'api': ['api.ts', 'routes.ts', 'endpoints.ts', 'views.ts'],
    'services': ['service.ts', 'services.ts', 'business-logic.ts'],
  };

  private static readonly SIMILAR_NAME_PATTERNS: Record<string, string[]> = {
    'user': ['user', 'users', 'account', 'accounts', 'profile', 'profiles'],
    'task': ['task', 'tasks', 'job', 'jobs', 'work', 'works'],
    'config': ['config', 'configuration', 'setting', 'settings', 'cfg'],
    'util': ['util', 'utils', 'utility', 'utilities', 'helper', 'helpers'],
  };

  /**
   * MANDATORY: Call this before creating any file
   * 
   * @param filePath - Path to the file to be created
   * @param purpose - Description of the file's purpose
   * @returns VerificationResult with canCreate flag and warnings
   */
  public static verifyBeforeCreation(filePath: string, purpose: string): VerificationResult {
    const result: VerificationResult = {
      canCreate: true,
      warnings: [],
      similarFiles: [],
    };

    const fileName = path.basename(filePath);
    const directory = path.dirname(filePath);

    // Check 1: Exact file exists
    if (fs.existsSync(filePath)) {
      result.canCreate = false;
      result.message = `CRITICAL: File '${filePath}' already exists!`;
      result.warnings.push(result.message);
      return result;
    }

    // Check 2: Similar files in same directory
    if (fs.existsSync(directory)) {
      const existingFiles = fs.readdirSync(directory);
      for (const existing of existingFiles) {
        const similarity = this.calculateSimilarity(fileName, existing);
        if (similarity > 0.7) {
          result.similarFiles.push(existing);
          result.warnings.push(
            `WARNING: '${fileName}' is ${Math.round(similarity * 100)}% similar to existing '${existing}'`
          );
        }
      }
    }

    // Check 3: Registry lookup
    for (const [category, patterns] of Object.entries(this.FILE_REGISTRY)) {
      for (const pattern of patterns) {
        if (this.nameMatchesPattern(fileName, pattern)) {
          result.warnings.push(
            `INFO: '${fileName}' matches registry pattern '${pattern}' in category '${category}'`
          );
        }
      }
    }

    // Check 4: Semantic similarity
    for (const [semanticGroup, variants] of Object.entries(this.SIMILAR_NAME_PATTERNS)) {
      for (const variant of variants) {
        if (fileName.toLowerCase().includes(variant.toLowerCase())) {
          result.warnings.push(
            `INFO: '${fileName}' contains semantic variant '${variant}' of group '${semanticGroup}'`
          );
          result.suggestedName = this.suggestStandardName(fileName, semanticGroup);
        }
      }
    }

    return result;
  }

  /**
   * Calculate string similarity using Levenshtein distance
   */
  private static calculateSimilarity(name1: string, name2: string): number {
    const n1 = path.basename(name1, path.extname(name1)).toLowerCase();
    const n2 = path.basename(name2, path.extname(name2)).toLowerCase();
    
    const distance = this.levenshteinDistance(n1, n2);
    const maxLength = Math.max(n1.length, n2.length);
    return 1 - distance / maxLength;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private static levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    return matrix[str2.length][str1.length];
  }

  private static nameMatchesPattern(name: string, pattern: string): boolean {
    const nameLower = name.toLowerCase();
    const patternLower = pattern.toLowerCase();
    return nameLower.includes(patternLower) || 
           new RegExp(patternLower.replace('*', '.*')).test(nameLower);
  }

  private static suggestStandardName(currentName: string, semanticGroup: string): string {
    const extension = path.extname(currentName);
    const preferred = this.SIMILAR_NAME_PATTERNS[semanticGroup][0];
    return `${preferred}${extension}`;
  }
}

/**
 * MANDATORY wrapper for file creation with duplicate prevention
 * 
 * Usage:
 *   const success = createFileGuarded(
 *     'path/to/file.ts',
 *     'file content',
 *     'Purpose of this file'
 *   );
 */
export function createFileGuarded(
  filePath: string, 
  content: string, 
  purpose: string
): boolean {
  const verification = FileCreationGuardrail.verifyBeforeCreation(filePath, purpose);

  if (!verification.canCreate) {
    console.error('❌ FILE CREATION BLOCKED:');
    for (const warning of verification.warnings) {
      console.error(`   ${warning}`);
    }
    return false;
  }

  if (verification.warnings.length > 0) {
    console.warn('⚠️  WARNINGS (review before proceeding):');
    for (const warning of verification.warnings) {
      console.warn(`   ${warning}`);
    }

    if (verification.suggestedName) {
      console.warn(`   Suggested name: ${verification.suggestedName}`);
    }
  }

  // Proceed with creation
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, 'utf-8');

  console.log(`✅ File created: ${filePath}`);
  return true;
}

// Export for use in other modules
export default FileCreationGuardrail;

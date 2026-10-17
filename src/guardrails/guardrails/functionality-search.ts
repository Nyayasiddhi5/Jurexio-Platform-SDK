/**
 * MANDATORY: Functionality Search Guardrail
 * Prevents creating duplicate functionality by searching codebase first.
 * 
 * Usage:
 *   import { FunctionalitySearchGuardrail } from './guardrails/functionality-search.js';
 *   
 *   const result = FunctionalitySearchGuardrail.verifyBeforeCreation(
 *     'getUser',
 *     'Retrieve user by ID',
 *     ['user', 'get', 'retrieve']
 *   );
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

export interface FunctionalitySearchResult {
  exactMatches: Array<{ file: string; matchedTerm: string }>;
  similarFunctions: Array<{ file: string; name: string; type: string; matchedTerm: string }>;
  relatedFiles: Array<{ file: string; matchedTerm: string }>;
}

export interface FunctionalityVerificationResult {
  canCreate: boolean;
  warnings: string[];
  similarItems: Array<{ file: string; name: string; type: string; matchedTerm: string }>;
}

export class FunctionalitySearchGuardrail {
  /**
   * Search codebase for similar functionality
   * 
   * @param searchTerms - Keywords describing the functionality
   * @param fileExtensions - File types to search (default: ['.ts'])
   * @param rootDir - Root directory to search
   * @returns Search results with matches
   */
  public static searchSimilarFunctionality(
    searchTerms: string[],
    fileExtensions: string[] = ['.ts'],
    rootDir: string = '.'
  ): FunctionalitySearchResult {
    const results: FunctionalitySearchResult = {
      exactMatches: [],
      similarFunctions: [],
      relatedFiles: [],
    };

    const skipDirs = ['node_modules', '.git', 'dist', 'build', 'coverage'];

    for (const ext of fileExtensions) {
      const pattern = path.join(rootDir, '**', `*${ext}`).replace(/\\/g, '/');
      const files = glob.sync(pattern, { ignore: skipDirs.map(d => `**/${d}/**`) });

      for (const filePath of files) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');

          // Check for exact term matches
          for (const term of searchTerms) {
            if (content.toLowerCase().includes(term.toLowerCase())) {
              results.relatedFiles.push({
                file: filePath,
                matchedTerm: term,
              });
            }
          }

          // Parse TypeScript files for function/class names
          if (ext === '.ts' || ext === '.tsx') {
            this.extractFunctionsAndClasses(content, filePath, searchTerms, results);
          }
        } catch (error: any) {
          console.warn(`Error reading ${filePath}:`, error);
        }
      }
    }

    return results;
  }

  /**
   * Extract function and class names from TypeScript content
   */
  private static extractFunctionsAndClasses(
    content: string,
    filePath: string,
    searchTerms: string[],
    results: FunctionalitySearchResult
  ): void {
    // Match function declarations
    const functionRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(|(\w+)\s*\(.*\)\s*{/g;
    let match;
    while ((match = functionRegex.exec(content)) !== null) {
      const name = match[1] || match[2] || match[3];
      if (name) {
        for (const term of searchTerms) {
          if (name.toLowerCase().includes(term.toLowerCase())) {
            results.similarFunctions.push({
              file: filePath,
              name,
              type: 'function',
              matchedTerm: term,
            });
          }
        }
      }
    }

    // Match class declarations
    const classRegex = /(?:export\s+)?class\s+(\w+)/g;
    while ((match = classRegex.exec(content)) !== null) {
      const name = match[1];
      for (const term of searchTerms) {
        if (name.toLowerCase().includes(term.toLowerCase())) {
          results.similarFunctions.push({
            file: filePath,
            name,
            type: 'class',
            matchedTerm: term,
          });
        }
      }
    }

    // Match method declarations
    const methodRegex = /(?:public|private|protected)?\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*:/g;
    while ((match = methodRegex.exec(content)) !== null) {
      const name = match[1];
      if (name && !['constructor', 'if', 'while', 'for'].includes(name)) {
        for (const term of searchTerms) {
          if (name.toLowerCase().includes(term.toLowerCase())) {
            results.similarFunctions.push({
              file: filePath,
              name,
              type: 'method',
              matchedTerm: term,
            });
          }
        }
      }
    }
  }

  /**
   * MANDATORY: Call this before creating any function or class
   * 
   * @param name - Name of the function/class to create
   * @param purpose - Description of the functionality
   * @param searchTerms - Keywords to search for similar functionality
   * @returns Verification result
   */
  public static verifyBeforeCreation(
    name: string,
    purpose: string,
    searchTerms: string[]
  ): FunctionalityVerificationResult {
    const result: FunctionalityVerificationResult = {
      canCreate: true,
      warnings: [],
      similarItems: [],
    };

    // Search for similar functionality
    const searchResults = this.searchSimilarFunctionality(searchTerms);

    if (searchResults.similarFunctions.length > 0) {
      result.warnings.push(
        `Found ${searchResults.similarFunctions.length} similar functions/classes`
      );
      result.similarItems = searchResults.similarFunctions;
    }

    if (searchResults.relatedFiles.length > 0) {
      const uniqueFiles = [...new Set(searchResults.relatedFiles.map(r => r.file))];
      result.warnings.push(`Found ${uniqueFiles.length} related files`);
    }

    return result;
  }
}

/**
 * Wrapper for function creation with similarity check
 * 
 * Usage:
 *   if (createFunctionGuarded('getUser', 'Retrieve user data', ['user', 'get'])) {
 *     // Proceed with function creation
 *   }
 */
export function createFunctionGuarded(
  name: string,
  purpose: string,
  searchTerms: string[]
): boolean {
  const verification = FunctionalitySearchGuardrail.verifyBeforeCreation(
    name,
    purpose,
    searchTerms
  );

  if (verification.warnings.length > 0) {
    console.warn('⚠️  Similar functionality found:');
    for (const warning of verification.warnings) {
      console.warn(`   ${warning}`);
    }

    if (verification.similarItems.length > 0) {
      console.warn('\n   Similar items:');
      for (const item of verification.similarItems.slice(0, 5)) {
        console.warn(`   - ${item.type} '${item.name}' in ${item.file}`);
      }
    }

    return false;
  }

  return true;
}

export default FunctionalitySearchGuardrail;

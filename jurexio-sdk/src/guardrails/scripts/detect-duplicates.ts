/**
 * MANDATORY: Duplicate File Detection Script
 * Run in CI/CD to detect duplicate files in the codebase.
 * 
 * Usage:
 *   npm run detect-duplicates
 *   or
 *   npx ts-node src/scripts/detect-duplicates.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { glob } from 'glob';

export interface DuplicateResults {
  identicalContent: Array<{ hash: string; files: string[] }>;
  sameNameDifferentLocation: Array<{ name: string; locations: string[] }>;
}

/**
 * Find files with identical or similar content
 */
export function findDuplicateFiles(rootDir: string = '.'): DuplicateResults {
  const contentHashes: Map<string, string[]> = new Map();
  const nameGroups: Map<string, string[]> = new Map();

  const skipDirs = ['node_modules', '.git', 'dist', 'build', 'coverage', '.pytest_cache'];
  const pattern = path.join(rootDir, '**', '*.{ts,tsx,js,json,yaml,yml}').replace(/\\/g, '/');
  const files = glob.sync(pattern, { ignore: skipDirs.map(d => `**/${d}/**`) });

  for (const filePath of files) {
    const fileName = path.basename(filePath);

    // Group by name
    if (!nameGroups.has(fileName)) {
      nameGroups.set(fileName, []);
    }
    nameGroups.get(fileName)!.push(filePath);

    // Hash content
    try {
      const content = fs.readFileSync(filePath);
      const hash = crypto.createHash('md5').update(content).digest('hex');
      
      if (!contentHashes.has(hash)) {
        contentHashes.set(hash, []);
      }
      contentHashes.get(hash)!.push(filePath);
    } catch (error: any) {
      console.warn(`Error reading ${filePath}:`, error);
    }
  }

  // Find duplicates
  const results: DuplicateResults = {
    identicalContent: [],
    sameNameDifferentLocation: [],
  };

  for (const [hash, files] of contentHashes.entries()) {
    if (files.length > 1) {
      results.identicalContent.push({
        hash,
        files,
      });
    }
  }

  for (const [name, locations] of nameGroups.entries()) {
    if (locations.length > 1) {
      results.sameNameDifferentLocation.push({
        name,
        locations,
      });
    }
  }

  return results;
}

/**
 * Print duplicate detection results
 * 
 * @returns Exit code (0 = no duplicates, 1 = duplicates found)
 */
export function printResults(results: DuplicateResults): number {
  const hasDuplicates = 
    results.identicalContent.length > 0 || 
    results.sameNameDifferentLocation.length > 0;

  if (results.identicalContent.length > 0) {
    console.log('\n❌ IDENTICAL CONTENT FOUND:');
    for (const item of results.identicalContent) {
      console.log(`\n  Hash: ${item.hash.slice(0, 8)}...`);
      for (const f of item.files) {
        console.log(`    - ${f}`);
      }
    }
  }

  if (results.sameNameDifferentLocation.length > 0) {
    console.log('\n⚠️  SAME NAME IN MULTIPLE LOCATIONS:');
    for (const item of results.sameNameDifferentLocation) {
      console.log(`\n  File: ${item.name}`);
      for (const loc of item.locations) {
        console.log(`    - ${loc}`);
      }
    }
  }

  if (!hasDuplicates) {
    console.log('✅ No duplicates found!');
    return 0;
  }

  return 1;
}

// Run if executed directly
if (require.main === module) {
  const results = findDuplicateFiles();
  const exitCode = printResults(results);
  process.exit(exitCode);
}

export default findDuplicateFiles;

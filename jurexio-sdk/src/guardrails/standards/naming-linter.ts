/**
 * MANDATORY: Naming Convention Linter
 * Run in CI/CD to validate naming conventions.
 * 
 * Usage:
 *   npm run check-naming
 *   or
 *   npx ts-node src/standards/naming-linter.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { NamingStandards, NameType } from './naming.js';

export interface NamingViolation {
  file: string;
  line: number;
  type: NameType;
  name: string;
  error: string;
}

export interface LintResults {
  filesChecked: number;
  violations: NamingViolation[];
  violationCount: number;
}

export class NamingConventionLinter {
  private readonly PATTERNS: Record<string, RegExp> = {
    class: /^[A-Z][a-zA-Z0-9]*$/,
    function: /^[a-z][a-z0-9_]*$/,
    constant: /^[A-Z][A-Z0-9_]*$/,
    variable: /^[a-z][a-z0-9_]*$/,
  };

  private rootDir: string;
  public violations: NamingViolation[] = [];

  constructor(rootDir: string = '.') {
    this.rootDir = rootDir;
  }

  /**
   * Lint a single file
   */
  public lintFile(filePath: string): NamingViolation[] {
    const violations: NamingViolation[] = [];

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];

        // Check class declarations
        const classMatch = line.match(/(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/);
        if (classMatch) {
          const name = classMatch[1];
          if (!this.PATTERNS.class.test(name)) {
            violations.push({
              file: filePath,
              line: lineNum + 1,
              type: 'class',
              name,
              error: `Class '${name}' should be PascalCase`,
            });
          }
        }

        // Check interface declarations
        const interfaceMatch = line.match(/(?:export\s+)?interface\s+(\w+)/);
        if (interfaceMatch) {
          const name = interfaceMatch[1];
          if (!this.PATTERNS.class.test(name)) {
            violations.push({
              file: filePath,
              line: lineNum + 1,
              type: 'class',
              name,
              error: `Interface '${name}' should be PascalCase`,
            });
          }
        }

        // Check function declarations
        const functionMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
        if (functionMatch) {
          const name = functionMatch[1];
          if (!name.startsWith('_') && !this.PATTERNS.function.test(name)) {
            violations.push({
              file: filePath,
              line: lineNum + 1,
              type: 'function',
              name,
              error: `Function '${name}' should be snake_case`,
            });
          }
        }

        // Check const declarations (potential constants)
        const constMatch = line.match(/const\s+(\w+)\s*=/);
        if (constMatch) {
          const name = constMatch[1];
          // Check if it's a constant (UPPER_SNAKE_CASE)
          if (name === name.toUpperCase() && name.length > 1 && /[A-Z]/.test(name)) {
            // It's a constant, should be UPPER_SNAKE_CASE
            if (!this.PATTERNS.constant.test(name)) {
              violations.push({
                file: filePath,
                line: lineNum + 1,
                type: 'constant',
                name,
                error: `Constant '${name}' should be UPPER_SNAKE_CASE`,
              });
            }
          }
        }
      }
    } catch (error: any) {
      // Skip files that can't be read
    }

    return violations;
  }

  /**
   * Lint entire project
   */
  public lintProject(): LintResults {
    const allViolations: NamingViolation[] = [];
    let filesChecked = 0;

    const skipDirs = ['node_modules', '.git', 'dist', 'build', 'coverage'];
    const pattern = path.join(this.rootDir, '**', '*.ts').replace(/\\/g, '/');
    const files = glob.sync(pattern, { ignore: skipDirs.map(d => `**/${d}/**`) });

    for (const file of files) {
      const violations = this.lintFile(file);
      allViolations.push(...violations);
      filesChecked++;
    }

    return {
      filesChecked,
      violations: allViolations,
      violationCount: allViolations.length,
    };
  }
}

/**
 * Print results and return exit code
 */
export function printResults(results: LintResults): number {
  console.log(`Linted ${results.filesChecked} files`);
  console.log(`Found ${results.violationCount} violations`);

  if (results.violations.length > 0) {
    console.log('\nViolations:');
    for (const v of results.violations) {
      console.log(`  ${v.file}:${v.line} - ${v.error}`);
    }
  }

  return results.violationCount > 0 ? 1 : 0;
}

// Run if executed directly
if (require.main === module) {
  const linter = new NamingConventionLinter();
  const results = linter.lintProject();
  const exitCode = printResults(results);
  process.exit(exitCode);
}

export default NamingConventionLinter;

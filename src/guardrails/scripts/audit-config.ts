/**
 * MANDATORY: Configuration Audit Script
 * Run in CI/CD to audit configuration usage across codebase.
 * 
 * Usage:
 *   npm run audit
 *   or
 *   npx ts-node src/scripts/audit-config.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

export interface ConfigViolation {
  file: string;
  line: number;
  pattern: string;
  match: string;
  severity: 'ERROR' | 'WARNING';
  message: string;
}

export interface AuditResults {
  filesChecked: number;
  violations: ConfigViolation[];
  violationCount: number;
  errorCount: number;
}

export class ConfigAuditor {
  private readonly FORBIDDEN_PATTERNS: { pattern: RegExp; message: string }[] = [
    { pattern: /process\.env\.\w+/, message: 'Direct process.env access' },
    { pattern: /process\.env\[/, message: 'Direct process.env access' },
    { pattern: /fs\.readFileSync\s*\(\s*["'].*\.json["']/, message: 'Direct JSON file access' },
    { pattern: /fs\.readFileSync\s*\(\s*["'].*\.ya?ml["']/, message: 'Direct YAML file access' },
  ];

  private readonly REQUIRED_IMPORT = 'from\s+[\'"]\.\/config\/settings[\'"]';

  private rootDir: string;
  public violations: ConfigViolation[] = [];

  constructor(rootDir: string = '.') {
    this.rootDir = rootDir;
  }

  /**
   * Audit a single file for configuration violations
   */
  public auditFile(filePath: string): ConfigViolation[] {
    const violations: ConfigViolation[] = [];

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      // Check for forbidden patterns
      for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];

        for (const { pattern, message } of this.FORBIDDEN_PATTERNS) {
          const matches = line.matchAll(pattern);
          for (const match of matches) {
            violations.push({
              file: filePath,
              line: lineNum + 1,
              pattern: pattern.source,
              match: match[0].slice(0, 50),
              severity: 'ERROR',
              message: `Forbidden configuration access: ${message}`,
            });
          }
        }
      }

      // Check for config import in TypeScript files
      if (filePath.endsWith('.ts')) {
        const hasGetConfig = content.includes('getConfig');
        const hasProperImport = new RegExp(this.REQUIRED_IMPORT).test(content);

        if (hasGetConfig && !hasProperImport) {
          violations.push({
            file: filePath,
            line: 0,
            pattern: 'import',
            match: '',
            severity: 'WARNING',
            message: 'Uses getConfig but may not import from config module',
          });
        }
      }
    } catch (error: any) {
      // Skip files that can't be read
    }

    return violations;
  }

  /**
   * Audit entire project
   */
  public auditProject(): AuditResults {
    const allViolations: ConfigViolation[] = [];
    let filesChecked = 0;

    const skipDirs = ['node_modules', '.git', 'dist', 'build', 'coverage', 'config'];
    const pattern = path.join(this.rootDir, '**', '*.ts').replace(/\\/g, '/');
    const files = glob.sync(pattern, { ignore: skipDirs.map(d => `**/${d}/**`) });

    for (const file of files) {
      const violations = this.auditFile(file);
      allViolations.push(...violations);
      filesChecked++;
    }

    return {
      filesChecked,
      violations: allViolations,
      violationCount: allViolations.length,
      errorCount: allViolations.filter(v => v.severity === 'ERROR').length,
    };
  }
}

/**
 * Print results and return exit code
 */
export function printResults(results: AuditResults): number {
  console.log(`Audited ${results.filesChecked} files`);
  console.log(`Found ${results.violationCount} violations`);

  if (results.violations.length > 0) {
    console.log('\nViolations:');
    for (const v of results.violations) {
      console.log(`  [${v.severity}] ${v.file}:${v.line}`);
      console.log(`         ${v.message}`);
    }
  }

  return results.errorCount > 0 ? 1 : 0;
}

// Run if executed directly
if (require.main === module) {
  const auditor = new ConfigAuditor();
  const results = auditor.auditProject();
  const exitCode = printResults(results);
  process.exit(exitCode);
}

export default ConfigAuditor;

/**
 * MANDATORY: Hardcoded Value Detection Script
 * Run in CI/CD to detect hardcoded values in the codebase.
 *
 * Usage:
 *   npm run detect-hardcoded
 *   or
 *   npx ts-node src/guardrails/scripts/detect-hardcoded.ts
 *
 * Detects:
 *   - secrets: passwords, tokens, API keys hardcoded in source
 *   - emails: hardcoded email addresses (should come from config/env)
 *   - urls: hardcoded HTTP/HTTPS URLs (should come from jrx-service-urls.ts)
 *   - console_calls: console.log/error/warn/debug (must use logger.* instead)
 *   - magic_numbers: suspiciously large numeric literals
 *   - file_paths: absolute file paths hardcoded in source
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

export interface HardcodedFinding {
  file: string;
  line: number;
  column: number;
  match: string;
  category: 'secrets' | 'emails' | 'urls' | 'console_calls' | 'magic_numbers' | 'file_paths';
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  message: string;
}

export interface ScanResults {
  filesScanned: number;
  findings: HardcodedFinding[];
  criticalCount: number;
  warningCount: number;
  infoCount: number;
}

export class HardcodedValueDetector {
  private readonly DANGEROUS_PATTERNS: Record<string, {
    patterns: RegExp[];
    severity: 'CRITICAL' | 'WARNING' | 'INFO';
    message: string;
    exceptions?: string[];
    skipFiles?: RegExp[];
  }> = {
    secrets: {
      patterns: [
        /password\s*=\s*["'][^"']+["']/i,
        /secret\s*=\s*["'][^"']+["']/i,
        /token\s*=\s*["'][^"']+["']/i,
        /api_key\s*=\s*["'][^"']+["']/i,
        /*
         * NV-DETECT-KEYNAME-FP-001 (2026-08-19) — this was
         * `/key\s*=\s*["'][^"']{16,}["']/i`, which fired on ANY identifier ending in "key"
         * assigned a string of 16+ characters. That is the naming convention for cache keys,
         * Redis keys and field-name constants, so it reported three CRITICAL "hardcoded
         * secrets" that were nothing of the kind:
         *   STATUTES_FIELD_KEY   = 'statutes_invoked'
         *   ROMA_PERF_REDIS_KEY  = 'nyv:roma:l5:performance'
         *   KEY                  = 'nv_legal_last_runs'
         * Three false CRITICALs train the reader to ignore the category — which is how a real
         * one would slip past.
         *
         * The exclusion is deliberately built on the SHAPE OF THE VALUE, not the variable
         * name, and is case-SENSITIVE in the value even though the name match is not. A
         * lowercase snake/kebab/colon identifier (`statutes_invoked`,
         * `nyv:roma:l5:performance`) is not a credential. Real secrets fail that shape because
         * they carry uppercase or a vendor prefix: `sk-proj-AbCd12…`, `AKIAIOSFODNN7EXAMPLE`,
         * `ghp_16Chars…`, `MyS3cretV4lue…`, base64 with `=` padding.
         *
         * A first attempt used a single case-insensitive regex; the `i` flag also relaxed the
         * value lookahead, so all four of those real secrets matched the "identifier" shape and
         * were MISSED. Splitting the name match from a case-sensitive value assertion is what
         * makes both halves correct — verified with a positive control in both directions.
         */
        /(?:key|apikey|api_key)\s*=\s*["'](?![a-z0-9]+(?:[_:\-.][a-z0-9]+)*["'])[^"']{16,}["']/,
        /(?:KEY|Key)\s*=\s*["'](?![a-z0-9]+(?:[_:\-.][a-z0-9]+)*["'])[^"']{16,}["']/,
      ],
      severity: 'CRITICAL',
      message: 'Hardcoded secret detected',
      skipFiles: [
        /test\.ts$/,
        /spec\.ts$/,
        /\.test\.ts$/,
        /seed/,
        /demo/,
        /docstotrack/,
        /archive/,
        /scripts\/jrx-seed/,
        /scripts\/jrx-provision/,
        /packages\/.*\/tests\//,
        /jrx-jwt-validator/,
        /jrx-rate-limit-middleware/,
        /audit-chain-lock/,
        /jrx-sme-grpo-redis-queue/,
        /jrx-health-full-routes/,
        /offline\.ts$/,
      ],
      exceptions: [
        'development-secret-key-change-in-production',
        'whsec_test_',
        'nyv_test_sk_',
        '__nyv_rl_',
        'nv:audit:chain:lock',
        'nyv:grpo:training',
        'openrouter-global',
        'nym.offline.drafts',
        'Demo@2026',
        'demouser123',
      ],
    },
    emails: {
      patterns: [
        /["'][a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}["']/,
      ],
      severity: 'WARNING',
      message: 'Hardcoded email address — use config or environment variable instead',
      exceptions: [
        'example.com', 'test.com', 'placeholder', '@jurexio.com',
        'admin@', 'noreply@', 'support@', 'no-reply@',
      ],
      skipFiles: [/schema\.ts$/, /seed/, /demo/, /test/, /spec/, /migrations/],
    },
    urls: {
      patterns: [
        /https?:\/\/[^\s\)"'`]+/i,
      ],
      severity: 'WARNING',
      message: 'Hardcoded URL — use jrx-service-urls.ts or environment variable instead',
      exceptions: [
        'localhost', '127.0.0.1', 'example.com', '0.0.0.0',
        'schema.org', 'w3.org', 'xmlns', 'openapi', 'swagger',
        'github.com/jurexio', 'replit.app', 'jurexio.com',
      ],
    },
    console_calls: {
      patterns: [
        /\bconsole\.(log|error|warn|debug|info|trace|table)\s*\(/,
      ],
      severity: 'WARNING',
      message: 'console.* call — use logger.* (structured logging) instead',
      skipFiles: [
        /logger\.ts$/,
        /detect-hardcoded\.ts$/,
        /migrate-console-to-logger/,
        /scripts\//,
        /vitest/,
        /\.test\.ts$/,
        /\.spec\.ts$/,
      ],
    },
    magic_numbers: {
      patterns: [
        /\b\d{5,}\b/,
        /\b(3306|5432|6379|8080|3000|8000)\b/,
      ],
      severity: 'INFO',
      message: 'Potential magic number — consider using a named constant',
    },
    file_paths: {
      patterns: [
        /["']\/[a-zA-Z_]+\/[a-zA-Z_/]+["']/,
        /["']C:\\\\[^"']+["']/,
      ],
      severity: 'WARNING',
      message: 'Hardcoded file path detected',
    },
  };

  private readonly ALLOWED_VALUES: RegExp[] = [
    /["']true["']/,
    /["']false["']/,
    /["']null["']/,
    /["']undefined["']/,
    /["']["']/,
    /\b0\b/,
    /\b1\b/,
  ];

  private rootDir: string;
  public findings: HardcodedFinding[] = [];

  constructor(rootDir: string = '.') {
    this.rootDir = rootDir;
  }

  public scanFile(filePath: string): HardcodedFinding[] {
    const findings: HardcodedFinding[] = [];

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];

        if (line.trim().startsWith('//') || line.trim().startsWith('*') || line.trim().startsWith('/*')) {
          continue;
        }

        for (const [category, config] of Object.entries(this.DANGEROUS_PATTERNS)) {
          if (config.skipFiles && config.skipFiles.some(re => re.test(filePath))) {
            continue;
          }

          for (const pattern of config.patterns) {
            const matches = line.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'));
            for (const match of matches) {
              if (!match) continue;

              const matchedValue = match[0];

              if (this.ALLOWED_VALUES.some(allowed => allowed.test(matchedValue))) {
                continue;
              }

              if (config.exceptions && config.exceptions.some(exc => matchedValue.includes(exc))) {
                continue;
              }

              findings.push({
                file: filePath,
                line: lineNum + 1,
                column: match.index || 0,
                match: matchedValue.slice(0, 60),
                category: category as HardcodedFinding['category'],
                severity: config.severity,
                message: config.message,
              });
            }
          }
        }
      }
    } catch (_error: any) {
      // Skip files that can't be read
    }

    return findings;
  }

  public scanProject(): ScanResults {
    const allFindings: HardcodedFinding[] = [];
    let filesScanned = 0;

    const skipDirs = ['node_modules', '.git', 'dist', 'build', 'coverage', 'archive'];
    const pattern = path.join(this.rootDir, '**', '*.ts').replace(/\\/g, '/');
    const files = glob.sync(pattern, { ignore: skipDirs.map(d => `**/${d}/**`) });

    for (const file of files) {
      const findings = this.scanFile(file);
      allFindings.push(...findings);
      filesScanned++;
    }

    return {
      filesScanned,
      findings: allFindings,
      criticalCount: allFindings.filter(f => f.severity === 'CRITICAL').length,
      warningCount: allFindings.filter(f => f.severity === 'WARNING').length,
      infoCount: allFindings.filter(f => f.severity === 'INFO').length,
    };
  }
}

export function printResults(results: ScanResults): number {
  process.stdout.write(`Scanned ${results.filesScanned} files\n`);
  process.stdout.write(
    `Findings: ${results.criticalCount} critical, ` +
    `${results.warningCount} warnings, ${results.infoCount} info\n`,
  );

  if (results.findings.length > 0) {
    process.stdout.write('\nFindings:\n');
    const sortedFindings = [...results.findings].sort(
      (a, b) => severityOrder(a.severity) - severityOrder(b.severity),
    );
    for (const finding of sortedFindings) {
      process.stdout.write(`  [${finding.severity}] ${finding.file}:${finding.line}\n`);
      process.stdout.write(`         ${finding.message}: ${finding.match}\n`);
    }
  }

  return results.criticalCount > 0 ? 1 : 0;
}

function severityOrder(severity: string): number {
  const order = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  return order[severity as keyof typeof order] || 3;
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isDirectRun || process.argv[1]?.includes('detect-hardcoded')) {
  const detector = new HardcodedValueDetector();
  const results = detector.scanProject();
  const exitCode = printResults(results);
  process.exit(exitCode);
}

export default HardcodedValueDetector;

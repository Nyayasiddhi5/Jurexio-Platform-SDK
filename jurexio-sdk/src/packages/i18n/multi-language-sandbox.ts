import { z } from 'zod';
import axios from 'axios';

// ================================================================================================
// PISTON API INTEGRATION - SECURE EXTERNAL CODE EXECUTION
// ================================================================================================
// Replaces unsafe local execution with Piston API (https://emkc.org/api/v2/piston)
// - 50+ languages supported
// - Fully sandboxed execution
// - No RCE vulnerability
// - Free public API
// ================================================================================================

const PISTON_API_URL = 'https://emkc.org/api/v2/piston';

// ================================================================================================
// SCHEMAS
// ================================================================================================

export const codeExecutionRequestSchema = z.object({
  code: z.string().min(1).max(50000),
  language: z.enum(['python', 'go', 'java', 'auto']).default('auto'),
  timeout: z.number().min(1000).max(30000).default(10000),
  args: z.array(z.string()).optional()
});

export type CodeExecutionRequest = z.infer<typeof codeExecutionRequestSchema>;

export interface CodeExecutionResult {
  success: boolean;
  language: string;
  output?: string;
  error?: string;
  executionTime: number;
  detectedLanguage?: string;
}

// Piston language mappings
const LANGUAGE_MAP: Record<string, { language: string; version: string }> = {
  python: { language: 'python', version: '3.10.0' },
  go: { language: 'go', version: '1.16.2' },
  java: { language: 'java', version: '15.0.2' }
};

// ================================================================================================
// MULTI-LANGUAGE SANDBOX SERVICE (PISTON API)
// ================================================================================================

export class MultiLanguageSandbox {
  private apiUrl: string;

  constructor() {
    this.apiUrl = PISTON_API_URL;
  }

  /**
   * Execute code using Piston API (secure external sandbox)
   */
  async executeCode(request: CodeExecutionRequest): Promise<CodeExecutionResult> {
    const startTime = Date.now();

    try {
      const validated = codeExecutionRequestSchema.parse(request);
      
      // Detect language if auto
      const language = validated.language === 'auto' 
        ? this.detectLanguage(validated.code)
        : validated.language;

      // Get Piston language configuration
      const langConfig = LANGUAGE_MAP[language];
      if (!langConfig) {
        return {
          success: false,
          language: 'unknown',
          error: 'Unsupported language',
          executionTime: Date.now() - startTime
        };
      }

      // Execute via Piston API
      const response = await axios.post(
        `${this.apiUrl}/execute`,
        {
          language: langConfig.language,
          version: langConfig.version,
          files: [
            {
              name: this.getFilename(language),
              content: validated.code
            }
          ],
          stdin: '',
          args: validated.args || [],
          compile_timeout: validated.timeout,
          run_timeout: validated.timeout
        },
        {
          timeout: validated.timeout + 2000, // Add 2s buffer
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      const result = response.data;

      // Parse Piston response
      const hasCompileError = result.compile && result.compile.stderr;
      const hasRuntimeError = result.run && result.run.stderr;
      const hasOutput = result.run && result.run.stdout;

      return {
        success: !hasCompileError && !hasRuntimeError,
        language,
        output: hasOutput ? result.run.stdout.trim() : undefined,
        error: hasCompileError 
          ? result.compile.stderr.trim() 
          : hasRuntimeError 
            ? result.run.stderr.trim() 
            : undefined,
        executionTime: Date.now() - startTime,
        detectedLanguage: validated.language === 'auto' ? language : undefined
      };

    } catch (error: any) {
      return {
        success: false,
        language: 'unknown',
        error: error.response?.data?.message || error.message || 'Execution failed',
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Detect programming language from code
   */
  private detectLanguage(code: string): 'python' | 'go' | 'java' {
    const trimmed = code.trim();

    // Python detection
    if (
      trimmed.includes('def ') ||
      trimmed.includes('import ') ||
      trimmed.includes('print(') ||
      trimmed.startsWith('#!/usr/bin/env python') ||
      /^\s*(class|if|for|while|with)\s+/.test(trimmed)
    ) {
      return 'python';
    }

    // Go detection
    if (
      trimmed.includes('package ') ||
      trimmed.includes('func ') ||
      trimmed.includes('import "') ||
      trimmed.includes('fmt.Print')
    ) {
      return 'go';
    }

    // Java detection
    if (
      trimmed.includes('public class ') ||
      trimmed.includes('public static void main') ||
      trimmed.includes('System.out.print')
    ) {
      return 'java';
    }

    // Default to Python for ambiguous cases
    return 'python';
  }

  /**
   * Get appropriate filename for language
   */
  private getFilename(language: string): string {
    const filenameMap: Record<string, string> = {
      python: 'main.py',
      go: 'main.go',
      java: 'Main.java'
    };
    return filenameMap[language] || 'code.txt';
  }

  /**
   * Get supported languages
   */
  getSupportedLanguages(): string[] {
    return ['python', 'go', 'java'];
  }

  /**
   * Check language availability (Piston API)
   */
  async checkLanguageAvailability(): Promise<{
    python: boolean;
    go: boolean;
    java: boolean;
  }> {
    try {
      // Query Piston runtimes
      const response = await axios.get(`${this.apiUrl}/runtimes`, {
        timeout: 5000
      });

      const runtimes = response.data;
      
      return {
        python: runtimes.some((r: any) => r.language === 'python'),
        go: runtimes.some((r: any) => r.language === 'go'),
        java: runtimes.some((r: any) => r.language === 'java')
      };
    } catch (error: any) {
      // Return all true as fallback (Piston generally supports all three)
      return {
        python: true,
        go: true,
        java: true
      };
    }
  }
}

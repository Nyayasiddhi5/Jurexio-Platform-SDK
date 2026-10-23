import { randomUUID } from 'crypto';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  requestId?: string;
  [key: string]: any;
}

interface Logger {
  // Polymorphic: ('msg', ctx?) — preferred; ({ ctx }, 'msg'?) — pino-style; (err) — caught error
  trace(message?: unknown, data?: unknown): void;
  debug(message?: unknown, data?: unknown): void;
  info(message?: unknown, data?: unknown): void;
  warn(message?: unknown, data?: unknown): void;
  error(message?: unknown, data?: unknown): void;
  fatal(message?: unknown, data?: unknown): void;
  child(bindings: Record<string, any>): Logger;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const LEVEL_NAMES: Record<LogLevel, string> = {
  trace: 'TRACE',
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
  fatal: 'FATAL',
};

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

const COLOR_MAP: Record<LogLevel, string> = {
  trace: COLORS.gray,
  debug: COLORS.cyan,
  info: COLORS.blue,
  warn: COLORS.yellow,
  error: COLORS.red,
  fatal: COLORS.red,
};

class PinoLogger implements Logger {
  private service: string;
  private bindings: Record<string, any> = {};
  private isProduction: boolean;
  private minLevel: number;

  constructor(service: string = 'app', bindings: Record<string, any> = {}) {
    this.service = service;
    this.bindings = bindings;
    this.isProduction = process.env.NODE_ENV === 'production';
    const levelEnv = process.env.LOG_LEVEL || 'info';
    this.minLevel = LOG_LEVELS[levelEnv as LogLevel] || LOG_LEVELS.info;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= this.minLevel;
  }

  private formatJSON(entry: LogEntry): string {
    return JSON.stringify(entry);
  }

  private formatPretty(entry: LogEntry): string {
    const color = COLOR_MAP[entry.level];
    const levelStr = LEVEL_NAMES[entry.level];
    const timestamp = entry.timestamp;
    const service = entry.service;
    const message = entry.message;

    let output = `${color}${levelStr}${COLORS.reset} ${COLORS.dim}[${timestamp}]${COLORS.reset} ${COLORS.dim}(${service})${COLORS.reset} ${message}`;

    const { timestamp: _, level: __, service: ___, message: ____, requestId, ...rest } = entry;

    if (requestId) {
      output += ` ${COLORS.dim}[req: ${requestId}]${COLORS.reset}`;
    }

    if (Object.keys(rest).length > 0) {
      output += '\n' + COLORS.dim + JSON.stringify(rest, null, 2) + COLORS.reset;
    }

    return output;
  }

  private log(level: LogLevel, message: string, data?: Record<string, any>): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      message,
      ...this.bindings,
      ...data,
    };

    const output = this.isProduction ? this.formatJSON(entry) : this.formatPretty(entry);
    
    if (level === 'error' || level === 'fatal') {
      console.error(output);
    } else {
      console.log(output);
    }
  }

  // ── Polymorphic invocation: support both
  //   logger.warn('msg', { ctx })           — preferred (project convention)
  //   logger.warn({ ctx }, 'msg')           — pino-style (legacy callers)
  //   logger.warn({ ctx })                  — bare context (legacy callers)
  // We normalize to ('msg', ctx) before delegating to this.log().
  // Polymorphic invocation: support all of
  //   logger.warn('msg', { ctx })           — preferred
  //   logger.warn({ ctx }, 'msg')           — pino-style
  //   logger.warn({ ctx })                  — bare object
  //   logger.warn(err)                      — unknown (caught Error)
  private normalize(
    a: unknown,
    b: unknown,
  ): { message: string; data?: Record<string, any> } {
    if (typeof a === 'string') {
      const data = b && typeof b === 'object' ? (b as Record<string, any>) : undefined;
      return { message: a, data };
    }
    // Check Error BEFORE generic object so caught errors get a real message.
    if (a instanceof Error) {
      const data: Record<string, any> = { stack: a.stack, name: a.name };
      if (b && typeof b === 'object') Object.assign(data, b);
      else if (typeof b === 'string') data.note = b;
      return { message: a.message, data };
    }
    if (a && typeof a === 'object') {
      const message = typeof b === 'string' ? b : '';
      return { message, data: a as Record<string, any> };
    }
    if (a !== undefined) {
      return { message: String(a) };
    }
    return { message: '' };
  }

  trace(message?: unknown, data?: unknown): void {
    const { message: m, data: d } = this.normalize(message, data);
    this.log('trace', m, d);
  }

  debug(message?: unknown, data?: unknown): void {
    const { message: m, data: d } = this.normalize(message, data);
    this.log('debug', m, d);
  }

  info(message?: unknown, data?: unknown): void {
    const { message: m, data: d } = this.normalize(message, data);
    this.log('info', m, d);
  }

  warn(message?: unknown, data?: unknown): void {
    const { message: m, data: d } = this.normalize(message, data);
    this.log('warn', m, d);
  }

  error(message?: unknown, data?: unknown): void {
    const { message: m, data: d } = this.normalize(message, data);
    this.log('error', m, d);
  }

  fatal(message?: unknown, data?: unknown): void {
    const { message: m, data: d } = this.normalize(message, data);
    this.log('fatal', m, d);
  }

  child(bindings: Record<string, any>): Logger {
    return new PinoLogger(this.service, { ...this.bindings, ...bindings });
  }
}

/**
 * Factory function to create a logger instance for a specific service
 * @param service - Service name for log tagging
 * @returns Logger instance
 */
export function createLogger(service: string): Logger {
  return new PinoLogger(service);
}

/**
 * Default logger instance
 */
export const logger = createLogger('app');

export default logger;

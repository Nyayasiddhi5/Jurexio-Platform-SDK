/**
 * Vitest global test setup — Jurexio Enterprise Platform 3.1.2
 * Runs before all test suites to configure mocks and environment.
 */
import { vi, beforeAll, afterAll } from 'vitest';

// ── Environment defaults for test runs ───────────────────────────────────────
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || '';
process.env.JRX_JWT_SECRET = process.env.JRX_JWT_SECRET || 'test-secret-for-unit-tests-only-not-production';
process.env.JRX_JWT_REFRESH_SECRET = process.env.JRX_JWT_REFRESH_SECRET || 'test-refresh-secret-for-unit-tests-only';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai-key';

// ── Global db mock — prevents real DB connections in unit tests ───────────────
vi.mock('../src/db/index.js', () => ({
  db: {
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  },
}));

// ── Mock drizzle-orm sql tag ──────────────────────────────────────────────────
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual('drizzle-orm') as any;
  const sqlTag: any = vi.fn((strings: TemplateStringsArray, ...values: any[]) => ({ strings, values }));
  // sql.raw is used to inline validated identifiers (e.g. column names) that
  // cannot be parameterized — preserve the same shape so JSON inspection in
  // tests still finds the embedded text.
  sqlTag.raw = vi.fn((s: string) => ({ raw: s }));
  return {
    ...actual,
    sql: sqlTag,
    eq: vi.fn((a: any, b: any) => ({ type: 'eq', a, b })),
    and: vi.fn((...args: any[]) => ({ type: 'and', args })),
    or: vi.fn((...args: any[]) => ({ type: 'or', args })),
    desc: vi.fn((col: any) => ({ type: 'desc', col })),
    asc: vi.fn((col: any) => ({ type: 'asc', col })),
  };
});

// ── Mock OpenAI / OpenRouter calls ────────────────────────────────────────────
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'Mocked legal response for testing.' } }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        }),
      },
    },
  })),
}));

// ── Mock ioredis ──────────────────────────────────────────────────────────────
vi.mock('ioredis', () => ({
  Redis: vi.fn().mockImplementation(() => ({
    ping: vi.fn().mockResolvedValue('PONG'),
    incr: vi.fn().mockResolvedValue(1),
    decr: vi.fn().mockResolvedValue(0),
    del: vi.fn().mockResolvedValue(1),
    pexpire: vi.fn().mockResolvedValue(1),
    multi: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([[null, 1], [null, 1]]),
  })),
}));

beforeAll(async () => {
  // Global setup: nothing needed for unit tests
});

afterAll(async () => {
  vi.restoreAllMocks();
});

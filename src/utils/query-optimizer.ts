import { cacheManager } from './cache-manager.js';
import { createLogger } from './logger.js';


const logger = createLogger('query-optimizer');

interface QueryOptions {
  cacheKey?: string;
  cacheTtlMs?: number;
  timeoutMs?: number;
}

interface QueryItem {
  sql: string;
  params?: any[];
}

interface PaginatedResult<T = any> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function optimizedQuery(
  pool: any,
  sql: string,
  params?: any[],
  options?: QueryOptions
): Promise<any> {
  const { cacheKey, cacheTtlMs, timeoutMs = 30000 } = options ?? {};

  if (cacheKey) {
    const cached = cacheManager.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
  }

  const client = await pool.connect();
  const start = Date.now();

  try {
    await client.query(`SET statement_timeout = ${timeoutMs}`);
    const result = await client.query(sql, params);
    const duration = Date.now() - start;

    if (duration > 1000) {
      logger.warn(
        `[SLOW QUERY] ${duration}ms | ${sql.substring(0, 200)}${sql.length > 200 ? '...' : ''}`
      );
    }

    if (cacheKey) {
      cacheManager.set(cacheKey, result, cacheTtlMs);
    }

    return result;
  } finally {
    await client.query('RESET statement_timeout').catch(() => {});
    client.release();
  }
}

export async function batchQuery(
  pool: any,
  queries: QueryItem[]
): Promise<any[]> {
  const client = await pool.connect();
  const results: any[] = [];

  try {
    await client.query('BEGIN');

    for (const q of queries) {
      const result = await client.query(q.sql, q.params);
      results.push(result);
    }

    await client.query('COMMIT');
    return results;
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function paginateQuery<T = any>(
  pool: any,
  baseSql: string,
  params: any[],
  page: number,
  pageSize: number
): Promise<PaginatedResult<T>> {
  const safePage = Math.max(1, page);
  const safePageSize = Math.max(1, Math.min(pageSize, 1000));
  const offset = (safePage - 1) * safePageSize;

  const countSql = `SELECT COUNT(*) AS total FROM (${baseSql}) AS _count_query`;
  const dataSql = `${baseSql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

  const client = await pool.connect();
  try {
    const [countResult, dataResult] = await Promise.all([
      client.query(countSql, params),
      client.query(dataSql, [...params, safePageSize, offset]),
    ]);

    const total = parseInt(countResult.rows[0]?.total ?? '0', 10);

    return {
      data: dataResult.rows as T[],
      total,
      page: safePage,
      pageSize: safePageSize,
      totalPages: Math.ceil(total / safePageSize),
    };
  } finally {
    client.release();
  }
}

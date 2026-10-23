import { createLogger } from '../utils/logger.js';

const logger = createLogger('database');

export async function initializeDatabase(): Promise<void> {
  logger.info('🔌 Connecting to database...');
  if (!process.env.DATABASE_URL) {
    logger.info('⚠️ DATABASE_URL not set - using in-memory storage');
  }
}

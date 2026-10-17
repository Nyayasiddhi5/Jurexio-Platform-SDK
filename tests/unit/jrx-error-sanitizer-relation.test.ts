import { describe, expect, it } from 'vitest';
import { sanitizeErrorForClient } from '../../src/utils/error-sanitizer.js';

describe('sanitizeErrorForClient — relation vs correlationId', () => {
  it('does not map correlationId validation errors to System configuration error', () => {
    expect(sanitizeErrorForClient(new Error('correlationId is required'))).toBe(
      'correlationId is required',
    );
    expect(sanitizeErrorForClient(new Error('orgId is required'))).toBe('orgId is required');
  });

  it('still maps Postgres missing-relation messages', () => {
    expect(
      sanitizeErrorForClient(new Error('relation "nv_schema.async_job_queue" does not exist')),
    ).toBe('System configuration error');
    expect(sanitizeErrorForClient(new Error('42P01: undefined_table'))).toBe(
      'System configuration error',
    );
  });
});

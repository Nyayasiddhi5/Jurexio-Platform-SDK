import { describe, expect, it } from 'vitest';
import { evaluateSafeCalculatorExpression } from '../../src/utils/jrx-safe-calculator.js';

describe('evaluateSafeCalculatorExpression', () => {
  it('evaluates basic arithmetic', () => {
    expect(evaluateSafeCalculatorExpression('2+3*4')).toBe(14);
    expect(evaluateSafeCalculatorExpression('(1+2)/3')).toBe(1);
  });

  it('rejects unsafe input', () => {
    expect(evaluateSafeCalculatorExpression('process.exit()')).toBeNull();
    expect(evaluateSafeCalculatorExpression('1;2')).toBeNull();
  });
});

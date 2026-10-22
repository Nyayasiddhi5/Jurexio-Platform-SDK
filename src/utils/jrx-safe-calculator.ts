/**
 * Allowlisted arithmetic for tool/calculator paths — no Function/eval.
 * Supports non-negative numbers, + - * / ( ) and unary minus on numbers.
 */
export function evaluateSafeCalculatorExpression(raw: string): number | null {
  const expr = String(raw ?? '').trim();
  if (!expr || expr.length > 200) return null;
  if (!/^[\d+\-*/().\s]+$/.test(expr)) return null;

  let i = 0;
  const s = expr.replace(/\s/g, '');

  function peek(): string {
    return s[i] ?? '';
  }
  function consume(): string {
    return s[i++] ?? '';
  }

  function parseNumber(): number | null {
    let start = i;
    if (peek() === '-') consume();
    while (/[\d.]/.test(peek())) consume();
    if (i === start || (i === start + 1 && s[start] === '-')) return null;
    const n = Number(s.slice(start, i));
    return Number.isFinite(n) ? n : null;
  }

  function parseFactor(): number | null {
    if (peek() === '(') {
      consume();
      const v = parseExpr();
      if (peek() !== ')') return null;
      consume();
      return v;
    }
    return parseNumber();
  }

  function parseTerm(): number | null {
    let left = parseFactor();
    if (left === null) return null;
    while (peek() === '*' || peek() === '/') {
      const op = consume();
      const right = parseFactor();
      if (right === null) return null;
      if (op === '*') left *= right;
      else {
        if (right === 0) return null;
        left /= right;
      }
    }
    return left;
  }

  function parseExpr(): number | null {
    let left = parseTerm();
    if (left === null) return null;
    while (peek() === '+' || peek() === '-') {
      const op = consume();
      const right = parseTerm();
      if (right === null) return null;
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  const result = parseExpr();
  if (result === null || i !== s.length) return null;
  return result;
}

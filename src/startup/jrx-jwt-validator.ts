/**
 * JWT Secret Validator for Jurexio Legal SDK
 * Validates JWT secret strength and compliance at server startup
 */

interface JwtValidationResult {
  isValid: boolean;
  message: string;
}

const DEV_SECRET = 'development-secret-key-change-in-production';
const MIN_SECRET_LENGTH = 64;

export function validateJwtSecret(): JwtValidationResult {
  const jwtSecret = process.env.JWT_SECRET;
  const env = process.env.NODE_ENV || 'development';
  const messages: string[] = [];

  // Check if JWT_SECRET exists
  if (!jwtSecret) {
    const message = 'JWT_SECRET is not set';
    if (env === 'production') {
      messages.push(`❌ CRITICAL: ${message}`);
      return {
        isValid: false,
        message: messages.join('\n')
      };
    } else {
      messages.push(`⚠️ WARNING: ${message} - using default development secret`);
    }
  } else {
    // Check if using default dev secret in production
    if (jwtSecret === DEV_SECRET && env === 'production') {
      const message = `❌ CRITICAL: JWT_SECRET is using default development secret in production`;
      messages.push(`${message}\n   This is a critical security vulnerability.`);
      messages.push(`   Set JWT_SECRET to a strong random string (>= ${MIN_SECRET_LENGTH} characters).`);
      return {
        isValid: false,
        message: messages.join('\n')
      };
    }

    // Check secret length
    if (jwtSecret.length < MIN_SECRET_LENGTH) {
      const severity = env === 'production' ? '❌ CRITICAL' : '⚠️ WARNING';
      const suffix = env === 'production' ? ' - server will not start' : ' - consider rotating';
      messages.push(`${severity}: JWT_SECRET is too short (${jwtSecret.length}/${MIN_SECRET_LENGTH} chars)${suffix}`);

      if (env === 'production') {
        return {
          isValid: false,
          message: messages.join('\n')
        };
      }
    } else {
      messages.push(`✅ JWT_SECRET length is valid (${jwtSecret.length}/${MIN_SECRET_LENGTH} chars)`);
    }

    // Check for special characters for entropy
    const hasSpecialChars = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(jwtSecret);
    const hasNumbers = /\d/.test(jwtSecret);
    const hasUpperCase = /[A-Z]/.test(jwtSecret);
    const hasLowerCase = /[a-z]/.test(jwtSecret);

    const entropy = [hasSpecialChars, hasNumbers, hasUpperCase, hasLowerCase].filter(Boolean).length;

    if (entropy < 3) {
      const severity = env === 'production' ? '❌ CRITICAL' : '⚠️ WARNING';
      messages.push(
        `${severity}: JWT_SECRET has low entropy (${entropy}/4 character types).`
      );
      messages.push(`   Recommended: Use mix of uppercase, lowercase, numbers, and special characters.`);

      if (env === 'production' && entropy < 2) {
        return {
          isValid: false,
          message: messages.join('\n')
        };
      }
    }
  }

  const isValid = !messages.some((msg) => msg.startsWith('❌ CRITICAL'));

  if (messages.length === 0) {
    messages.push('✅ JWT_SECRET is properly configured with strong security');
  }

  return {
    isValid,
    message: messages.join('\n')
  };
}

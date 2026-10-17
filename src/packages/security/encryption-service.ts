/**
 * Encryption Service for Production Security
 * Handles API key encryption, password hashing, and data security
 */
import crypto from 'crypto';
const bcrypt = { hash: async (p: string, s: number) => crypto.createHash('sha256').update(p).digest('hex'), compare: async (p: string, h: string) => crypto.createHash('sha256').update(p).digest('hex') === h, genSalt: async (r: number) => 'salt' };

export class EncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly secretKey: string;

  constructor() {
    // Require encryption key from environment in production
    if (process.env.NODE_ENV === 'production' && !process.env.ENCRYPTION_KEY) {
      throw new Error('ENCRYPTION_KEY environment variable is required in production');
    }
    this.secretKey = process.env.ENCRYPTION_KEY || this.generateSecretKey();
    
    // Validate key format on startup
    this.validateEncryptionKey();
  }

  /**
   * Generate a secret key for encryption
   */
  private generateSecretKey(): string {
    // Generate a proper 32-byte (256-bit) key for AES-256
    return crypto.randomBytes(32).toString('hex');
  }

  private validateEncryptionKey(): void {
    try {
      const key = this.getValidatedKey();
      if (key.length !== 32) {
        throw new Error('Invalid key length');
      }
    } catch (error: any) {
      throw new Error(`Invalid ENCRYPTION_KEY format: must be 64-character hex string (32 bytes)`);
    }
  }

  private getValidatedKey(): Buffer {
    // Support both hex and base64 formats
    let key: Buffer;
    
    if (this.secretKey.length === 64) {
      // Hex format (64 chars = 32 bytes)
      key = Buffer.from(this.secretKey, 'hex');
    } else if (this.secretKey.length === 44 || this.secretKey.length === 43) {
      // Base64 format (44 chars with padding or 43 without)
      key = Buffer.from(this.secretKey, 'base64');
    } else {
      throw new Error('Invalid encryption key format');
    }
    
    if (key.length !== 32) {
      throw new Error('Encryption key must be exactly 32 bytes');
    }
    
    return key;
  }

  /**
   * Hash password using bcrypt
   */
  async hashPassword(password: string): Promise<string> {
    const saltRounds = 12;
    return await bcrypt.hash(password, saltRounds);
  }

  /**
   * Verify password against hash
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return await bcrypt.compare(password, hash);
  }

  /**
   * Encrypt sensitive data (API keys, tokens, etc.)
   */
  async encrypt(text: string): Promise<string> {
    try {
      const iv = crypto.randomBytes(12); // 12 bytes for GCM
      const key = this.getValidatedKey(); // Get validated 32-byte key
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const authTag = cipher.getAuthTag();
      
      return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
    } catch (error: any) {
      throw new Error('Encryption failed');
    }
  }

  /**
   * Decrypt sensitive data
   */
  async decrypt(encryptedText: string): Promise<string> {
    try {
      const textParts = encryptedText.split(':');
      if (textParts.length !== 3) {
        throw new Error('Invalid encrypted data format');
      }
      
      const iv = Buffer.from(textParts[0], 'hex');
      const authTag = Buffer.from(textParts[1], 'hex');
      const encrypted = textParts[2];
      const key = this.getValidatedKey(); // Get validated 32-byte key

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error: any) {
      throw new Error('Decryption failed');
    }
  }

  /**
   * Generate secure random token
   */
  generateSecureToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Hash data with SHA-256
   */
  hashData(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Generate API key
   */
  generateApiKey(): string {
    const prefix = 'nyayavigya_';
    const keyLength = 32;
    const randomBytes = crypto.randomBytes(keyLength);
    return prefix + randomBytes.toString('hex');
  }

  /**
   * Validate API key format
   */
  isValidApiKey(apiKey: string): boolean {
    return /^nyayavigya_[a-f0-9]{64}$/.test(apiKey);
  }
}

export const encryptionService = new EncryptionService();
/**
 * Jurexio Enterprise Platform SDK v5.0.0 Security Package
 *
 * Enterprise-grade security services including:
 * - Encryption and data protection
 * - Enterprise security framework
 * - Quantum-safe security
 * - Security auditing and monitoring
 * - Dependency scanning
 * - OWASP LLM vulnerability protection
 */

export * from './encryption-service.js';
export * from './enterprise-security-framework.js';
export * from './quantum-security-framework.js';
export * from './quantum-security-wiring-service.js';
export { SecurityAuditService } from './security-audit-service.js';
export * from './security-audit-persistence-service.js';
export * from './security-mcp-tools.js';
export * from './dependency-scanner.js';
export * from './jurexio-comprehensive-security-integration.js';
export * from './jurexio-security-monitoring-system.js';

export const securityPackageInfo = {
  name: 'jurexio-sdk-security',
  version: '3.1.0',
  services: [
    'encryption-service',
    'enterprise-security-framework',
    'quantum-security-framework',
    'quantum-security-wiring-service',
    'security-audit-service',
    'security-audit-persistence-service',
    'security-mcp-tools',
    'dependency-scanner',
    'jurexio-comprehensive-security-integration',
    'jurexio-security-monitoring-system'
  ],
  capabilities: [
    'Data Encryption',
    'Enterprise Security Framework',
    'Quantum-Safe Cryptography',
    'OWASP LLM Vulnerability Detection',
    'Security Auditing',
    'Compliance Reporting',
    'Dependency Scanning',
    'Real-time Security Monitoring'
  ]
};

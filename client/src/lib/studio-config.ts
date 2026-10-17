/**
 * Studio Configuration
 * Centralized studio metadata and mappings
 */

export const STUDIO_NAMES: Record<string, string> = {
  'ideation-lab': 'Ideation Lab',
  'engineering-forge': 'Engineering Forge',
  'market-intelligence': 'Market Intelligence',
  'product-blueprint': 'Product Blueprint',
  'experience-design': 'Experience Design',
  'quality-assurance-lab': 'Quality Assurance Lab',
  'growth-engine': 'Growth Engine',
  'launch-command': 'Launch Command',
  'operations-hub': 'Operations Hub',
  'deployment-studio': 'Deployment Studio',
};

export const STUDIO_ROUTES: Record<string, string> = {
  'ideation-lab': '/studios/ideation-lab',
  'engineering-forge': '/studios/engineering-forge',
  'market-intelligence': '/studios/market-intelligence',
  'product-blueprint': '/studios/product-blueprint',
  'experience-design': '/studios/experience-design',
  'quality-assurance-lab': '/studios/quality-assurance-lab',
  'growth-engine': '/studios/growth-engine',
  'launch-command': '/studios/launch-command',
  'operations-hub': '/studios/operations-hub',
  'deployment-studio': '/studios/deployment-studio',
};

export const STUDIO_DESCRIPTIONS: Record<string, string> = {
  'ideation-lab': 'Validate and refine your startup idea with AI-powered market analysis',
  'engineering-forge': 'Transform designs into production-ready code with 267+ AI agents',
  'market-intelligence': 'Deep competitive analysis and market opportunity assessment',
  'product-blueprint': 'Comprehensive product specifications and technical architecture',
  'experience-design': 'User-centered design and interface prototyping',
  'quality-assurance-lab': 'Automated testing and quality validation',
  'growth-engine': 'Growth strategy, marketing plan, and user acquisition',
  'launch-command': 'Launch coordination and go-to-market execution',
  'operations-hub': 'Operational systems, processes, and infrastructure',
  'deployment-studio': 'Production deployment and scaling infrastructure',
};

export function getStudioName(studioId: string): string {
  return STUDIO_NAMES[studioId] || studioId;
}

export function getStudioRoute(studioId: string): string {
  return STUDIO_ROUTES[studioId] || `/studios/${studioId}`;
}

export function getStudioDescription(studioId: string): string {
  return STUDIO_DESCRIPTIONS[studioId] || '';
}

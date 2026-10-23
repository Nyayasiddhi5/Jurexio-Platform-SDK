/**
 * Jurexio Enterprise Platform — brand tokens (console + marketing).
 */
export const BRAND = {
  primary: '#152448',
  accent: '#C7B15B',
  sidebar: '#2B384C',
  cream: '#F7F3EA',
  page: '#F9FAFB',
  surface: '#FFFFFF',
  textPrimary: '#152448',
  textSecondary: '#61697D',
  border: '#E4E7EC',
  success: '#158E54',
  warning: '#DE8E19',
  error: '#CC2C2C',
  info: '#2174D3',
  primarySoft: '#EEF1F6',
  accentSoft: '#F7F3E6',
  successSoft: '#E7F3EC',
} as const;

export const BRAND_FONTS = {
  heading: "Merriweather, Georgia, 'Times New Roman', serif",
  body: "Inter, system-ui, -apple-system, sans-serif",
} as const;

export const BRAND_LOGO = {
  lockup: '/jurexio-logo.png',
  icon: '/jurexio-icon.png',
  jpegFallback: '/images/jurexio-logo.jpeg',
  tagline: 'Global legal intelligence. Enterprise precision.',
  productName: 'Jurexio Enterprise Platform',
} as const;

export type BrandColor = (typeof BRAND)[keyof typeof BRAND];

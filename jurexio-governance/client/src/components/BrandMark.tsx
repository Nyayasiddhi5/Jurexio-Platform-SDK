import { cn } from '@/lib/utils';
import { BRAND_LOGO } from '@/lib/brand';

type BrandMarkProps = {
  /** icon = compact mark; lockup = wordmark asset when present */
  variant?: 'icon' | 'lockup';
  className?: string;
  imgClassName?: string;
  alt?: string;
  showWordmark?: boolean;
  wordmarkClassName?: string;
  tagline?: boolean;
  inverted?: boolean;
};

/**
 * Canonical Jurexio logo mark for Console / LegalChat shells.
 */
export function BrandMark({
  variant = 'icon',
  className,
  imgClassName,
  alt = BRAND_LOGO.productName,
  showWordmark = false,
  wordmarkClassName,
  tagline = false,
  inverted = false,
}: BrandMarkProps) {
  const src = variant === 'lockup' ? BRAND_LOGO.lockup : BRAND_LOGO.icon;
  return (
    <div className={cn('flex items-center gap-2 min-w-0', className)}>
      <img
        src={src}
        alt={alt}
        className={cn('object-contain flex-shrink-0', imgClassName ?? 'h-8 w-8')}
        onError={(e) => {
          const el = e.currentTarget;
          if (el.src.includes('nyayasiddhi-icon')) {
            el.src = BRAND_LOGO.lockup;
          } else if (!el.src.includes('jpeg')) {
            el.src = BRAND_LOGO.jpegFallback;
          }
        }}
      />
      {showWordmark ? (
        <div className="min-w-0 text-left">
          <div
            className={cn(
              'font-heading font-bold tracking-wide truncate leading-tight uppercase',
              inverted ? 'text-white' : 'text-royal-blue',
              wordmarkClassName ?? 'text-sm',
            )}
          >
            {BRAND_LOGO.productName}
          </div>
          {tagline ? (
            <div
              className={cn(
                'text-[10px] truncate leading-tight',
                inverted ? 'text-gold' : 'text-[#C7B15B]',
              )}
            >
              {BRAND_LOGO.tagline}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default BrandMark;

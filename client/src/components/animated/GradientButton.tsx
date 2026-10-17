import { forwardRef } from 'react';
import { Button, ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface GradientButtonProps extends ButtonProps {
  gradient?: 'primary' | 'accent' | 'success';
}

export const GradientButton = forwardRef<HTMLButtonElement, GradientButtonProps>(
  ({ gradient = 'primary', className, children, ...props }, ref) => {
    const gradients = {
      primary: 'gradient-primary text-white',
      accent: 'gradient-accent text-white',
      success: 'gradient-success text-white'
    };

    return (
      <Button
        ref={ref}
        className={cn(gradients[gradient], 'shadow-lg hover:shadow-xl transition-all', className)}
        {...props}
      >
        {children}
      </Button>
    );
  }
);

GradientButton.displayName = 'GradientButton';

import { Button, ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { forwardRef, type ReactNode } from "react";

interface CrosshairButtonProps extends ButtonProps {
  children: ReactNode;
}

const CrosshairButton = forwardRef<HTMLButtonElement, CrosshairButtonProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <Button
        ref={ref}
        className={cn(
          "crosshair-button relative overflow-hidden",
          "before:absolute before:inset-0 before:bg-gradient-to-r before:from-transparent before:via-white/10 before:to-transparent",
          "before:translate-x-[-100%] hover:before:translate-x-[100%] before:transition-transform before:duration-700",
          className
        )}
        {...props}
      >
        {children}
      </Button>
    );
  }
);

CrosshairButton.displayName = "CrosshairButton";

export default CrosshairButton;

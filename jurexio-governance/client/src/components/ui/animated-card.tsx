import { cn } from "@/lib/utils";
import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

interface AnimatedCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  hoverScale?: boolean;
  hoverGlow?: boolean;
}

const AnimatedCard = forwardRef<HTMLDivElement, AnimatedCardProps>(
  ({ className, children, hoverScale = true, hoverGlow = false, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-xl transition-all duration-300 ease-out",
          hoverScale && "hover:scale-[1.02] hover:-translate-y-1",
          hoverGlow && "hover:shadow-2xl hover:shadow-primary/25",
          "hover:shadow-lg",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);

AnimatedCard.displayName = "AnimatedCard";

export default AnimatedCard;

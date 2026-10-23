import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface SplitTextProps {
  text: string;
  className?: string;
  delay?: number;
  stagger?: number;
}

const SplitText: React.FC<SplitTextProps> = ({
  text,
  className,
  delay = 0,
  stagger = 50,
}) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, delay);

    return () => clearTimeout(timer);
  }, [delay]);

  return (
    <span className={cn("inline-block", className)}>
      {text.split("").map((char, index) => (
        <span
          key={index}
          className={cn(
            "split-text-char inline-block",
            isVisible && "animate-in"
          )}
          style={{
            animationDelay: `${index * stagger}ms`,
            animationFillMode: "forwards",
          }}
        >
          {char === " " ? "\u00A0" : char}
        </span>
      ))}
    </span>
  );
};

export default SplitText;

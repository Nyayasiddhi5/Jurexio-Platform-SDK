import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface HyperspeedTextProps {
  text: string;
  className?: string;
  delay?: number;
  speed?: number;
}

const HyperspeedText: React.FC<HyperspeedTextProps> = ({
  text,
  className,
  delay = 0,
  speed = 50,
}) => {
  const [displayedText, setDisplayedText] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (currentIndex < text.length) {
        setDisplayedText(text.slice(0, currentIndex + 1));
        setCurrentIndex(currentIndex + 1);
      }
    }, speed);

    return () => clearTimeout(timer);
  }, [currentIndex, text, speed]);

  useEffect(() => {
    const delayTimer = setTimeout(() => {
      setCurrentIndex(0);
      setDisplayedText("");
    }, delay);

    return () => clearTimeout(delayTimer);
  }, [delay]);

  return (
    <span className={cn("hyperspeed-text", className)}>
      {displayedText}
      {currentIndex < text.length && (
        <span className="animate-pulse">|</span>
      )}
    </span>
  );
};

export default HyperspeedText;

import { useState, useCallback, TouchEvent } from "react";

interface SwipeConfig {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  minSwipeDistance?: number;
  enableHaptics?: boolean;
}

// Trigger haptic feedback if available
function triggerHaptic(intensity: "light" | "medium" | "heavy" = "light") {
  if ("vibrate" in navigator) {
    const durations = { light: 10, medium: 20, heavy: 30 };
    navigator.vibrate(durations[intensity]);
  }
}

export function useSwipe({ 
  onSwipeLeft, 
  onSwipeRight, 
  minSwipeDistance = 50,
  enableHaptics = true 
}: SwipeConfig) {
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);

  const onTouchStart = useCallback((e: TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  }, []);

  const onTouchMove = useCallback((e: TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  }, []);

  const onTouchEnd = useCallback(() => {
    if (!touchStart || !touchEnd) return;
    
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;
    
    if (isLeftSwipe && onSwipeLeft) {
      if (enableHaptics) triggerHaptic("light");
      onSwipeLeft();
    }
    if (isRightSwipe && onSwipeRight) {
      if (enableHaptics) triggerHaptic("light");
      onSwipeRight();
    }
  }, [touchStart, touchEnd, minSwipeDistance, onSwipeLeft, onSwipeRight, enableHaptics]);

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
  };
}

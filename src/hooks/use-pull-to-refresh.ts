import { useState, useCallback, useRef, TouchEvent } from "react";

interface PullToRefreshConfig {
  onRefresh: () => Promise<void>;
  threshold?: number;
  maxPull?: number;
}

export function usePullToRefresh({ 
  onRefresh, 
  threshold = 80,
  maxPull = 120 
}: PullToRefreshConfig) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const scrollTop = useRef<number>(0);

  const onTouchStart = useCallback((e: TouchEvent) => {
    // Only enable pull-to-refresh when scrolled to top
    const target = e.currentTarget as HTMLElement;
    scrollTop.current = target.scrollTop;
    
    if (scrollTop.current <= 0) {
      startY.current = e.touches[0].clientY;
    }
  }, []);

  const onTouchMove = useCallback((e: TouchEvent) => {
    if (startY.current === null || isRefreshing) return;
    if (scrollTop.current > 0) return;

    const currentY = e.touches[0].clientY;
    const diff = currentY - startY.current;

    if (diff > 0) {
      // Apply resistance to pull
      const resistance = 0.5;
      const pull = Math.min(diff * resistance, maxPull);
      setPullDistance(pull);
    }
  }, [isRefreshing, maxPull]);

  const onTouchEnd = useCallback(async () => {
    if (startY.current === null) return;

    if (pullDistance >= threshold && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(threshold / 2); // Keep some distance while refreshing
      
      // Haptic feedback
      if ("vibrate" in navigator) {
        navigator.vibrate(15);
      }

      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }

    startY.current = null;
  }, [pullDistance, threshold, isRefreshing, onRefresh]);

  return {
    pullDistance,
    isRefreshing,
    handlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
    },
  };
}

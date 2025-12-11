import { ReactNode, useMemo, useState, useEffect, useCallback } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { ThemeToggle } from "./ThemeToggle";
import { ScrollToTop } from "./ScrollToTop";
import { useSwipe } from "@/hooks/use-swipe";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { MobileBottomNav } from "./MobileBottomNav";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

export interface DashboardLayoutProps {
  children: ReactNode;
  activeSection: string;
  onSectionChange: (section: string) => void;
  isAdmin?: boolean;
  isDemoMode?: boolean;
  onRefresh?: () => Promise<void>;
}

// Main navigation sections in order
const MAIN_SECTIONS = [
  "search",
  "docs",
  "keys",
  "test",
  "sdk",
  "embed",
  "matches",
  "analytics",
  "webhooks",
  "webhook-debugger",
  "audit-logs",
];

export function DashboardLayout({ 
  children, 
  activeSection, 
  onSectionChange, 
  isAdmin, 
  isDemoMode,
  onRefresh 
}: DashboardLayoutProps) {
  const isMobile = useIsMobile();
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionDirection, setTransitionDirection] = useState<"left" | "right" | null>(null);
  const [prevSection, setPrevSection] = useState(activeSection);

  // Default refresh handler - just wait a bit to simulate refresh
  const handleRefresh = useCallback(async () => {
    if (onRefresh) {
      await onRefresh();
    } else {
      // Default: wait 500ms to simulate refresh
      await new Promise(resolve => setTimeout(resolve, 500));
      // Trigger a re-render by dispatching a custom event
      window.dispatchEvent(new CustomEvent('dashboard-refresh'));
    }
  }, [onRefresh]);

  const { pullDistance, isRefreshing, handlers: pullHandlers } = usePullToRefresh({
    onRefresh: handleRefresh,
    threshold: 60,
  });

  // Track section changes for animations
  useEffect(() => {
    if (prevSection !== activeSection) {
      const prevIndex = MAIN_SECTIONS.indexOf(prevSection);
      const newIndex = MAIN_SECTIONS.indexOf(activeSection);
      
      if (prevIndex >= 0 && newIndex >= 0) {
        setTransitionDirection(newIndex > prevIndex ? "left" : "right");
        setIsTransitioning(true);
        
        const timer = setTimeout(() => {
          setIsTransitioning(false);
          setTransitionDirection(null);
        }, 200);
        
        return () => clearTimeout(timer);
      }
      setPrevSection(activeSection);
    }
  }, [activeSection, prevSection]);

  const { currentIndex, canSwipeLeft, canSwipeRight } = useMemo(() => {
    const idx = MAIN_SECTIONS.indexOf(activeSection);
    return {
      currentIndex: idx >= 0 ? idx : 0,
      canSwipeLeft: idx < MAIN_SECTIONS.length - 1,
      canSwipeRight: idx > 0,
    };
  }, [activeSection]);

  const handleSwipeLeft = () => {
    if (canSwipeLeft) {
      onSectionChange(MAIN_SECTIONS[currentIndex + 1]);
    }
  };

  const handleSwipeRight = () => {
    if (canSwipeRight) {
      onSectionChange(MAIN_SECTIONS[currentIndex - 1]);
    }
  };

  const swipeHandlers = useSwipe({
    onSwipeLeft: handleSwipeLeft,
    onSwipeRight: handleSwipeRight,
    minSwipeDistance: 75,
    enableHaptics: true,
  });

  // Combine touch handlers
  const combinedTouchHandlers = isMobile ? {
    onTouchStart: (e: React.TouchEvent) => {
      swipeHandlers.onTouchStart(e);
      pullHandlers.onTouchStart(e);
    },
    onTouchMove: (e: React.TouchEvent) => {
      swipeHandlers.onTouchMove(e);
      pullHandlers.onTouchMove(e);
    },
    onTouchEnd: () => {
      swipeHandlers.onTouchEnd();
      pullHandlers.onTouchEnd();
    },
  } : {};

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background overflow-hidden">
        <AppSidebar 
          activeSection={activeSection} 
          onSectionChange={onSectionChange}
          isAdmin={isAdmin}
          isDemoMode={isDemoMode}
        />
        <main className="flex-1 overflow-x-hidden overflow-y-auto">
          <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-sm">
            <div className="flex h-12 items-center justify-between px-3 sm:px-4">
              <SidebarTrigger />
              <div className="flex items-center gap-2">
                {/* Mobile swipe indicator */}
                {isMobile && MAIN_SECTIONS.includes(activeSection) && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    {canSwipeRight && <span>←</span>}
                    <span className="px-1">{currentIndex + 1}/{MAIN_SECTIONS.length}</span>
                    {canSwipeLeft && <span>→</span>}
                  </div>
                )}
                <ThemeToggle />
              </div>
            </div>
          </header>
          
          {/* Pull to refresh indicator */}
          {isMobile && (pullDistance > 0 || isRefreshing) && (
            <div 
              className="flex items-center justify-center overflow-hidden transition-all bg-muted/50"
              style={{ height: pullDistance }}
            >
              <div className={cn(
                "flex items-center gap-2 text-sm text-muted-foreground",
                isRefreshing && "animate-pulse"
              )}>
                <Loader2 className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
                <span>{isRefreshing ? "Refreshing..." : "Pull to refresh"}</span>
              </div>
            </div>
          )}
          
          <div 
            className={cn(
              "max-w-6xl py-4 sm:py-6 px-3 sm:px-6 transition-all duration-200 ease-out w-full overflow-hidden",
              isTransitioning && transitionDirection === "left" && "animate-slide-in-left",
              isTransitioning && transitionDirection === "right" && "animate-slide-in-right",
              // Add bottom padding on mobile for bottom nav
              isMobile && "pb-20"
            )}
            {...combinedTouchHandlers}
          >
            {children}
          </div>
        </main>
        
        {/* Mobile bottom navigation */}
        {isMobile && (
          <MobileBottomNav 
            activeSection={activeSection}
            onSectionChange={onSectionChange}
            isDemoMode={isDemoMode}
          />
        )}
        
        {/* Scroll to top button */}
        <ScrollToTop />
      </div>
    </SidebarProvider>
  );
}
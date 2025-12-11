import { ReactNode, useMemo } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { ThemeToggle } from "./ThemeToggle";
import { useSwipe } from "@/hooks/use-swipe";
import { useIsMobile } from "@/hooks/use-mobile";

export interface DashboardLayoutProps {
  children: ReactNode;
  activeSection: string;
  onSectionChange: (section: string) => void;
  isAdmin?: boolean;
  isDemoMode?: boolean;
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

export function DashboardLayout({ children, activeSection, onSectionChange, isAdmin, isDemoMode }: DashboardLayoutProps) {
  const isMobile = useIsMobile();

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
  });

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar 
          activeSection={activeSection} 
          onSectionChange={onSectionChange}
          isAdmin={isAdmin}
          isDemoMode={isDemoMode}
        />
        <main className="flex-1 overflow-auto">
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
          <div 
            className="max-w-6xl py-4 sm:py-6 px-3 sm:px-6"
            {...(isMobile ? swipeHandlers : {})}
          >
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
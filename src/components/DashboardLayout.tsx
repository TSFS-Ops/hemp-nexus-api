import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { ThemeToggle } from "./ThemeToggle";

export interface DashboardLayoutProps {
  children: ReactNode;
  activeSection: string;
  onSectionChange: (section: string) => void;
  isAdmin?: boolean;
  isDemoMode?: boolean;
}

export function DashboardLayout({ children, activeSection, onSectionChange, isAdmin, isDemoMode }: DashboardLayoutProps) {
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
              <ThemeToggle />
            </div>
          </header>
          <div className="max-w-6xl py-4 sm:py-6 px-3 sm:px-6">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
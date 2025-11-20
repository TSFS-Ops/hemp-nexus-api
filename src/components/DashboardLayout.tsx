import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { ThemeToggle } from "./ThemeToggle";

interface DashboardLayoutProps {
  children: ReactNode;
  activeSection: string;
  onSectionChange: (section: string) => void;
  isAdmin?: boolean;
}

export function DashboardLayout({ children, activeSection, onSectionChange, isAdmin }: DashboardLayoutProps) {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar 
          activeSection={activeSection} 
          onSectionChange={onSectionChange}
          isAdmin={isAdmin}
        />
        <main className="flex-1 overflow-auto">
          <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <div className="flex h-14 items-center justify-between px-6">
              <div className="flex items-center gap-4">
                <SidebarTrigger />
              </div>
              <ThemeToggle />
            </div>
          </header>
          <div className="container max-w-7xl py-8 px-8">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}

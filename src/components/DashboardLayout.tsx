import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { ThemeToggle } from "./ThemeToggle";
import { NotificationBell } from "./notifications/NotificationBell";
import { PageContainer } from "@/components/ui/page-container";

export interface DashboardLayoutProps {
  children: ReactNode;
  isAdmin?: boolean;
  isDemoMode?: boolean;
}

export function DashboardLayout({ children, isAdmin, isDemoMode }: DashboardLayoutProps) {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar isAdmin={isAdmin} isDemoMode={isDemoMode} />
        <main className="flex-1 flex flex-col min-w-0">
          <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-sm">
            <div className="flex h-12 items-center justify-between px-4">
              <SidebarTrigger />
              <div className="flex items-center gap-2">
                {!isDemoMode && <NotificationBell />}
                <ThemeToggle />
              </div>
            </div>
          </header>
          <div className="flex-1 py-6 px-4 sm:px-6 lg:px-8">
            <PageContainer padY={false}>
              {children}
            </PageContainer>
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}

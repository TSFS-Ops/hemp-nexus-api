import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";

import { NotificationBell } from "./notifications/NotificationBell";
import { PageContainer } from "@/components/ui/page-container";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { DashboardBreadcrumbs } from "@/components/dashboard/DashboardBreadcrumbs";

export interface DashboardLayoutProps {
  children: ReactNode;
  isAdmin?: boolean;
}

export function DashboardLayout({ children, isAdmin }: DashboardLayoutProps) {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen-safe w-full bg-background">
        <div className="hidden md:block">
          <AppSidebar isAdmin={isAdmin} />
        </div>
        <main className="flex-1 flex flex-col min-w-0">
          <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-sm safe-area-top">
            <div className="flex h-12 items-center justify-between px-3 sm:px-4">
              <div className="hidden md:block">
                <SidebarTrigger className="touch-target" />
              </div>
              <div className="md:hidden text-sm font-semibold text-foreground truncate">
                Izenzo
              </div>
              <div className="flex items-center gap-1 sm:gap-2">
                <NotificationBell />
                
              </div>
            </div>
          </header>
          <div className="flex-1 py-4 sm:py-6 px-3 xs:px-4 sm:px-6 lg:px-8 pb-20 md:pb-6">
            <PageContainer padY={false} size="wide">
              <DashboardBreadcrumbs />
              {children}
            </PageContainer>
          </div>
        </main>
        <MobileBottomNav />
      </div>
    </SidebarProvider>
  );
}

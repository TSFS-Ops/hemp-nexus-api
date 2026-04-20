import { ReactNode } from "react";
import { DeskSidebar } from "./DeskSidebar";
import { MobileBottomNav } from "./MobileBottomNav";

export function DeskLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen-safe w-full flex bg-white">
      <DeskSidebar />
      <main className="flex-1 bg-[#F8FAFC] min-w-0">
        <div className="max-w-5xl mx-auto px-4 py-5 pb-mobile-nav sm:px-6 sm:py-6 md:p-10 md:pb-12">
          {children}
        </div>
      </main>
      <MobileBottomNav />
    </div>
  );
}


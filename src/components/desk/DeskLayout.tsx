import { ReactNode } from "react";
import { DeskSidebar } from "./DeskSidebar";
import { MobileBottomNav } from "./MobileBottomNav";

export function DeskLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-full flex bg-white">
      <DeskSidebar />
      <main className="flex-1 bg-[#F8FAFC] min-w-0">
        <div className="max-w-5xl mx-auto p-6 pb-24 md:p-12 md:pb-12">
          {children}
        </div>
      </main>
      <MobileBottomNav />
    </div>
  );
}

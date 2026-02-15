import { LayoutDashboard, Key, FileText, ScrollText, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface MobileBottomNavProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
  isDemoMode?: boolean;
}

const primaryItems = [
  { id: "docs", label: "Overview", icon: LayoutDashboard },
  { id: "keys", label: "API Keys", icon: Key, requiresAuth: true },
  { id: "matches", label: "Evidence", icon: FileText, requiresAuth: true },
  { id: "audit-logs", label: "Logs", icon: ScrollText, requiresAuth: true },
];

const moreItems = [
  { id: "test", label: "API Reference" },
  { id: "search", label: "Search" },
  { id: "webhooks", label: "Webhooks" },
  { id: "analytics", label: "Analytics" },
  { id: "usage", label: "Usage & Billing" },
  { id: "troubleshooting", label: "Help" },
];

export function MobileBottomNav({ activeSection, onSectionChange, isDemoMode }: MobileBottomNavProps) {
  const isMoreActive = moreItems.some(item => item.id === activeSection);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/95 backdrop-blur-sm md:hidden">
      <div className="flex items-center justify-around h-14 px-1 max-w-lg mx-auto">
        {primaryItems.map((item) => {
          const isActive = activeSection === item.id;
          const isDisabled = isDemoMode && item.requiresAuth;
          
          return (
            <button
              key={item.id}
              onClick={() => !isDisabled && onSectionChange(item.id)}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 flex-1 h-full min-w-0 touch-target transition-colors",
                isActive && "text-primary",
                !isActive && "text-muted-foreground",
                isDisabled && "opacity-50"
              )}
            >
              <item.icon className="h-5 w-5 flex-shrink-0" />
              <span className="text-[10px] font-medium truncate max-w-full px-0.5">{item.label}</span>
            </button>
          );
        })}
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 flex-1 h-full min-w-0 touch-target transition-colors",
                isMoreActive && "text-primary",
                !isMoreActive && "text-muted-foreground"
              )}
            >
              <MoreHorizontal className="h-5 w-5 flex-shrink-0" />
              <span className="text-[10px] font-medium">More</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent 
            align="end" 
            side="top" 
            className="w-48 mb-2 bg-popover border border-border max-h-[60vh] overflow-y-auto"
          >
            {moreItems.map((item) => (
              <DropdownMenuItem
                key={item.id}
                onClick={() => onSectionChange(item.id)}
                className={cn(
                  "cursor-pointer min-h-[44px] flex items-center",
                  activeSection === item.id && "bg-accent text-accent-foreground"
                )}
              >
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      
      {/* Safe area padding for devices with home indicator */}
      <div className="h-[env(safe-area-inset-bottom,0px)] bg-background" />
    </nav>
  );
}

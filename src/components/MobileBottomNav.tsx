import { Search, BookOpen, Key, Handshake, BarChart3, MoreHorizontal } from "lucide-react";
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
  { id: "search", label: "Search", icon: Search },
  { id: "docs", label: "Docs", icon: BookOpen },
  { id: "keys", label: "Keys", icon: Key, requiresAuth: true },
  { id: "matches", label: "Matches", icon: Handshake, requiresAuth: true },
  { id: "analytics", label: "Stats", icon: BarChart3, requiresAuth: true },
];

const moreItems = [
  { id: "test", label: "Reference" },
  { id: "sdk", label: "SDKs" },
  { id: "embed", label: "Embed" },
  { id: "webhooks", label: "Webhooks" },
  { id: "webhook-debugger", label: "Debugger" },
  { id: "audit-logs", label: "Logs" },
  { id: "data-sources", label: "Data Sources" },
  { id: "hash-verify", label: "Hash Verifier" },
  { id: "system-health", label: "System Health" },
  { id: "troubleshooting", label: "Troubleshooting" },
];

export function MobileBottomNav({ activeSection, onSectionChange, isDemoMode }: MobileBottomNavProps) {
  const isMoreActive = moreItems.some(item => item.id === activeSection);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/95 backdrop-blur-sm md:hidden">
      <div className="flex items-center justify-around h-14 px-2">
        {primaryItems.map((item) => {
          const isActive = activeSection === item.id;
          const isDisabled = isDemoMode && item.requiresAuth;
          
          return (
            <button
              key={item.id}
              onClick={() => !isDisabled && onSectionChange(item.id)}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors",
                isActive && "text-primary",
                !isActive && "text-muted-foreground",
                isDisabled && "opacity-50"
              )}
            >
              <item.icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </button>
          );
        })}
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors",
                isMoreActive && "text-primary",
                !isMoreActive && "text-muted-foreground"
              )}
            >
              <MoreHorizontal className="h-5 w-5" />
              <span className="text-[10px] font-medium">More</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent 
            align="end" 
            side="top" 
            className="w-48 mb-2 bg-popover border border-border"
          >
            {moreItems.map((item) => (
              <DropdownMenuItem
                key={item.id}
                onClick={() => onSectionChange(item.id)}
                className={cn(
                  "cursor-pointer",
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

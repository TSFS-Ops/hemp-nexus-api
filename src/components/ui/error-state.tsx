import { AlertTriangle, RefreshCw, WifiOff, ServerCrash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  variant?: "default" | "inline" | "minimal";
  type?: "generic" | "network" | "server" | "empty";
  className?: string;
}

export function ErrorState({
  title,
  message,
  onRetry,
  variant = "default",
  type = "generic",
  className,
}: ErrorStateProps) {
  const icons = {
    generic: AlertTriangle,
    network: WifiOff,
    server: ServerCrash,
    empty: AlertTriangle,
  };

  const defaultMessages = {
    generic: {
      title: "Something went wrong",
      message: "An unexpected error occurred. Please try again.",
    },
    network: {
      title: "Connection error",
      message: "Unable to connect. Please check your internet connection and try again.",
    },
    server: {
      title: "Server error",
      message: "Our servers are having trouble. Please try again in a moment. If this persists, contact support@izenzo.co.za.",
    },
    empty: {
      title: "No data found",
      message: "There's nothing here yet.",
    },
  };

  const Icon = icons[type];
  const displayTitle = title || defaultMessages[type].title;
  const displayMessage = message || defaultMessages[type].message;

  if (variant === "minimal") {
    return (
      <div className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}>
        <Icon className="h-4 w-4 text-destructive" />
        <span>{displayMessage}</span>
        {onRetry && (
          <Button variant="ghost" size="sm" onClick={onRetry} className="h-auto p-1">
            <RefreshCw className="h-3 w-3" />
          </Button>
        )}
      </div>
    );
  }

  if (variant === "inline") {
    return (
      <div
        className={cn(
          "flex items-center justify-between gap-4 p-4 rounded-lg border border-destructive/30 bg-destructive/5",
          className
        )}
      >
        <div className="flex items-center gap-3">
          <Icon className="h-5 w-5 text-destructive shrink-0" />
          <div>
            <p className="font-medium text-sm">{displayTitle}</p>
            <p className="text-xs text-muted-foreground">{displayMessage}</p>
          </div>
        </div>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        )}
      </div>
    );
  }

  return (
    <Card className={cn("border-destructive/30 bg-destructive/5", className)}>
      <CardHeader className="pb-3 text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <Icon className="h-6 w-6 text-destructive" />
        </div>
        <CardTitle className="text-lg">{displayTitle}</CardTitle>
        <CardDescription>{displayMessage}</CardDescription>
      </CardHeader>
      {onRetry && (
        <CardContent className="pt-0 text-center">
          <Button onClick={onRetry} variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" />
            Try again
          </Button>
        </CardContent>
      )}
    </Card>
  );
}

// Empty state for when data fetching succeeds but returns no results
interface EmptyStateProps {
  title?: string;
  message?: string;
  icon?: React.ReactNode;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({
  title = "No results found",
  message = "Try adjusting your search or filters.",
  icon,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn("text-center py-12 px-4", className)}>
      {icon && <div className="mx-auto mb-4 text-muted-foreground">{icon}</div>}
      <h3 className="font-semibold text-lg mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-sm mx-auto">{message}</p>
      {action && (
        <Button onClick={action.onClick} variant="outline" className="mt-4">
          {action.label}
        </Button>
      )}
    </div>
  );
}

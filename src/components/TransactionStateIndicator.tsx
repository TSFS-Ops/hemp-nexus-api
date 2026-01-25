import { Check, Search, HandHeart, Eye, Lock, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type TransactionState = 'discovery' | 'intent_declared' | 'counterparty_sighted' | 'committed' | 'completed';

interface TransactionStateIndicatorProps {
  currentState: TransactionState;
  className?: string;
  showLabels?: boolean;
  size?: "sm" | "md" | "lg";
}

const STATES: { 
  key: TransactionState; 
  label: string; 
  shortLabel: string;
  icon: React.ElementType; 
  tokenCost: number | null;
}[] = [
  { key: 'discovery', label: 'Discovery', shortLabel: 'Search', icon: Search, tokenCost: null },
  { key: 'intent_declared', label: 'Intent Declared', shortLabel: 'Intent', icon: HandHeart, tokenCost: 500 },
  { key: 'counterparty_sighted', label: 'Counterparty Sighted', shortLabel: 'Sighted', icon: Eye, tokenCost: 1500 },
  { key: 'committed', label: 'Committed', shortLabel: 'Commit', icon: Lock, tokenCost: 1000 },
  { key: 'completed', label: 'Completed', shortLabel: 'Done', icon: CheckCircle, tokenCost: null },
];

export function TransactionStateIndicator({ 
  currentState, 
  className,
  showLabels = true,
  size = "md"
}: TransactionStateIndicatorProps) {
  const currentIndex = STATES.findIndex(s => s.key === currentState);

  const sizeClasses = {
    sm: { icon: "h-4 w-4", dot: "h-6 w-6", connector: "h-0.5", text: "text-xs" },
    md: { icon: "h-5 w-5", dot: "h-8 w-8", connector: "h-1", text: "text-sm" },
    lg: { icon: "h-6 w-6", dot: "h-10 w-10", connector: "h-1.5", text: "text-base" },
  }[size];

  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-center justify-between relative">
        {/* Connector line (behind dots) */}
        <div className="absolute top-1/2 left-0 right-0 -translate-y-1/2 flex items-center">
          {STATES.slice(0, -1).map((state, index) => (
            <div 
              key={`connector-${state.key}`}
              className={cn(
                "flex-1",
                sizeClasses.connector,
                index < currentIndex 
                  ? "bg-primary" 
                  : "bg-muted"
              )}
            />
          ))}
        </div>

        {/* State dots */}
        {STATES.map((state, index) => {
          const Icon = state.icon;
          const isCompleted = index < currentIndex;
          const isCurrent = index === currentIndex;
          const isFuture = index > currentIndex;

          return (
            <div 
              key={state.key} 
              className="flex flex-col items-center z-10"
            >
              <div
                className={cn(
                  sizeClasses.dot,
                  "rounded-full flex items-center justify-center transition-all",
                  isCompleted && "bg-primary text-primary-foreground",
                  isCurrent && "bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2 ring-offset-background",
                  isFuture && "bg-muted text-muted-foreground"
                )}
              >
                {isCompleted ? (
                  <Check className={sizeClasses.icon} />
                ) : (
                  <Icon className={sizeClasses.icon} />
                )}
              </div>
              
              {showLabels && (
                <div className="mt-2 text-center">
                  <p className={cn(
                    sizeClasses.text,
                    "font-medium",
                    isCurrent && "text-primary",
                    isFuture && "text-muted-foreground"
                  )}>
                    {state.shortLabel}
                  </p>
                  {state.tokenCost && (
                    <p className={cn(
                      "text-xs",
                      isCompleted && "text-muted-foreground line-through",
                      isCurrent && "text-primary",
                      isFuture && "text-muted-foreground"
                    )}>
                      {state.tokenCost.toLocaleString()} tokens
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface StateActionButtonsProps {
  currentState: TransactionState;
  matchId: string;
  onAction: (action: string) => void;
  isLoading?: boolean;
}

export function StateActionButtons({ 
  currentState, 
  matchId, 
  onAction,
  isLoading 
}: StateActionButtonsProps) {
  const getNextAction = () => {
    switch (currentState) {
      case 'discovery':
        return { action: 'declare-intent', label: 'Declare Intent', cost: 500 };
      case 'intent_declared':
        return { action: 'reveal-counterparty', label: 'Reveal Counterparty', cost: 1500 };
      case 'counterparty_sighted':
        return { action: 'commit', label: 'Commit Transaction', cost: '1,000 + Finality' };
      default:
        return null;
    }
  };

  const nextAction = getNextAction();

  if (!nextAction) return null;

  return (
    <button
      onClick={() => onAction(nextAction.action)}
      disabled={isLoading}
      className={cn(
        "inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md",
        "bg-primary text-primary-foreground",
        "hover:bg-primary/90 transition-colors",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        "text-sm font-medium"
      )}
    >
      {isLoading ? (
        <>
          <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          Processing...
        </>
      ) : (
        <>
          {nextAction.label}
          <span className="text-xs opacity-80">({nextAction.cost} tokens)</span>
        </>
      )}
    </button>
  );
}

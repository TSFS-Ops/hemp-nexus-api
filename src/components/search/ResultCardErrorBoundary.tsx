import React, { Component, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
  companyName?: string;
}

interface State {
  hasError: boolean;
}

/**
 * Per-card error boundary: if one result card crashes (malformed data from
 * a degraded API), the rest of the list still renders.
 */
export class ResultCardErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.warn(`[ResultCard] Render failed for "${this.props.companyName}":`, error.message);
  }

  render() {
    if (this.state.hasError) {
      return (
        <Card className="border-dashed border-muted opacity-60">
          <CardContent className="py-3 px-4 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <p className="text-xs text-muted-foreground">
              Unable to display this result{this.props.companyName ? ` (${this.props.companyName})` : ""}. Data may be incomplete.
            </p>
          </CardContent>
        </Card>
      );
    }
    return this.props.children;
  }
}

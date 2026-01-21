import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ExternalLink, Globe, Terminal } from "lucide-react";
import { getConsoleUrl, getPublicUrl } from "@/lib/hostname";

interface DomainMismatchProps {
  type: 'console-content-on-public' | 'public-content-on-console';
  attemptedPath: string;
}

/**
 * Soft-gate component that renders when a user tries to access content
 * that belongs to a different "door" of the application.
 * 
 * IMPORTANT: This component does NOT auto-redirect. It provides a clear
 * message and a CTA button that the user must click to navigate.
 */
export function DomainMismatch({ type, attemptedPath }: DomainMismatchProps) {
  if (type === 'console-content-on-public') {
    const consoleUrl = getConsoleUrl(attemptedPath);
    
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Terminal className="w-6 h-6 text-primary" />
            </div>
            <CardTitle>Developer Console</CardTitle>
            <CardDescription>
              This area is part of the Izenzo Developer Console for API keys, logs, and integrations.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">
              The page you're looking for lives on our developer platform.
            </p>
            <Button asChild className="w-full">
              <a href={consoleUrl}>
                Go to Developer Console
                <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </Button>
            <Button variant="ghost" asChild className="w-full">
              <a href="/">
                ← Back to Home
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (type === 'public-content-on-console') {
    const publicUrl = getPublicUrl(attemptedPath);
    
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Globe className="w-6 h-6 text-primary" />
            </div>
            <CardTitle>Public Website</CardTitle>
            <CardDescription>
              This content is part of the public Izenzo experience for search and proof-of-intent.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">
              The page you're looking for lives on our public website.
            </p>
            <Button asChild className="w-full">
              <a href={publicUrl}>
                Go to Public Site
                <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </Button>
            <Button variant="ghost" asChild className="w-full">
              <a href="/dashboard">
                ← Back to Console
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}

import { Component, type ReactNode } from "react";
import NotFound from "@/pages/NotFound";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  isChunkLoadError: boolean;
}

/**
 * Catches runtime errors thrown by lazy-loaded route components - most
 * commonly a `ChunkLoadError` triggered when the user navigates to a
 * route whose JS bundle is no longer available (stale tab open across a
 * deploy, transient network failure mid-fetch). Without this boundary
 * the whole React tree unmounts and the user sees a blank white page or
 * the fallback spinner forever.
 *
 * For chunk-load errors we offer a one-click reload (which pulls the new
 * bundle manifest) in addition to the standard NotFound recovery UI. For
 * any other render error we just render NotFound, so the user always has
 * a way out - same affordances as a 404.
 *
 * We intentionally do NOT wrap this around the entire app: errors inside
 * deeply nested feature components are better surfaced where the user can
 * see the local context, not collapsed into a global "something went
 * wrong". This boundary is scoped to the route-level Suspense only.
 */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, isChunkLoadError: false };

  static getDerivedStateFromError(error: Error): State {
    // Vite/webpack emit ChunkLoadError when an async bundle 404s after a
    // deploy. The .name check is the most portable; we also sniff the
    // message because some bundlers omit the name.
    const isChunk =
      error?.name === "ChunkLoadError" ||
      /Loading (CSS )?chunk [\d]+ failed/i.test(error?.message ?? "") ||
      /Failed to fetch dynamically imported module/i.test(error?.message ?? "");
    return { hasError: true, isChunkLoadError: isChunk };
  }

  componentDidCatch(error: Error) {
    // Log to the console so the error is visible in our session-replay
    // and in Sentry's autoinstrumentation. Do not swallow - the project
    // policy is "zero swallowed errors".
    console.error("[RouteErrorBoundary] route render failed:", error);
  }

  reload = () => {
    // Hard reload - we want a fresh index.html so the bundle manifest is
    // re-read and the missing chunk's new hash gets resolved.
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.state.isChunkLoadError) {
      return (
        <main
          role="main"
          className="min-h-screen flex items-center justify-center bg-background px-6 py-12"
        >
          <div className="w-full max-w-lg text-center">
            <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-muted-foreground mb-3">
              Update available
            </p>
            <h1 className="text-xl font-semibold text-foreground mb-2">
              This page needs a fresh copy
            </h1>
            <p className="text-sm text-muted-foreground mb-6">
              A newer version of Izenzo has been released since you opened
              this tab, and part of the page failed to load. Reload to pick
              up the latest version - your work in this session is not
              affected.
            </p>
            <button
              onClick={this.reload}
              className="inline-flex items-center justify-center px-6 py-3 min-h-[44px] rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Reload page
            </button>
          </div>
        </main>
      );
    }

    return <NotFound />;
  }
}

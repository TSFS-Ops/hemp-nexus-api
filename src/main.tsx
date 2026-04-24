import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initSentry } from "./lib/sentry";
import { installEdgeInvokeShim } from "./lib/install-edge-invoke-shim";
import App from "./App.tsx";
import "./index.css";

// Initialize error tracking before rendering
initSentry();

// Install global edge-invoke hardening: pre-flight token refresh + friendly
// 401/403/429/503 translation for every supabase.functions.invoke() call site
// (migrated and legacy).
installEdgeInvokeShim();

// Ensure light mode only - remove any stale dark class
document.documentElement.classList.remove("dark");
localStorage.removeItem("theme");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initSentry } from "./lib/sentry";
import App from "./App.tsx";
import "./index.css";

// Initialize error tracking before rendering
initSentry();

// Ensure light mode only - remove any stale dark class
document.documentElement.classList.remove("dark");
localStorage.removeItem("theme");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

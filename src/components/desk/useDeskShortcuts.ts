/**
 * Batch 24 — Trade Desk sidebar quick-navigation shortcuts.
 *
 * Gmail-style two-key sequences ("g" then a destination key) jump between
 * top-level Trade Desk pages from anywhere inside the shell. "?" opens the
 * shortcuts cheatsheet. Shortcuts are ignored whenever the user is typing
 * in an input, textarea, contenteditable element, or has a modifier key
 * held down (so they never collide with browser or app shortcuts).
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

export type DeskShortcut = {
  key: string; // single character, lower-case
  to: string;
  label: string;
};

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  // Radix popovers/dialogs use role="dialog" or role="menu" — let those keep keys.
  const role = el.getAttribute("role");
  if (role === "textbox" || role === "combobox") return true;
  return false;
}

export function useDeskShortcuts(shortcuts: DeskShortcut[]) {
  const navigate = useNavigate();
  const [helpOpen, setHelpOpen] = useState(false);
  const armedRef = useRef(false);
  const armedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    function disarm() {
      armedRef.current = false;
      if (armedTimerRef.current !== null) {
        window.clearTimeout(armedTimerRef.current);
        armedTimerRef.current = null;
      }
    }

    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      // "?" opens the cheatsheet (Shift+/ on most layouts).
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        setHelpOpen((v) => !v);
        disarm();
        return;
      }

      if (e.key === "Escape" && helpOpen) {
        setHelpOpen(false);
        return;
      }

      // "g" arms a two-key sequence for 1.2s.
      if (!armedRef.current && e.key.toLowerCase() === "g" && !e.shiftKey) {
        armedRef.current = true;
        if (armedTimerRef.current !== null) {
          window.clearTimeout(armedTimerRef.current);
        }
        armedTimerRef.current = window.setTimeout(disarm, 1200);
        return;
      }

      if (armedRef.current) {
        const match = shortcuts.find(
          (s) => s.key.toLowerCase() === e.key.toLowerCase(),
        );
        disarm();
        if (match) {
          e.preventDefault();
          navigate(match.to);
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      disarm();
    };
  }, [shortcuts, navigate, helpOpen]);

  return { helpOpen, setHelpOpen };
}

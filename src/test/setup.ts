import "@testing-library/jest-dom";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// jsdom polyfills for Radix UI primitives
Element.prototype.scrollIntoView = function () {};
// @ts-expect-error jsdom lacks pointer-capture APIs used by Radix
Element.prototype.hasPointerCapture = function () { return false; };
// @ts-expect-error jsdom lacks pointer-capture APIs used by Radix
Element.prototype.releasePointerCapture = function () {};
// @ts-expect-error jsdom lacks pointer-capture APIs used by Radix
Element.prototype.setPointerCapture = function () {};

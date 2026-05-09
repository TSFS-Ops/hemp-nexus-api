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
(Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => false;
(Element.prototype as unknown as { releasePointerCapture: () => void }).releasePointerCapture = () => {};
(Element.prototype as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};

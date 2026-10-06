// Minimal type declarations for the Navigation API (Chrome 102+)
// https://developer.mozilla.org/en-US/docs/Web/API/Navigation_API

interface Navigation extends EventTarget {
  addEventListener(
    type: "navigatesuccess",
    listener: (event: Event) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: "navigateerror",
    listener: (event: Event) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: "navigate",
    listener: (event: Event) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
}

declare var navigation: Navigation | undefined;

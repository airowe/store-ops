import "@testing-library/jest-dom/vitest";

// Polyfill File.prototype.text() — jsdom 25 doesn't implement it, but every
// real browser does. Needed for components that read an <input type="file">
// upload via the standard File API (e.g. ConnectAscCard's .p8 upload).
if (typeof File !== "undefined" && typeof File.prototype.text !== "function") {
  File.prototype.text = function (this: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}

// Polyfill/mock localStorage if missing methods (jsdom node environment compatibility)
if (typeof globalThis !== "undefined") {
  const store: Record<string, string> = {};
  const mockLocalStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const key in store) delete store[key];
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };

  try {
    if (typeof localStorage === "undefined" || typeof localStorage.clear !== "function") {
      Object.defineProperty(globalThis, "localStorage", {
        value: mockLocalStorage,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
  } catch {
    // If globalThis.localStorage is non-configurable, attach missing methods directly
    if (typeof localStorage !== "undefined") {
      (localStorage as unknown as Record<string, unknown>).clear = mockLocalStorage.clear;
      (localStorage as unknown as Record<string, unknown>).getItem = mockLocalStorage.getItem;
      (localStorage as unknown as Record<string, unknown>).setItem = mockLocalStorage.setItem;
      (localStorage as unknown as Record<string, unknown>).removeItem = mockLocalStorage.removeItem;
    }
  }
}

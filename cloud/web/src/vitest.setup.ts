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

// Polyfill localStorage if not available (jsdom may not initialize it)
if (typeof globalThis !== "undefined" && typeof localStorage === "undefined") {
  const store: Record<string, string> = {};
  Object.defineProperty(globalThis, "localStorage", {
    value: {
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
    },
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

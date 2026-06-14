import { describe, expect, it } from "vitest";
import { zipStore } from "./zip.js";

// Minimal local-file-header / central-directory signature checks. We don't pull a
// real unzip lib into the Worker test; instead we assert the bytes conform to the
// ZIP spec structure (PK\x03\x04 local headers, PK\x01\x02 central dir, PK\x05\x06
// end-of-central-directory) and that filenames + contents are embedded verbatim.

const LOCAL = [0x50, 0x4b, 0x03, 0x04];
const CENTRAL = [0x50, 0x4b, 0x01, 0x02];
const EOCD = [0x50, 0x4b, 0x05, 0x06];

function indexOfSig(buf: Uint8Array, sig: number[], from = 0): number {
  outer: for (let i = from; i <= buf.length - sig.length; i++) {
    for (let j = 0; j < sig.length; j++) if (buf[i + j] !== sig[j]) continue outer;
    return i;
  }
  return -1;
}

function findAscii(buf: Uint8Array, s: string): number {
  const bytes = new TextEncoder().encode(s);
  return indexOfSig(buf, Array.from(bytes));
}

describe("zipStore — minimal store-only (uncompressed) zip", () => {
  it("starts with a local file header signature", () => {
    const z = zipStore([{ path: "a.txt", content: "hello" }]);
    expect(Array.from(z.slice(0, 4))).toEqual(LOCAL);
  });

  it("embeds each filename and its content verbatim", () => {
    const z = zipStore([{ path: "dir/name.txt", content: "Calm Tracker" }]);
    expect(findAscii(z, "dir/name.txt")).toBeGreaterThan(-1);
    expect(findAscii(z, "Calm Tracker")).toBeGreaterThan(-1);
  });

  it("writes a central directory and an end-of-central-directory record", () => {
    const z = zipStore([{ path: "a.txt", content: "x" }]);
    const central = indexOfSig(z, CENTRAL);
    const eocd = indexOfSig(z, EOCD);
    expect(central).toBeGreaterThan(-1);
    expect(eocd).toBeGreaterThan(central); // EOCD comes after the central dir
  });

  it("records the file count in the end-of-central-directory record", () => {
    const z = zipStore([
      { path: "a.txt", content: "1" },
      { path: "b.txt", content: "2" },
      { path: "c.txt", content: "3" },
    ]);
    const eocd = indexOfSig(z, EOCD);
    // total entries (this disk) is a uint16-LE at EOCD offset +10
    const count = z[eocd + 10]! | (z[eocd + 11]! << 8);
    expect(count).toBe(3);
  });

  it("handles utf-8 content (multibyte) with correct byte lengths", () => {
    const content = "Calm · Café";
    const z = zipStore([{ path: "x.txt", content }]);
    const byteLen = new TextEncoder().encode(content).length;
    // the uncompressed size (uint32-LE) appears in the local header at offset +22
    const local = indexOfSig(z, LOCAL);
    const size =
      z[local + 22]! | (z[local + 23]! << 8) | (z[local + 24]! << 16) | (z[local + 25]! << 24);
    expect(size).toBe(byteLen);
  });

  it("produces an empty-but-valid archive for no files", () => {
    const z = zipStore([]);
    expect(indexOfSig(z, EOCD)).toBeGreaterThan(-1);
    // no local headers
    expect(indexOfSig(z, LOCAL)).toBe(-1);
  });
});

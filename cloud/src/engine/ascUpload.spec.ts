/**
 * #374: the pure half of Apple's screenshot upload — checksum + the
 * reservation's upload-operation plan. The I/O half is tested separately with an
 * injected fetch; these are the parts that must be provably correct because a
 * wrong checksum is rejected only AFTER the bytes are transferred.
 */
import { describe, expect, it } from "vitest";
import { md5Hex, planUploadParts, isPlaceholderAsset } from "./ascUpload.js";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("md5Hex", () => {
  /**
   * Apple's commit step sends `sourceFileChecksum` as MD5, and WebCrypto does
   * NOT implement MD5 (`crypto.subtle.digest("MD5")` throws NotSupportedError on
   * both Workers and Node) — so this is a hand-rolled implementation and needs
   * real vectors, not self-consistency.
   */
  it.each([
    ["", "d41d8cd98f00b204e9800998ecf8427e"],
    ["a", "0cc175b9c0f1b6a831c399e269772661"],
    ["abc", "900150983cd24fb0d6963f7d28e17f72"],
    ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
    ["abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b"],
    [
      "12345678901234567890123456789012345678901234567890123456789012345678901234567890",
      "57edf4a22be3c955ac49da2e2107b67a",
    ],
  ])("matches the RFC 1321 vector for %j", (input, expected) => {
    expect(md5Hex(bytes(input))).toBe(expected);
  });

  it("handles a payload spanning multiple 64-byte blocks with padding edge cases", () => {
    // 55/56/64 bytes are the classic MD5 padding boundaries.
    for (const n of [54, 55, 56, 57, 63, 64, 65, 119, 120]) {
      const out = md5Hex(new Uint8Array(n).fill(0x41));
      expect(out, `length ${n}`).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it("is byte-exact, not text-based (binary-safe)", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
    expect(md5Hex(png)).toMatch(/^[0-9a-f]{32}$/);
    // a single flipped byte must change the digest
    const other = new Uint8Array(png);
    other[9] = 0xfe;
    expect(md5Hex(other)).not.toBe(md5Hex(png));
  });
});

describe("planUploadParts", () => {
  /**
   * Apple returns `uploadOperations` describing how to slice the file: each has
   * a method, url, offset, length and headers. We must PUT exactly those slices —
   * inventing our own chunking corrupts the asset.
   */
  const ops = [
    { method: "PUT", url: "https://up/1", offset: 0, length: 4, requestHeaders: [{ name: "X", value: "1" }] },
    { method: "PUT", url: "https://up/2", offset: 4, length: 3, requestHeaders: [] },
  ];

  it("slices the file at Apple's offsets and lengths, in order", () => {
    const file = bytes("abcdefg");
    const parts = planUploadParts(file, ops);
    expect(parts).toHaveLength(2);
    expect(new TextDecoder().decode(parts[0]!.body)).toBe("abcd");
    expect(new TextDecoder().decode(parts[1]!.body)).toBe("efg");
    expect(parts[0]!.url).toBe("https://up/1");
    expect(parts[0]!.headers).toEqual({ X: "1" });
    expect(parts[1]!.headers).toEqual({});
  });

  it("rejects operations that do not cover the file exactly", () => {
    // Short by a byte: uploading this yields a truncated asset Apple then
    // rejects at commit — better to fail before transferring anything.
    expect(() => planUploadParts(bytes("abcdefg"), [{ ...ops[0]!, length: 3 }, ops[1]!])).toThrow(
      /cover/i,
    );
  });

  it("rejects an operation that runs past the end of the file", () => {
    expect(() => planUploadParts(bytes("abc"), [{ ...ops[0]!, offset: 0, length: 99 }])).toThrow(
      /past the end|cover/i,
    );
  });

  it("rejects an empty operation list", () => {
    expect(() => planUploadParts(bytes("abc"), [])).toThrow(/no upload operations/i);
  });
});

/**
 * The renderer stamps a watermark on an un-reviewed / placeholder asset so it
 * cannot be mistaken for a shippable one (lib/render_localized_shots.py). Those
 * must be HARD-REFUSED by upload, never merely warned about — a placeholder on a
 * live listing is a fabricated asset, the exact thing this product forbids.
 */
describe("isPlaceholderAsset", () => {
  it("flags a filename the renderer marks as needing review", () => {
    expect(isPlaceholderAsset("iphone67_01.needsReview.png")).toBe(true);
    expect(isPlaceholderAsset("shots/PLACEHOLDER_home.png")).toBe(true);
    expect(isPlaceholderAsset("de-DE_02_placeholder.png")).toBe(true);
  });

  it("passes a normal captured asset", () => {
    expect(isPlaceholderAsset("APP_IPHONE_67_01.png")).toBe(false);
    expect(isPlaceholderAsset("shots/en-US/home.png")).toBe(false);
  });

  it("is case-insensitive (the marker must not be defeated by casing)", () => {
    expect(isPlaceholderAsset("NeedsReview.png")).toBe(true);
    expect(isPlaceholderAsset("Placeholder.PNG")).toBe(true);
  });
});

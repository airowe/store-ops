import { describe, it, expect } from "vitest";
import { renderBroadcast } from "./broadcast.js";

describe("renderBroadcast", () => {
  it("renders headings, paragraphs, bold, links, and lists to html", () => {
    const { html } = renderBroadcast("Launch", "# Hi\n\nWe **shipped**. See [docs](https://x.com).\n\n- one\n- two");
    expect(html).toContain("<h1>Hi</h1>");
    expect(html).toContain("<strong>shipped</strong>");
    expect(html).toContain('<a href="https://x.com">docs</a>');
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
  });

  it("escapes HTML in the source (no injection)", () => {
    const { html } = renderBroadcast("x", "hi <script>alert(1)</script> & <b>x</b>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
  });

  it("produces a plaintext part with markup stripped", () => {
    const { text } = renderBroadcast("x", "# Hi\n\nWe **shipped**. [docs](https://x.com)");
    expect(text).toContain("Hi");
    expect(text).toContain("shipped");
    expect(text).toContain("https://x.com");
    expect(text).not.toContain("**");
    expect(text).not.toContain("# ");
  });

  it("escapes markup embedded inside bold (no injection via **...**)", () => {
    const { html } = renderBroadcast("x", "**<script>alert(1)</script>**");
    expect(html).not.toContain("<script>");
    expect(html).toContain("<strong>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes a quote inside a link URL (no attribute breakout)", () => {
    const { html } = renderBroadcast("x", '[click](https://x.com/"onmouseover=alert(1))');
    expect(html).not.toContain('"onmouseover');
  });
});

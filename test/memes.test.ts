import { describe, expect, it } from "vitest";
import { parseHeadline, parseMeme, parseNickname, parseSource } from "../src/memes";

describe("parseMeme", () => {
  it("accepts a valid meme and pads or trims lines to the format", () => {
    const r = parseMeme({ format: "brain", scene: "space", lines: ["a", "b"] });
    expect(r).toEqual({ ok: true, value: { format: "brain", scene: "space", lines: ["a", "b", "", ""] } });
    const r2 = parseMeme({ format: "drake", scene: "fire", lines: ["a", "b", "c"] });
    expect(r2.ok && r2.value.lines).toEqual(["a", "b"]);
  });

  it("refuses unknown formats, empty memes and overlong lines", () => {
    expect(parseMeme({ format: "toString", lines: ["x"] }).ok).toBe(false);
    expect(parseMeme({ format: "impact", lines: ["  ", ""] }).ok).toBe(false);
    expect(parseMeme({ format: "impact", lines: ["x".repeat(121)] }).ok).toBe(false);
    expect(parseMeme(null).ok).toBe(false);
  });

  it("falls back to a safe scene and strips control and bidi characters", () => {
    const r = parseMeme({ format: "impact", scene: "<script>", lines: ["a‮b\nc", 5] });
    expect(r.ok && r.value).toEqual({ format: "impact", scene: "spotlight", lines: ["a b c", ""] });
  });
});

describe("visitor fields", () => {
  it("requires a nickname and reserves the news desk's name", () => {
    expect(parseNickname("").ok).toBe(false);
    expect(parseNickname("Nieuwsdesk").ok).toBe(false);
    expect(parseNickname("  Memekoning ")).toEqual({ ok: true, value: "Memekoning" });
  });

  it("requires a headline", () => {
    expect(parseHeadline(" ").ok).toBe(false);
    expect(parseHeadline("Kabinet valt")).toEqual({ ok: true, value: "Kabinet valt" });
  });

  it("only takes https source links and keeps the host for display", () => {
    expect(parseSource("")).toEqual({ ok: true, value: { url: "", host: "" } });
    expect(parseSource("javascript:alert(1)").ok).toBe(false);
    expect(parseSource("http://nos.nl/a").ok).toBe(false);
    expect(parseSource("https://www.nu.nl/a")).toEqual({ ok: true, value: { url: "https://www.nu.nl/a", host: "nu.nl" } });
  });
});

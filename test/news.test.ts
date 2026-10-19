import { describe, expect, it } from "vitest";
import { interleave, parseRss } from "../src/news";

const RSS = `<?xml version="1.0"?><rss><channel><title>NOS</title>
<item><title><![CDATA[Kabinet & Kamer <b>eens</b>]]></title><link>https://nos.nl/l/1</link></item>
<item><title>Caf&#233; &amp; co</title><link>https://nos.nl/l/2</link></item>
<item><title>Geen link</title></item>
<item><title>Onveilig</title><link>javascript:x</link></item>
</channel></rss>`;

describe("parseRss", () => {
  it("reads titles and https links, decoding CDATA and entities", () => {
    expect(parseRss(RSS)).toEqual([
      { title: "Kabinet & Kamer eens", link: "https://nos.nl/l/1" },
      { title: "Café & co", link: "https://nos.nl/l/2" },
    ]);
  });
});

describe("interleave", () => {
  it("alternates sources, drops duplicate links and stops at the limit", () => {
    const a = [{ title: "a1", link: "https://a/1" }, { title: "a2", link: "https://a/2" }, { title: "a3", link: "https://a/3" }];
    const b = [{ title: "b1", link: "https://b/1" }, { title: "dup", link: "https://a/2" }];
    expect(interleave([a, b], 4).map((s) => s.title)).toEqual(["a1", "b1", "a2", "a3"]);
  });
});

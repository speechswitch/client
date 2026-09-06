import { canonicalPattern } from "./ecmascript-pattern.ts";

export function patternFixtures(sources: Iterable<string>) {
  const text = ["", "a", "en", "en-US", "en\n", "tc_voice", "uc_voice", "tc_\n", "a\n", "a\r", "a\u2028", "a\u2029", "😀", "\ud800", "\udc00", "\ud800\udc00", "a/b", "a:b"];
  for (let unit = 0; unit <= 255; unit++) text.push(String.fromCharCode(unit));
  for (const unit of [0x1680, 0x180e, 0x2000, 0x200a, 0x200b, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff]) text.push(String.fromCharCode(unit), `a${String.fromCharCode(unit)}`);
  for (const length of [499, 500, 501, 999, 1000, 1001, 3999, 4000, 4001, 4999, 5000, 5001, 9999, 10000, 10001]) text.push("a".repeat(length), "😀".repeat(length));
  let seed = 42;
  for (let index = 0; index < 256; index++) {
    let value = "";
    for (let offset = 0; offset < 6; offset++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; value += String.fromCharCode(seed & 0xffff); }
    text.push(value);
  }
  return { text, patterns: [...sources].map(source => ({ source, translated: canonicalPattern(source), expected: text.map(value => new RegExp(source).test(value)) })) };
}

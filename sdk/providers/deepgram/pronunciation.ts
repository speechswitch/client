/** Converts literal word/phrase matches to Deepgram's escaped inline IPA syntax. */
export function pronunciation(replacements: Readonly<Record<string, string>>) {
  const words = Object.keys(replacements).sort((left, right) => right.length - left.length);
  for (const word of words) {
    if (!word.length) throw new TypeError("Deepgram replacement words must not be empty");
    const length = Array.from(replacements[word]!).length;
    if (length > 128 || length > Math.max(15, Array.from(word).length * 10)) {
      throw new TypeError(`Deepgram pronunciation is too long for ${JSON.stringify(word)}`);
    }
  }
  const pattern = words.length
    ? new RegExp(
        `(?<![\\p{L}\\p{N}\\p{M}_])(?:${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\p{L}\\p{N}\\p{M}_])`,
        "gu",
      )
    : undefined;
  const lookahead = (words[0]?.length ?? 0) + 1;
  let pending = "";
  let previous = "";
  let count = 0;
  return {
    reset() {
      pending = "";
      previous = "";
      count = 0;
    },
    text(chunk: string, final = false): string {
      if (!pattern) return chunk;
      const input = previous + pending + chunk;
      // Retain enough input to recognize a complete phrase and its right boundary.
      let end = final ? input.length : Math.max(previous.length, input.length - lookahead);
      if (!final && end > previous.length && /[\uD800-\uDBFF]/u.test(input[end - 1]!)) end--;
      let expansion = 0;
      const replaced = input.replace(pattern, (word: string, offset: number) => {
        if (offset < previous.length || offset >= end) return word;
        if (++count > 500)
          throw new TypeError("Deepgram allows at most 500 pronunciations per utterance");
        const control = JSON.stringify({ word, pronounce: replacements[word] });
        const replacement = "\\" + control.slice(0, -1) + "\\}";
        // A complete match may extend past the retained-tail boundary.
        end = Math.max(end, offset + word.length);
        expansion += replacement.length - word.length;
        return replacement;
      });
      const output = replaced.slice(previous.length, end + expansion);
      pending = input.slice(end);
      previous = input.slice(Math.max(0, end - 2), end);
      if (final) {
        pending = "";
        previous = "";
        count = 0;
      }
      return output;
    },
  };
}

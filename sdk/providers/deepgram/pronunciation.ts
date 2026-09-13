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
      let offset = previous.length;
      pattern.lastIndex = offset;
      const parts: string[] = [];
      for (
        let match = pattern.exec(input);
        match && match.index < end;
        match = pattern.exec(input)
      ) {
        if (++count > 500)
          throw new TypeError("Deepgram allows at most 500 pronunciations per utterance");
        const word = match[0];
        const control = JSON.stringify({ word, pronounce: replacements[word] });
        parts.push(input.slice(offset, match.index), "\\" + control.slice(0, -1) + "\\}");
        offset = match.index + word.length;
      }
      end = Math.max(end, offset);
      parts.push(input.slice(offset, end));
      pending = input.slice(end);
      previous = input.slice(Math.max(0, end - 2), end);
      if (final) {
        pending = "";
        previous = "";
        count = 0;
      }
      return parts.join("");
    },
  };
}

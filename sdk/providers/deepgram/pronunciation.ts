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
  return (text: string): string => {
    if (!pattern) return text;
    let count = 0;
    return text.replace(pattern, (word) => {
      if (++count > 500)
        throw new TypeError("Deepgram allows at most 500 pronunciations per text chunk");
      const control = JSON.stringify({ word, pronounce: replacements[word] });
      return "\\" + control.slice(0, -1) + "\\}";
    });
  };
}

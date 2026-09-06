import { parsePattern, type Pattern } from "./pattern-parser.ts";

/** Compile fixed matcher functions, never a runtime regex/schema descriptor. */
export function renderGoPattern(source: string, name: string): string {
  const functions: string[] = [];
  const cache = new Map<string, string>();
  function compile(pattern: Pattern): string {
    const key = JSON.stringify(pattern); const cached = cache.get(key); if (cached) return cached;
    const current = `${name}Node${cache.size}`; cache.set(key, current);
    let body: string;
    switch (pattern.kind) {
      case "class": {
        const match = pattern.ranges.map(([low, high]) => low === high ? `unit == ${low}` : `(unit >= ${low} && unit <= ${high})`).join(" || ") || "false";
        body = `if position == len(input) { return nil }\nunit := input[position]\nif ${pattern.negate ? "!" : ""}(${match}) { return []int{position + 1} }\nreturn nil`;
        break;
      }
      case "start": body = "if position == 0 { return []int{position} }; return nil"; break;
      case "end": body = "if position == len(input) { return []int{position} }; return nil"; break;
      case "lookahead": body = `if len(${compile(pattern.part)}(input, position)) ${pattern.negate ? "==" : "!="} 0 { return []int{position} }; return nil`; break;
      case "choice": body = `result := []int{}\nseen := map[int]bool{}\n${pattern.parts.map(part => `for _, end := range ${compile(part)}(input, position) { if !seen[end] { seen[end] = true; result = append(result, end) } }`).join("\n")}\nreturn result`; break;
      case "sequence": body = `positions := []int{position}\n${pattern.parts.map(part => `{\nnext := []int{}\nseen := map[int]bool{}\nfor _, start := range positions {\nfor _, end := range ${compile(part)}(input, start) { if !seen[end] { seen[end] = true; next = append(next, end) } }\n}\npositions = next\nif len(positions) == 0 { return nil }\n}`).join("\n")}\nreturn positions`; break;
      case "repeat": body = `positions := []int{position}
result := []int{}
accepted := map[int]bool{}
limit := ${pattern.maximum ?? `len(input) - position + ${pattern.minimum}`}
for count := 0; count <= limit && len(positions) != 0; count++ {
    if count >= ${pattern.minimum} { for _, end := range positions { if !accepted[end] { accepted[end] = true; result = append(result, end) } } }
    if count == limit { break }
    next := []int{}
    seen := map[int]bool{}
    for _, start := range positions { for _, end := range ${compile(pattern.part)}(input, start) { if !seen[end] { seen[end] = true; next = append(next, end) } } }
    stable := len(next) == len(positions)
    for _, end := range positions { if !seen[end] { stable = false; break } }
    if stable {
        // Nullable repetition can be padded to its minimum without advancing.
        for _, end := range next { if !accepted[end] { accepted[end] = true; result = append(result, end) } }
        break
    }
    positions = next
}
return result`; break;
    }
    functions.push(`func ${current}(input []uint16, position int) []int {\n${body}\n}`);
    return current;
  }
  const matcher = compile(parsePattern(source));
  return `func ${name}(input []uint16) bool {\nfor position := 0; position <= len(input); position++ { if len(${matcher}(input, position)) != 0 { return true } }\nreturn false\n}\n\n${functions.join("\n\n")}\n`;
}

import { canonicalPattern } from "./ecmascript-pattern.ts";

type Pattern =
  | { kind: "class"; ranges: readonly (readonly [number, number])[]; negate: boolean }
  | { kind: "start" | "end" }
  | { kind: "sequence" | "choice"; parts: readonly Pattern[] }
  | { kind: "lookahead"; part: Pattern; negate: boolean }
  | { kind: "repeat"; part: Pattern; minimum: number; maximum: number | null };

function parse(source: string): Pattern {
  const canonical = canonicalPattern(source);
  let index = 0;
  const fail = (): never => { throw new TypeError(`Unsupported ECMAScript schema pattern: ${source}`); };
  function character(): number {
    if (canonical[index++] !== "\\") return fail();
    const escape = canonical[index++];
    if (escape === "n") return 10;
    if (escape === "r") return 13;
    if (escape !== "u") return fail();
    const value = parseInt(canonical.slice(index, index + 4), 16); index += 4;
    if (!Number.isFinite(value)) return fail();
    return value;
  }
  function choice(): Pattern {
    const parts = [sequence()];
    while (canonical[index] === "|") { index++; parts.push(sequence()); }
    return parts.length === 1 ? parts[0]! : { kind: "choice", parts };
  }
  function sequence(): Pattern {
    const parts: Pattern[] = [];
    while (index < canonical.length && !")|".includes(canonical[index]!)) {
      let part: Pattern;
      if (canonical[index] === "[") {
        index++; const negate = canonical[index] === "^"; if (negate) index++;
        const ranges: [number, number][] = [];
        while (canonical[index] !== "]" && index < canonical.length) {
          const start = character(); let end = start;
          if (canonical[index] === "-") { index++; end = character(); }
          ranges.push([start, end]);
        }
        if (canonical[index++] !== "]") return fail();
        part = { kind: "class", ranges, negate };
      } else if (canonical[index] === "\\") {
        index++; const token = canonical[index++];
        if (token !== "A" && token !== "Z") return fail();
        part = { kind: token === "A" ? "start" : "end" };
      } else if (canonical.slice(index, index + 2) === "(?") {
        const token = canonical[index + 2]; index += 3;
        const body = choice(); if (canonical[index++] !== ")") return fail();
        part = token === ":" ? body : token === "=" || token === "!" ? { kind: "lookahead", part: body, negate: token === "!" } : fail();
      } else return fail();
      const quantifier = /^(?:[+*?]|\{\d+(?:,\d*)?\})/.exec(canonical.slice(index));
      if (quantifier) {
        const token = quantifier[0]; index += token.length;
        const [low, high] = token.slice(1, -1).split(",");
        const minimum = token === "+" ? 1 : token === "*" || token === "?" ? 0 : Number(low);
        const maximum = token === "+" || token === "*" ? null : token === "?" ? 1 : high === "" ? null : Number(high ?? low);
        if (!Number.isSafeInteger(minimum) || maximum !== null && !Number.isSafeInteger(maximum)) return fail();
        part = { kind: "repeat", part, minimum, maximum };
        if (canonical[index] === "?") index++; // Greediness cannot change boolean matches without captures/backreferences.
      }
      parts.push(part);
    }
    return parts.length === 1 ? parts[0]! : { kind: "sequence", parts };
  }
  const pattern = choice();
  if (index !== canonical.length) return fail();
  return pattern;
}

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
  const matcher = compile(parse(source));
  return `func ${name}(input []uint16) bool {\nfor position := 0; position <= len(input); position++ { if len(${matcher}(input, position)) != 0 { return true } }\nreturn false\n}\n\n${functions.join("\n\n")}\n`;
}

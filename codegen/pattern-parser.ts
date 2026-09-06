import { canonicalPattern } from "./ecmascript-pattern.ts";

// This tree exists only during codegen; targets emit fixed matcher functions.
export type Pattern =
  | { kind: "class"; ranges: readonly (readonly [number, number])[]; negate: boolean }
  | { kind: "start" | "end" }
  | { kind: "sequence" | "choice"; parts: readonly Pattern[] }
  | { kind: "lookahead"; part: Pattern; negate: boolean }
  | { kind: "repeat"; part: Pattern; minimum: number; maximum: number | null };

export function parsePattern(source: string): Pattern {
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

import { parsePattern, type Pattern } from "./pattern-parser.ts";

/** Compile canonical UTF-16 pattern semantics into fixed Rust functions. */
export function renderRustPattern(source: string, name: string): string {
  const functions: string[] = [];
  const cache = new Map<string, string>();
  function compile(pattern: Pattern): string {
    const key = JSON.stringify(pattern); const cached = cache.get(key); if (cached) return cached;
    const current = `${name}_node${cache.size}`; cache.set(key, current);
    let body: string;
    switch (pattern.kind) {
      case "class": {
        const match = pattern.ranges.map(([low, high]) => low === high ? `unit == ${low}` : low === 0 ? high === 65535 ? "true" : `unit <= ${high}` : high === 65535 ? `unit >= ${low}` : `unit >= ${low} && unit <= ${high}`).join(" || ") || "false";
        body = `if position == input.len() { return Vec::new(); }\n${match.includes("unit") ? "let unit = input[position];\n" : ""}if ${pattern.negate ? `!(${match})` : match} { vec![position + 1] } else { Vec::new() }`;
        break;
      }
      case "start": body = "if position == 0 { vec![position] } else { Vec::new() }"; break;
      case "end": body = "if position == input.len() { vec![position] } else { Vec::new() }"; break;
      case "lookahead": body = `if ${pattern.negate ? "" : "!"}${compile(pattern.part)}(input, position).is_empty() { vec![position] } else { Vec::new() }`; break;
      case "choice": body = `let mut result = std::collections::BTreeSet::new();\n${pattern.parts.map(part => `result.extend(${compile(part)}(input, position));`).join("\n")}\nresult.into_iter().collect()`; break;
      case "sequence": body = `let ${pattern.parts.length ? "mut " : ""}positions = vec![position];\n${pattern.parts.map(part => `{\nlet mut next = std::collections::BTreeSet::new();\nfor start in positions { next.extend(${compile(part)}(input, start)); }\npositions = next.into_iter().collect();\nif positions.is_empty() { return positions; }\n}`).join("\n")}\npositions`; break;
      case "repeat": body = `let mut positions = vec![position];
let mut result = std::collections::BTreeSet::new();
let limit = ${pattern.maximum ?? `(input.len() - position).saturating_add(${pattern.minimum})`};
for count in 0..=limit {
    if positions.is_empty() { break; }
    ${pattern.minimum ? `if count >= ${pattern.minimum} { result.extend(positions.iter().copied()); }` : "result.extend(positions.iter().copied());"}
    if count == limit { break; }
    let mut next = std::collections::BTreeSet::new();
    for &start in &positions { next.extend(${compile(pattern.part)}(input, start)); }
    if next.len() == positions.len() && positions.iter().all(|end| next.contains(end)) {
        // Nullable repetition can be padded to its minimum without advancing.
        result.extend(next);
        break;
    }
    positions = next.into_iter().collect();
}
result.into_iter().collect()`; break;
    }
    functions.push(`fn ${current}(${body.includes("input") ? "input" : "_input"}: &[u16], position: usize) -> Vec<usize> {\n${body}\n}`);
    return current;
  }
  const matcher = compile(parsePattern(source));
  return `fn ${name}(input: &[u16]) -> bool {\n(0..=input.len()).any(|position| !${matcher}(input, position).is_empty())\n}\n\n${functions.join("\n\n")}\n`;
}

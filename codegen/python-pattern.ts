// Translate the flag-free ECMAScript subset used by authored schemas. Matching
// runs on UTF-16 units, not Python code points. Unsupported syntax fails codegen.
type Range = readonly [number, number];
const whitespace: readonly Range[] = [[9, 13], [32, 32], [160, 160], [0x1680, 0x1680], [0x2000, 0x200a], [0x2028, 0x2029], [0x202f, 0x202f], [0x205f, 0x205f], [0x3000, 0x3000], [0xfeff, 0xfeff]];
function merge(ranges: readonly Range[]): Range[] {
  const result: [number, number][] = [];
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const last = result.at(-1);
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else result.push([start, end]);
  }
  return result;
}
function complement(ranges: readonly Range[]): Range[] {
  const result: Range[] = []; let start = 0;
  for (const [low, high] of merge(ranges)) {
    if (low > start) result.push([start, low - 1]);
    start = high + 1;
  }
  if (start <= 0xffff) result.push([start, 0xffff]);
  return result;
}
function character(value: number): string { return `\\u${value.toString(16).padStart(4, "0")}`; }
function characterClass(ranges: readonly Range[]): string {
  const values = merge(ranges);
  return values.length ? `[${values.map(([a, b]) => a === b ? character(a) : `${character(a)}-${character(b)}`).join("")}]` : "[^\\u0000-\\uffff]";
}

export function pythonPattern(source: string): string {
  new RegExp(source);
  let index = 0; let result = "";
  const unsupported = (): never => { throw new TypeError(`Unsupported ECMAScript pattern for Python: ${source}`); };
  function atom(): Range[] {
    const value = source.charCodeAt(index++);
    if (value !== 92) return [[value, value]];
    const escape = source[index++];
    const classes: Record<string, readonly Range[]> = { s: whitespace, d: [[48, 57]], w: [[48, 57], [65, 90], [95, 95], [97, 122]] };
    if (escape && classes[escape.toLowerCase()]) {
      const ranges = classes[escape.toLowerCase()]!;
      return escape === escape.toLowerCase() ? [...ranges] : complement(ranges);
    }
    if (escape === "u" || escape === "x") {
      const length = escape === "u" ? 4 : 2; const hex = source.slice(index, index + length);
      if (hex.length !== length || !/^[0-9a-f]+$/i.test(hex)) return unsupported();
      index += length; const point = parseInt(hex, 16); return [[point, point]];
    }
    const controls: Record<string, number> = { n: 10, r: 13, t: 9, v: 11, f: 12 };
    if (escape && controls[escape] !== undefined) return [[controls[escape]!, controls[escape]!]];
    if (escape && "^$\\.*+?()[]{}|/-".includes(escape)) return [[escape.charCodeAt(0), escape.charCodeAt(0)]];
    return unsupported();
  }
  while (index < source.length) {
    const token = source[index];
    if (token === "[") {
      index++; const negate = source[index] === "^"; if (negate) index++;
      const ranges: Range[] = [];
      while (index < source.length && source[index] !== "]") {
        const first = atom();
        if (source[index] === "-" && source[index + 1] !== "]") {
          index++; const last = atom();
          if (first.length !== 1 || last.length !== 1 || first[0]![0] !== first[0]![1] || last[0]![0] !== last[0]![1] || first[0]![0] > last[0]![0]) return unsupported();
          ranges.push([first[0]![0], last[0]![0]]);
        } else ranges.push(...first);
      }
      if (source[index++] !== "]") return unsupported();
      result += characterClass(negate ? complement(ranges) : ranges);
    } else if (token === "(") {
      index++;
      if (source[index] !== "?") result += "(?:";
      else if ([":", "=", "!"].includes(source[index + 1]!)) { result += `(?${source[index + 1]}`; index += 2; }
      else return unsupported();
    } else if (token === "{") {
      const quantifier = /^\{\d+(?:,\d*)?\}/.exec(source.slice(index));
      if (!quantifier) return unsupported();
      result += quantifier[0]; index += quantifier[0].length;
    } else if (token === ".") { result += "[^\\n\\r\\u2028\\u2029]"; index++; }
    else if (token === "^") { result += "\\A"; index++; }
    else if (token === "$") { result += "\\Z"; index++; }
    else if (token && ")|*+?".includes(token)) {
      // Python-only possessive quantifiers must never be introduced accidentally.
      if (token === "+" && /[+*?}]$/.test(source.slice(0, index))) return unsupported();
      result += token; index++;
    } else if (token === "]" || token === "}") return unsupported();
    else result += characterClass(atom());
  }
  return result;
}

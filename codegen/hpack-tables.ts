/** Compile the complete normative RFC 7541 tables, not a protocol template. */
export function renderHpackTables(raw: string): string {
  const staticSection = raw.slice(raw.indexOf("\nAppendix A.  Static Table Definition"), raw.indexOf("\nAppendix B.  Huffman Code"));
  const headers = [...staticSection.matchAll(/^[ \t]*\|[ \t]*(\d+)[ \t]*\|[ \t]*([^|\r\n]+?)[ \t]*\|[ \t]*([^|\r\n]*?)[ \t]*\|[ \t]*$/gm)];
  if (headers.length !== 61 || headers.some((row, index) => Number(row[1]) !== index + 1)) throw new TypeError("Incomplete HPACK static table");
  const codes = [...raw.matchAll(/\(\s*(\d+)\)\s+([|01]+)\s+([a-f0-9]+)\s+\[\s*(\d+)\]/g)];
  if (codes.length !== 257 || codes.some((row, index) => Number(row[1]) !== index)) throw new TypeError("Incomplete HPACK Huffman table");
  const nodes: [number, number, number][] = [[-1, -1, -1]];
  for (const row of codes) {
    const bits = row[2]!.replaceAll("|", "");
    if (bits.length !== Number(row[4]) || parseInt(bits, 2) !== parseInt(row[3]!, 16)) throw new TypeError("Inconsistent HPACK Huffman code");
    let node = 0;
    for (const bit of bits) {
      if (nodes[node]![2] !== -1) throw new TypeError("Non-prefix-free HPACK Huffman table");
      const edge = bit === "1" ? 1 : 0;
      if (nodes[node]![edge] === -1) { nodes[node]![edge] = nodes.length; nodes.push([-1, -1, -1]); }
      node = nodes[node]![edge];
    }
    if (nodes[node]!.some(value => value !== -1)) throw new TypeError("Non-prefix-free HPACK Huffman table");
    nodes[node]![2] = Number(row[1]);
  }
  return [
    '# Generated from RFC 7541 Appendices A/B by codegen/generate-clients.ts. Do not edit.',
    '# Copyright (c) 2015 IETF Trust and the persons identified as authors of RFC 7541.',
    '# Redistribution and use in source and binary forms, with or without',
    '# modification, are permitted provided that the following conditions are met:',
    '# 1. Redistributions of source code must retain the above copyright notice,',
    '#    this list of conditions and the following disclaimer.',
    '# 2. Redistributions in binary form must reproduce the above copyright notice,',
    '#    this list of conditions and the following disclaimer in the documentation',
    '#    and/or other materials provided with the distribution.',
    '# 3. Neither the name of Internet Society, IETF or IETF Trust, nor the names of',
    '#    specific contributors, may be used to endorse or promote products derived',
    '#    from this software without specific prior written permission.',
    '# THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"',
    '# AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE',
    '# IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE',
    '# ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE',
    '# LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR',
    '# CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF',
    '# SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS',
    '# INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN',
    '# CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)',
    '# ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE',
    '# POSSIBILITY OF SUCH DAMAGE.', "",
    "STATIC_TABLE: tuple[tuple[bytes, bytes], ...] = (",
    ...headers.map(row => `    (b${JSON.stringify(row[2]!.trim())}, b${JSON.stringify(row[3]!.trim())}),`), ")", "",
    "HUFFMAN: tuple[tuple[int, int, int], ...] = (",
    ...nodes.map(node => `    (${node.join(", ")}),`), ")", "",
  ].join("\n");
}

// MessagePack's standard scalar, binary, array and string-keyed map types.
// Extension types are deliberately unsupported: Fish's protocol does not use them.
export function encodeMessagePack(value: unknown): Uint8Array<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  const encoder = new TextEncoder();
  const header = (marker: number, length: number, size: number) => {
    const bytes = new Uint8Array(1 + size);
    bytes[0] = marker;
    const view = new DataView(bytes.buffer);
    if (size === 1) view.setUint8(1, length);
    else if (size === 2) view.setUint16(1, length);
    else if (size === 4) view.setUint32(1, length);
    chunks.push(bytes);
  };
  const write = (item: unknown, depth: number): void => {
    if (depth > 64) throw new TypeError("MessagePack nesting exceeds 64 levels");
    if (item === null || typeof item === "boolean") { header(item === null ? 0xc0 : item ? 0xc3 : 0xc2, 0, 0); return; }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new TypeError("MessagePack numbers must be finite");
      if (Number.isInteger(item) && item >= 0 && item <= 0x7f) header(item, 0, 0);
      else if (Number.isInteger(item) && item >= -32 && item < 0) header(256 + item, 0, 0);
      else if (Number.isInteger(item) && item >= 0 && item <= 0xff) header(0xcc, item, 1);
      else if (Number.isInteger(item) && item >= 0 && item <= 0xffff) header(0xcd, item, 2);
      else if (Number.isInteger(item) && item >= 0 && item <= 0xffffffff) header(0xce, item, 4);
      else if (Number.isInteger(item) && item >= -0x80000000 && item < 0) header(0xd2, item, 4);
      else {
        const bytes = new Uint8Array(9); bytes[0] = 0xcb;
        new DataView(bytes.buffer).setFloat64(1, item); chunks.push(bytes);
      }
      return;
    }
    if (typeof item === "string") {
      const bytes = encoder.encode(item);
      if (bytes.length < 32) header(0xa0 | bytes.length, 0, 0);
      else if (bytes.length <= 0xff) header(0xd9, bytes.length, 1);
      else if (bytes.length <= 0xffff) header(0xda, bytes.length, 2);
      else header(0xdb, bytes.length, 4);
      chunks.push(bytes); return;
    }
    if (item instanceof Uint8Array) {
      if (item.length <= 0xff) header(0xc4, item.length, 1);
      else if (item.length <= 0xffff) header(0xc5, item.length, 2);
      else header(0xc6, item.length, 4);
      chunks.push(item); return;
    }
    if (Array.isArray(item)) {
      if (item.length < 16) header(0x90 | item.length, 0, 0);
      else if (item.length <= 0xffff) header(0xdc, item.length, 2);
      else header(0xdd, item.length, 4);
      for (const child of item) write(child, depth + 1);
      return;
    }
    if (typeof item === "object" && item && (Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null)) {
      const entries = Object.entries(item).filter(([, child]) => child !== undefined);
      if (entries.length < 16) header(0x80 | entries.length, 0, 0);
      else if (entries.length <= 0xffff) header(0xde, entries.length, 2);
      else header(0xdf, entries.length, 4);
      for (const [key, child] of entries) { write(key, depth + 1); write(child, depth + 1); }
      return;
    }
    throw new TypeError("Unsupported MessagePack value");
  };
  write(value, 0);
  const output = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

export function decodeMessagePack(data: ArrayBuffer | ArrayBufferView): unknown {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let offset = 0;
  const take = (length: number) => {
    if (length > bytes.length - offset) throw new TypeError("Truncated MessagePack value");
    const result = bytes.subarray(offset, offset + length); offset += length; return result;
  };
  const number = (length: number, signed = false, float = false): number => {
    const part = take(length); const view = new DataView(part.buffer, part.byteOffset, part.byteLength);
    if (float) return length === 4 ? view.getFloat32(0) : view.getFloat64(0);
    if (length === 1) return signed ? view.getInt8(0) : view.getUint8(0);
    if (length === 2) return signed ? view.getInt16(0) : view.getUint16(0);
    if (length === 4) return signed ? view.getInt32(0) : view.getUint32(0);
    const value = Number(signed ? view.getBigInt64(0) : view.getBigUint64(0));
    if (!Number.isSafeInteger(value)) throw new TypeError("MessagePack integer exceeds the safe integer range");
    return value;
  };
  const array = (length: number, depth: number): unknown[] => {
    if (length > bytes.length - offset) throw new TypeError("Truncated MessagePack value");
    const result: unknown[] = [];
    for (let index = 0; index < length; index++) result.push(read(depth + 1));
    return result;
  };
  const map = (length: number, depth: number): Record<string, unknown> => {
    if (length > (bytes.length - offset) / 2) throw new TypeError("Truncated MessagePack value");
    const result: Record<string, unknown> = {};
    for (let index = 0; index < length; index++) {
      const key = read(depth + 1);
      if (typeof key !== "string") throw new TypeError("MessagePack map key is not a string");
      if (Object.hasOwn(result, key)) throw new TypeError("MessagePack map contains duplicate keys");
      Object.defineProperty(result, key, { value: read(depth + 1), enumerable: true, configurable: true, writable: true });
    }
    return result;
  };
  const read = (depth: number): unknown => {
    if (depth > 64) throw new TypeError("MessagePack nesting exceeds 64 levels");
    const marker = number(1);
    if (marker <= 0x7f) return marker;
    if (marker >= 0xe0) return marker - 256;
    if ((marker & 0xe0) === 0xa0) return decoder.decode(take(marker & 31));
    if ((marker & 0xf0) === 0x90) return array(marker & 15, depth);
    if ((marker & 0xf0) === 0x80) return map(marker & 15, depth);
    switch (marker) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xc4: return take(number(1));
      case 0xc5: return take(number(2));
      case 0xc6: return take(number(4));
      case 0xca: return number(4, false, true);
      case 0xcb: return number(8, false, true);
      case 0xcc: return number(1);
      case 0xcd: return number(2);
      case 0xce: return number(4);
      case 0xcf: return number(8);
      case 0xd0: return number(1, true);
      case 0xd1: return number(2, true);
      case 0xd2: return number(4, true);
      case 0xd3: return number(8, true);
      case 0xd9: return decoder.decode(take(number(1)));
      case 0xda: return decoder.decode(take(number(2)));
      case 0xdb: return decoder.decode(take(number(4)));
      case 0xdc: return array(number(2), depth);
      case 0xdd: return array(number(4), depth);
      case 0xde: return map(number(2), depth);
      case 0xdf: return map(number(4), depth);
      default: throw new TypeError(`Unsupported MessagePack marker: 0x${marker.toString(16)}`);
    }
  };
  const value = read(0);
  if (offset !== bytes.length) throw new TypeError("MessagePack frame contains trailing data");
  return value;
}

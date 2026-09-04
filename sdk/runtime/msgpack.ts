function pushInteger(output: number[], marker: number, value: number, bytes: number): void {
  output.push(marker);
  for (let shift = (bytes - 1) * 8; shift >= 0; shift -= 8) output.push((value >>> shift) & 0xff);
}

function encodeValue(value: unknown, output: number[]): void {
  if (value === null) { output.push(0xc0); return; }
  if (value === false) { output.push(0xc2); return; }
  if (value === true) { output.push(0xc3); return; }
  if (typeof value === "number") {
    if (Number.isInteger(value) && value >= 0 && value <= 0x7f) { output.push(value); return; }
    if (Number.isInteger(value) && value >= -32 && value < 0) { output.push(0x100 + value); return; }
    if (Number.isInteger(value) && value >= 0 && value <= 0xff) { pushInteger(output, 0xcc, value, 1); return; }
    if (Number.isInteger(value) && value >= 0 && value <= 0xffff) { pushInteger(output, 0xcd, value, 2); return; }
    const bytes = new Uint8Array(9);
    bytes[0] = 0xcb;
    new DataView(bytes.buffer).setFloat64(1, value);
    output.push(...bytes);
    return;
  }
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    if (bytes.length <= 31) output.push(0xa0 | bytes.length);
    else if (bytes.length <= 0xff) pushInteger(output, 0xd9, bytes.length, 1);
    else if (bytes.length <= 0xffff) pushInteger(output, 0xda, bytes.length, 2);
    else pushInteger(output, 0xdb, bytes.length, 4);
    output.push(...bytes);
    return;
  }
  if (value instanceof Uint8Array) {
    if (value.length <= 0xff) pushInteger(output, 0xc4, value.length, 1);
    else if (value.length <= 0xffff) pushInteger(output, 0xc5, value.length, 2);
    else pushInteger(output, 0xc6, value.length, 4);
    output.push(...value);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length <= 15) output.push(0x90 | value.length);
    else if (value.length <= 0xffff) pushInteger(output, 0xdc, value.length, 2);
    else pushInteger(output, 0xdd, value.length, 4);
    for (const item of value) encodeValue(item, output);
    return;
  }
  if (typeof value === "object" && value) {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    if (entries.length <= 15) output.push(0x80 | entries.length);
    else if (entries.length <= 0xffff) pushInteger(output, 0xde, entries.length, 2);
    else pushInteger(output, 0xdf, entries.length, 4);
    for (const [key, item] of entries) {
      encodeValue(key, output);
      encodeValue(item, output);
    }
    return;
  }
  throw new TypeError(`Cannot encode MessagePack value: ${typeof value}`);
}

export function encodeMessagePack(value: unknown): Uint8Array {
  const output: number[] = [];
  encodeValue(value, output);
  return Uint8Array.from(output);
}

class Decoder {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}

  private take(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length) throw new TypeError("Truncated MessagePack value");
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  private integer(length: number): number {
    let value = 0;
    for (const byte of this.take(length)) value = value * 256 + byte;
    return value;
  }

  private string(length: number): string {
    return new TextDecoder("utf-8", { fatal: true }).decode(this.take(length));
  }

  private array(length: number): unknown[] {
    return Array.from({ length }, () => this.value());
  }

  private map(length: number): Record<string, unknown> {
    const output: Record<string, unknown> = {};
    for (let index = 0; index < length; index++) {
      const key = this.value();
      if (typeof key !== "string") throw new TypeError("MessagePack map key is not a string");
      output[key] = this.value();
    }
    return output;
  }

  value(): unknown {
    const marker = this.integer(1);
    if (marker <= 0x7f) return marker;
    if (marker >= 0xe0) return marker - 0x100;
    if ((marker & 0xe0) === 0xa0) return this.string(marker & 0x1f);
    if ((marker & 0xf0) === 0x90) return this.array(marker & 0x0f);
    if ((marker & 0xf0) === 0x80) return this.map(marker & 0x0f);
    if (marker === 0xc0) return null;
    if (marker === 0xc2) return false;
    if (marker === 0xc3) return true;
    if (marker === 0xc4) return this.take(this.integer(1));
    if (marker === 0xc5) return this.take(this.integer(2));
    if (marker === 0xc6) return this.take(this.integer(4));
    if (marker === 0xcb) {
      const value = this.take(8);
      return new DataView(value.buffer, value.byteOffset, value.byteLength).getFloat64(0);
    }
    if (marker === 0xcc) return this.integer(1);
    if (marker === 0xcd) return this.integer(2);
    if (marker === 0xce) return this.integer(4);
    if (marker === 0xd0) { const value = this.take(1); return new DataView(value.buffer, value.byteOffset, 1).getInt8(0); }
    if (marker === 0xd1) { const value = this.take(2); return new DataView(value.buffer, value.byteOffset, 2).getInt16(0); }
    if (marker === 0xd2) { const value = this.take(4); return new DataView(value.buffer, value.byteOffset, 4).getInt32(0); }
    if (marker === 0xd9) return this.string(this.integer(1));
    if (marker === 0xda) return this.string(this.integer(2));
    if (marker === 0xdb) return this.string(this.integer(4));
    if (marker === 0xdc) return this.array(this.integer(2));
    if (marker === 0xdd) return this.array(this.integer(4));
    if (marker === 0xde) return this.map(this.integer(2));
    if (marker === 0xdf) return this.map(this.integer(4));
    throw new TypeError(`Unsupported MessagePack marker: 0x${marker.toString(16)}`);
  }

  done(): boolean { return this.offset === this.bytes.length; }
}

export function decodeMessagePack(data: ArrayBuffer | ArrayBufferView): unknown {
  const bytes = data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const decoder = new Decoder(bytes);
  const value = decoder.value();
  if (!decoder.done()) throw new TypeError("MessagePack frame contains trailing data");
  return value;
}

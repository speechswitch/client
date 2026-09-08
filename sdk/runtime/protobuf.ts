/** Scalar protobuf primitives; generated clients supply field numbers and types. */
export class ProtoWriter {
  private readonly chunks: Uint8Array[] = [];
  uint32(value: number): this {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new TypeError("Invalid protobuf uint32");
    const bytes: number[] = [];
    do { const byte = value % 128; value = Math.floor(value / 128); bytes.push(byte | (value ? 128 : 0)); } while (value);
    this.chunks.push(Uint8Array.from(bytes)); return this;
  }
  int32(value: number): this {
    if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw new TypeError("Invalid protobuf int32");
    if (value >= 0) return this.uint32(value);
    let wide = BigInt.asUintN(64, BigInt(value)); const bytes: number[] = [];
    do { const byte = Number(wide & 127n); wide >>= 7n; bytes.push(byte | (wide ? 128 : 0)); } while (wide);
    this.chunks.push(Uint8Array.from(bytes)); return this;
  }
  bool(value: boolean): this {
    if (typeof value !== "boolean") throw new TypeError("Invalid protobuf bool");
    return this.uint32(value ? 1 : 0);
  }
  double(value: number): this {
    if (!Number.isFinite(value)) throw new TypeError("Invalid protobuf double");
    const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, value, true);
    this.chunks.push(bytes); return this;
  }
  bytes(value: Uint8Array): this {
    if (!(value instanceof Uint8Array)) throw new TypeError("Invalid protobuf bytes");
    this.uint32(value.byteLength); this.chunks.push(value); return this;
  }
  string(value: string): this {
    if (typeof value !== "string") throw new TypeError("Invalid protobuf string");
    return this.bytes(new TextEncoder().encode(value));
  }
  finish(): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(this.chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
    let offset = 0; for (const chunk of this.chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  }
}

export class ProtoReader {
  private offset = 0;
  private readonly data: Uint8Array;
  constructor(data: Uint8Array) { this.data = data; }
  get done(): boolean { return this.offset === this.data.byteLength; }
  private take(length: number): Uint8Array {
    if (length > this.data.byteLength - this.offset) throw new TypeError("Truncated protobuf message");
    const value = this.data.subarray(this.offset, this.offset + length); this.offset += length; return value;
  }
  private varint(): bigint {
    let result = 0n;
    for (let index = 0; index < 10; index++) {
      const byte = this.take(1)[0]!;
      if (index === 9 && byte > 1) throw new TypeError("Invalid protobuf varint");
      result |= BigInt(byte & 127) << BigInt(index * 7);
      if (!(byte & 128)) return result;
    }
    throw new TypeError("Invalid protobuf varint");
  }
  uint32(): number {
    const value = this.varint();
    if (value > 0xffffffffn) throw new TypeError("Invalid protobuf uint32");
    return Number(value);
  }
  int32(): number { return Number(BigInt.asIntN(32, this.varint())); }
  bool(): boolean { return this.varint() !== 0n; }
  double(): number {
    const bytes = this.take(8); return new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0, true);
  }
  bytes(): Uint8Array { return this.take(this.uint32()); }
  string(): string { return new TextDecoder("utf-8", { fatal: true }).decode(this.bytes()); }
  skip(wire: number): void {
    switch (wire) {
      case 0: this.varint(); return;
      case 1: this.take(8); return;
      case 2: this.bytes(); return;
      case 5: this.take(4); return;
      default: throw new TypeError(`Unsupported protobuf wire type: ${wire}`);
    }
  }
}

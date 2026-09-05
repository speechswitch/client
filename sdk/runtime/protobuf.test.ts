import { expect, test } from "bun:test";
import { ProtoReader, ProtoWriter } from "./protobuf.ts";
import { decodeStreamingResponse } from "../generated/clients/google-grpc.ts";

test("protobuf scalar bytes match standard independent examples", () => {
  expect(new ProtoWriter().uint32(150).finish()).toEqual(Uint8Array.of(0x96, 1));
  expect(new ProtoWriter().int32(-1).finish()).toEqual(Uint8Array.of(255, 255, 255, 255, 255, 255, 255, 255, 255, 1));
  expect(new ProtoWriter().string("testing").finish()).toEqual(Uint8Array.of(7, 116, 101, 115, 116, 105, 110, 103));
  expect(new ProtoWriter().double(1).finish()).toEqual(Uint8Array.of(0, 0, 0, 0, 0, 0, 240, 63));
  expect(new ProtoReader(Uint8Array.of(0x96, 1)).uint32()).toBe(150);
  expect(new ProtoReader(Uint8Array.of(255, 255, 255, 255, 255, 255, 255, 255, 255, 1)).int32()).toBe(-1);
});

test("protobuf decoder skips unknown scalar fields without shifting known audio", () => {
  const bytes = Uint8Array.of(16, 150, 1, 29, 0, 0, 0, 0, 10, 2, 1, 2);
  expect(decodeStreamingResponse(bytes)).toEqual({ audioContent: Uint8Array.of(1, 2) });
});

test.each([
  { bytes: [10, 2, 1], message: "Truncated protobuf message" },
  { bytes: [0], message: "Invalid protobuf field number" },
  { bytes: [8, 1], message: "Invalid protobuf wire type for StreamingSynthesizeResponse.audioContent" },
  { bytes: [255, 255, 255, 255, 255, 255, 255, 255, 255, 255], message: "Invalid protobuf varint" },
])("protobuf rejects malformed response $message", ({ bytes, message }) => {
  expect(() => decodeStreamingResponse(Uint8Array.from(bytes))).toThrow(new TypeError(message));
});

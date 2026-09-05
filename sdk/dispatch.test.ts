import { expectTypeOf, test } from "bun:test";
import type { Provider } from "./dispatch.ts";

test("the registry exposes the integrations", () => {
  expectTypeOf<Provider>().toEqualTypeOf<"amazon" | "async" | "camb" | "cartesia" | "deepdub" | "deepgram" | "xai">();
});

import { expectTypeOf, test } from "bun:test";
import type { Provider } from "./dispatch.ts";

test("the registry exposes the integrations", () => {
  expectTypeOf<Provider>().toEqualTypeOf<
    "amazon" | "deepgram" | "elevenlabs" | "fish" | "google" | "gradium" | "xai"
  >();
});

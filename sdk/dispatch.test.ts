import { expectTypeOf, test } from "bun:test";
import type { Provider } from "./dispatch.ts";

test("the baseline registry contains no integrations", () => {
  expectTypeOf<Provider>().toBeNever();
});

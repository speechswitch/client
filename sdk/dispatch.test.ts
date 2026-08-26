import { expectTypeOf, test } from "bun:test";
import type { Provider } from "./dispatch.ts";

test("the registry exposes Amazon", () => {
  expectTypeOf<Provider>().toEqualTypeOf<"amazon">();
});

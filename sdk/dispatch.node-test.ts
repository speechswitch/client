import type { Equal } from "../test-support/types.ts";
import { test } from "node:test";
import type { Provider } from "./dispatch.ts";

test("the registry exposes the integrations", () => {
  true satisfies Equal<Provider, "amazon" | "xai">;
});

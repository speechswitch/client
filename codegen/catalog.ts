import { z } from "zod";

export const sourceFormatSchema = z.enum([
  "openapi",
  "asyncapi",
  "json-schema",
  "discovery",
  "service-model",
  "typespec",
]);

export const sourceSchema = z.object({
  id: z.string().min(1),
  format: sourceFormatSchema,
  path: z.string().min(1),
}).strict();

export const catalogSchema = z.object({
  sources: z.array(sourceSchema),
}).strict();

export type Source = z.infer<typeof sourceSchema>;
export type Catalog = z.infer<typeof catalogSchema>;

export function parseCatalog(value: unknown): Catalog {
  const catalog = catalogSchema.parse(value);
  const ids = new Set<string>();
  for (const source of catalog.sources) {
    if (ids.has(source.id)) throw new TypeError(`Duplicate source id: ${source.id}`);
    ids.add(source.id);
  }
  return catalog;
}

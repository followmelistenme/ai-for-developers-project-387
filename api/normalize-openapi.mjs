import { readFile, writeFile } from "node:fs/promises"
import { isDeepStrictEqual } from "node:util"
import { parse, stringify } from "yaml"

const [path] = process.argv.slice(2)
const document = parse(await readFile(path, "utf8"))

function normalizeSchema(schema) {
  // kin-openapi 0.152 does not reject extra fields for the emitter's { not: {} } seal.
  if (isDeepStrictEqual(schema.additionalProperties, { not: {} })) {
    schema.additionalProperties = false
  }
  // Keep integral-only enums mapped to integer types in the Go generator.
  if (schema.type === "number" && schema.enum?.length && schema.enum.every(Number.isSafeInteger)) {
    schema.type = "integer"
  }
  const children = [
    schema.items,
    schema.additionalProperties,
    schema.not,
    ...Object.values(schema.properties ?? {}),
    ...(schema.allOf ?? []),
    ...(schema.anyOf ?? []),
    ...(schema.oneOf ?? []),
  ]
  for (const child of children) {
    if (child && typeof child === "object") normalizeSchema(child)
  }
}

for (const schema of Object.values(document.components?.schemas ?? {})) normalizeSchema(schema)
await writeFile(path, "# Generated from TypeSpec. Run mise run generate.\n" + stringify(document, { lineWidth: 0 }))

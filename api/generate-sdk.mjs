import { createClient } from "@hey-api/openapi-ts"
import { readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { format } from "prettier"

const [input, output] = process.argv.slice(2)
if (!input || !output) throw new Error("Expected the OpenAPI input and SDK output paths")

await createClient({
  input,
  output,
  plugins: ["@hey-api/typescript", "@hey-api/sdk", "@hey-api/client-fetch"],
})

for (const file of await readdir(output, { recursive: true })) {
  if (!file.endsWith(".ts")) continue
  const path = join(output, file)
  const source = await readFile(path, "utf8")
  await writeFile(path, await format(source, {
    parser: "typescript",
    semi: false,
    singleQuote: false,
    tabWidth: 2,
  }))
}

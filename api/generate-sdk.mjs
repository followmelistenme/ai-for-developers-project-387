import { createClient } from "@hey-api/openapi-ts"
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { format } from "prettier"

const apiDirectory = dirname(fileURLToPath(import.meta.url))
const destination = resolve(apiDirectory, "../frontend/src/api/generated")
const check = process.argv.includes("--check")
const temporary = check ? await mkdtemp(join(tmpdir(), "booking-sdk-")) : undefined

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    if (entry.isDirectory()) return (await files(join(directory, entry.name))).map((name) => join(entry.name, name))
    return [entry.name]
  }))
  return nested.flat().sort()
}

try {
  const output = temporary ?? destination
  await createClient({
    input: join(apiDirectory, "openapi.yaml"),
    output,
    plugins: ["@hey-api/typescript", "@hey-api/sdk", "@hey-api/client-fetch"],
  })
  for (const file of await files(output)) {
    if (!file.endsWith(".ts")) continue
    const path = join(output, file)
    const source = await readFile(path, "utf8")
    await writeFile(path, await format(source, { parser: "typescript", semi: false, singleQuote: false, tabWidth: 2 }))
  }
  if (check) {
    const expected = await files(output)
    const actual = await files(destination)
    let matches = JSON.stringify(actual) === JSON.stringify(expected)
    for (const file of expected) {
      if (!actual.includes(file)) continue
      const [generated, committed] = await Promise.all([readFile(join(output, file)), readFile(join(destination, file))])
      if (!generated.equals(committed)) matches = false
    }
    if (!matches) throw new Error("Client SDK generation is stale; run mise run generate")
  }
} finally {
  if (temporary) await rm(temporary, { recursive: true, force: true })
}

import { fileURLToPath, URL } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env }
  const proxy = { "/api": { target: env.API_TARGET ?? "http://127.0.0.1:8080" } }
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: { host: env.FRONTEND_HOST ?? "127.0.0.1", port: Number(env.FRONTEND_PORT ?? 5173), proxy },
    preview: { proxy },
  }
})

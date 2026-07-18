import { registerProvider } from "@flue/runtime";
import { flue } from "@flue/runtime/routing";
import { Hono } from "hono";

// Route anthropic/* models through a gateway or proxy without changing model
// specifiers, e.g. ANTHROPIC_BASE_URL=https://ai-gateway.vercel.sh.
if (process.env.ANTHROPIC_BASE_URL) {
  registerProvider("anthropic", {
    baseUrl: process.env.ANTHROPIC_BASE_URL,
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
}

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));
app.route("/", flue());

export default app;

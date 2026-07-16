import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Builds to /dist, which is what Cloudflare Pages / Vercel serve.
export default defineConfig({ plugins: [react()] });

// ============================================================
// El Corazon — one-time project scaffolder.
//
// HOW TO USE (Windows / macOS / Linux, Node 18+):
//   1. Put this file in a NEW empty folder, e.g. G:\Claude Playground\CoWork\el-corazon-web
//   2. Open a terminal in that folder and run:  node scaffold.mjs
//   3. Then:  npm install
//   4. Copy your ElCorazonWebApp_5.jsx over src/App.jsx (see notes it prints)
//   5. Run locally:  npm run dev
//
// It creates a deploy-ready Vite + React project. Safe to re-run:
// it will NOT overwrite files that already exist (so your src/App.jsx
// and .env are protected once you've edited them).
// ============================================================

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const files = {
  "package.json": `{
  "name": "el-corazon-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.4",
    "vite": "^5.4.11"
  }
}
`,

  "vite.config.js": `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Builds to /dist, which is what Cloudflare Pages / Vercel serve.
export default defineConfig({ plugins: [react()] });
`,

  "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>El Corazon Body Corporate</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`,

  ".gitignore": `node_modules
dist
.env
.env.local
.DS_Store
*.log
`,

  ".env.example": `# Copy to ".env" and fill in real values. Browser-safe: the
# publishable/anon key is meant to be shipped to the client;
# Row-Level Security is what actually protects your data.
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_KEY=sb_publishable_xxxxxxxx
`,

  ".env": `# Local dev values (gitignored — never commit this file).
VITE_SUPABASE_URL=https://ctqyxxlnnrgtyyxubsle.supabase.co
VITE_SUPABASE_KEY=sb_publishable_N-VK52qyVB2MvvZDBzEXUQ_w720L3Sz
`,

  "public/_redirects": `/*    /index.html   200
`,

  "vercel.json": `{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
`,

  "src/main.jsx": `import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`,

  "src/App.jsx": `// PLACEHOLDER — replace this file with your real app.
//
// 1. Copy your latest ElCorazonWebApp_5.jsx over this file (keep name src/App.jsx).
// 2. Ensure it ends with a DEFAULT export:  export default function App() { ... }
//    (or add at the bottom:  export default ElCorazonWebApp;)
// 3. In the "Supabase (database)" section, replace the two hard-coded lines with:
//       const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
//       const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;
//    Your real values already live in .env.

export default function App() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 640, margin: "80px auto", padding: "0 24px", lineHeight: 1.6, color: "#1B2A38" }}>
      <h1 style={{ fontSize: 22 }}>El Corazon web app — scaffold ready</h1>
      <p>Replace <code>src/App.jsx</code> with your <code>ElCorazonWebApp_5.jsx</code>, switch the two Supabase config lines to <code>import.meta.env.VITE_SUPABASE_URL</code> / <code>VITE_SUPABASE_KEY</code>, then reload.</p>
    </div>
  );
}
`,
};

let created = 0, skipped = 0;
for (const [path, contents] of Object.entries(files)) {
  if (existsSync(path)) { console.log("skip (exists): " + path); skipped++; continue; }
  mkdirSync(dirname(path) === "" ? "." : dirname(path), { recursive: true });
  writeFileSync(path, contents);
  console.log("created: " + path);
  created++;
}

console.log(`\nDone. ${created} created, ${skipped} skipped.`);
console.log("\nNext steps:");
console.log("  1. npm install");
console.log("  2. Copy ElCorazonWebApp_5.jsx over src/App.jsx (default export + env config lines)");
console.log("  3. npm run dev   (local)   /   npm run build   (production -> dist/)");

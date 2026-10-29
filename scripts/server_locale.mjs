// Server locale per provare landing e web app con il Worker vero (senza Cloudflare). Uso: node scripts/server_locale.mjs . (porta 8787)
import http from "node:http"; import { readFile } from "node:fs/promises"; import path from "node:path";
const radice = process.argv[2]; const { default: worker } = await import(path.join(radice, "worker/index.js"));
const tipi = { ".html":"text/html; charset=utf-8", ".css":"text/css", ".js":"text/javascript", ".png":"image/png", ".svg":"image/svg+xml", ".webmanifest":"application/manifest+json", ".woff":"font/woff" };
const ASSETS = { fetch: async (req) => { let p = new URL(req.url).pathname; if (p.endsWith("/")) p += "index.html";
  try { const b = await readFile(path.join(radice, "landing", p)); return new Response(b, { headers: { "content-type": tipi[path.extname(p)] || "application/octet-stream", "content-security-policy": "script-src 'none'" } }); } catch { return new Response("404", { status: 404 }); } } };
http.createServer(async (q, s) => { const r = await worker.fetch(new Request("http://localhost:8787" + q.url, { method: q.method }), { ASSETS });
  s.writeHead(r.status, Object.fromEntries(r.headers)); s.end(Buffer.from(await r.arrayBuffer())); }).listen(8787);

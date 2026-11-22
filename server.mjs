import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const assets = new Map([
  ["/", ["index.html", "text/html"]],
  ["/index.html", ["index.html", "text/html"]],
  ["/styles.css", ["styles.css", "text/css"]],
  ["/app.js", ["app.js", "text/javascript"]],
  ["/model.js", ["model.js", "text/javascript"]],
]);
const port = Number(process.env.PORT ?? 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer between 1 and 65535.");
const server = createServer(async (request, response) => {
  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed");
    return;
  }
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/favicon.ico") { response.writeHead(204).end(); return; }
  const asset = assets.get(path);
  if (!asset) { response.writeHead(404).end("Not found"); return; }
  try {
    const body = await readFile(new URL(asset[0], import.meta.url));
    response.writeHead(200, { "Content-Type": `${asset[1]}; charset=utf-8`, "Cache-Control": "no-store" });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch (error) {
    console.error(`Could not serve ${asset[0]}:`, error);
    response.writeHead(500).end("Could not load application asset");
  }
});
server.on("error", error => { console.error("Local server failed:", error); process.exitCode = 1; });
server.listen(port, "127.0.0.1", () => console.log(`Gather is ready at http://localhost:${port}`));

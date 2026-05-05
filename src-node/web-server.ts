import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { invokeCommand } from "./commands.js";

export interface WebServerOptions {
  host: string;
  port: number;
  distDir: string;
}

export function startWebServer(options: WebServerOptions): http.Server {
  const server = http.createServer((request, response) => {
    void handleRequest(request, response, options.distDir);
  });

  server.listen(options.port, options.host, () => {
    console.log(
      `Codex Switcher web server listening on http://${options.host}:${options.port}`
    );
    console.log(`Serving static files from ${options.distDir}`);
  });

  return server;
}

async function handleRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  distDir: string
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.method === "GET" && url.pathname === "/api/health") {
    respondJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/invoke/")) {
    const command = decodeURIComponent(url.pathname.slice("/api/invoke/".length));
    try {
      const payload = await readJsonBody(request);
      const result = await invokeCommand(command, payload);
      respondJson(response, 200, result ?? null);
    } catch (error) {
      respondJson(response, 400, { error: formatError(error) });
    }
    return;
  }

  if (request.method === "GET") {
    serveStatic(response, distDir, url.pathname);
    return;
  }

  respondText(response, 405, "Method Not Allowed", "text/plain; charset=utf-8");
}

function serveStatic(
  response: http.ServerResponse,
  distDir: string,
  pathname: string
): void {
  let requested: string;
  try {
    requested =
      pathname === "/"
        ? "index.html"
        : sanitizePath(decodeURIComponent(pathname.replace(/^\/+/, "")));
  } catch {
    respondText(response, 400, "Bad Request", "text/plain; charset=utf-8");
    return;
  }
  const candidate = path.join(distDir, requested);

  if (isInside(distDir, candidate) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    response.writeHead(200, {
      "Content-Type": mimeTypeForPath(candidate),
      "Cache-Control": "no-cache",
    });
    response.end(fs.readFileSync(candidate));
    return;
  }

  if (path.extname(requested)) {
    respondText(response, 404, "Not Found", "text/plain; charset=utf-8");
    return;
  }

  const indexPath = path.join(distDir, "index.html");
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  response.end(fs.readFileSync(indexPath));
}

function sanitizePath(rawPath: string): string {
  const normalized = path.normalize(rawPath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error("Invalid request path");
  }
  return normalized;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function readJsonBody(
  request: http.IncomingMessage
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  return JSON.parse(text) as Record<string, unknown>;
}

function respondJson(
  response: http.ServerResponse,
  statusCode: number,
  payload: unknown
): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function respondText(
  response: http.ServerResponse,
  statusCode: number,
  body: string,
  contentType: string
): void {
  response.writeHead(statusCode, { "Content-Type": contentType });
  response.end(body);
}

function mimeTypeForPath(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".ico":
      return "image/x-icon";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

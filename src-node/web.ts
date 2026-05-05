import path from "node:path";
import { startWebServer } from "./web-server.js";

const host = process.env.CODEX_SWITCHER_WEB_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.CODEX_SWITCHER_WEB_PORT ?? "3210", 10);
const distDir = path.resolve(process.cwd(), "dist");

startWebServer({
  host,
  port: Number.isFinite(port) ? port : 3210,
  distDir,
});

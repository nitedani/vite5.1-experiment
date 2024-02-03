import { createServer, createViteRuntime } from "vite";
import http from "http";
import util from "util";
import react from "@vitejs/plugin-react";
import { initializeRenderPage } from "./server/ssr.js";

start();

async function start() {
  const entry = "./server/index.js";
  const vite = await createServer({
    appType: "custom",
    server: { middlewareMode: true },
    plugins: [
      react(),
      {
        transform(code, id) {
          if (id === resolvedEntry?.id) {
            return (
              code +
              `
              if (import.meta.hot) {
                import.meta.hot.on("vite:beforeFullReload", async () => {
                  console.log("vite:beforeFullReload")
                  await global.closeAllServers();
                });
              }
              `
            );
          }
        },
      },
    ],
  });

  const resolvedEntry = await vite.pluginContainer.resolveId(entry, undefined, {
    ssr: true,
  });

  initializeRenderPage(vite);
  removeViteMiddlewares(vite);
  patchHttp(vite);
  const runtime = await createViteRuntime(vite);
  runtime.executeEntrypoint(entry);
}

let httpServers = [];
let sockets = [];
function patchHttp(vite) {
  const originalCreateServer = http.createServer.bind(http.createServer);
  http.createServer = (...args) => {
    const httpServer = originalCreateServer(...args);
    httpServer.on("connection", (socket) => {
      sockets.push(socket);
      socket.on("close", () => {
        sockets = sockets.filter((socket) => !socket.closed);
      });
    });

    httpServer.on("listening", () => {
      const listeners = httpServer.listeners("request");
      httpServer.removeAllListeners("request");
      httpServer.on("request", (req, res) => {
        vite.middlewares(req, res, () => {
          for (const listener of listeners) {
            listener(req, res);
          }
        });
      });
    });
    httpServers.push(httpServer);
    return httpServer;
  };
}

global.closeAllServers = closeAllServers;
async function closeAllServers() {
  console.log("Closing all http servers");
  const promise = Promise.all([
    ...sockets.map((socket) => socket.destroy()),
    ...httpServers.map((httpServer) =>
      util.promisify(httpServer.close.bind(httpServer))()
    ),
  ]);
  sockets = [];
  httpServers = [];
  await promise;
}

function removeViteMiddlewares(vite) {
  for (const name of [
    "vite404Middleware",
    "viteHtmlFallbackMiddleware",
    "viteIndexHtmlMiddleware",
  ]) {
    vite.middlewares.stack = vite.middlewares.stack.filter(
      (e) => e.handle.name !== name
    );
  }
}

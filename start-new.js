import { createServer, createViteRuntime } from "vite";
import http from "http";
import util from "util";
import react from "@vitejs/plugin-react";
import { initializeRenderPage } from "./server/ssr.js";

start();

async function start() {
  const vite = await createServer({
    appType: "custom",
    server: { middlewareMode: true },
    plugins: [
      react(),
      {
        handleHotUpdate() {
          // I need to run this only on updates of "./server/index.js"
          // right now it is also called on updates for "./src/App.jsx"
          closeAllServers();
        },
      },
    ],
  });

  initializeRenderPage(vite);
  removeViteMiddlewares(vite);
  patchHttp(vite);
  const runtime = await createViteRuntime(vite);
  runtime.executeEntrypoint("./server/index.js");
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

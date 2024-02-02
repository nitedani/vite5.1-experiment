import { createServer } from "vite";
import http from "http";
import util from "util";
import react from "@vitejs/plugin-react";
import { initializeRenderPage } from "./server/ssr.js";

start();

let entryDeps;

async function start() {
  const serverEntry = "./server/index.js";
  const vite = await createServer({
    appType: "custom",
    server: { middlewareMode: true },
    plugins: [
      react(),
      {
        async handleHotUpdate(ctx) {
          if (
            !entryDeps ||
            ctx.modules.some((module) => module.id && entryDeps.has(module.id))
          ) {
            await closeAllServers();
            await loadEntry(vite, serverEntry);
          }
        },
      },
    ],
  });

  initializeRenderPage(vite);
  removeViteMiddlewares(vite);
  patchHttp(vite);
  loadEntry(vite, serverEntry);
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

async function loadEntry(vite, entry) {
  console.log("Loading server entry");
  const resolved = await vite.pluginContainer.resolveId(entry, undefined, {
    ssr: true,
  });
  if (!resolved) {
    console.error(`Server entry "${entry}" not found`);
    return;
  }
  await vite.ssrLoadModule(resolved.id);
  entryDeps = new Set([resolved.id]);
  for (const id of entryDeps) {
    const module = vite.moduleGraph.getModuleById(id);
    if (!module) {
      continue;
    }
    if (!module.ssrTransformResult) {
      module.ssrTransformResult = await vite.transformRequest(id, {
        ssr: true,
      });
    }
    for (const newDep of module.ssrTransformResult?.deps || []) {
      if (!newDep.startsWith("/")) {
        continue;
      }
      let newId;
      if (newDep.startsWith("/@id/")) {
        newId = newDep.slice(5);
      } else {
        const resolved = await vite.pluginContainer.resolveId(newDep, id, {
          ssr: true,
        });
        if (!resolved) {
          continue;
        }
        newId = resolved.id;
      }
      entryDeps.add(newId);
    }
  }
}

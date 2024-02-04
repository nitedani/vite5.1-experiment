import react from "@vitejs/plugin-react";
import { createBirpc } from "birpc";
import http from "http";
import { createServer } from "vite";
import { SHARE_ENV, Worker } from "worker_threads";
import vike from "vike/plugin";
import { stringify, parse } from "devalue";

const entryPath = "./server/index.js";
const workerPath = "./worker.js";
const httpPort = 3333;

start();

async function start() {
  const vite = await createServer({
    appType: "custom",
    server: { middlewareMode: true },
    plugins: [
      react(),
      vike(),
      {
        async handleHotUpdate(ctx) {
          if (ctx.modules.some((m) => entryDeps.has(m.id))) {
            await restartWorker();
          }
        },
      },
    ],
  });

  const httpServer = http.createServer(vite.middlewares);
  httpServer.listen(httpPort);

  let worker;
  let entryDeps;
  async function restartWorker() {
    if (worker) {
      await worker.terminate();
    }

    worker = new Worker(workerPath, { env: SHARE_ENV });
    entryDeps = new Set();

    const rpc = createBirpc(
      {
        fetchModule: async (id, importer) => {
          const result = await vite.ssrFetchModule(id, importer);
          if (result.file) {
            entryDeps.add(result.file);
          }
          return result;
        },
        moduleGraphResolveUrl(url) {
          return vite.moduleGraph.resolveUrl(url);
        },
        transformIndexHtml(url, html, originalUrl) {
          return vite.transformIndexHtml(url, html, originalUrl);
        },
      },
      {
        post: (data) => worker.postMessage(data),
        on: (data) => worker.on("message", data),
        serialize: (v) => stringify(v),
        deserialize: (v) => parse(v),
      }
    );

    const globalObjectOriginal = global._vike["globalContext.ts"];
    globalObjectOriginal.viteDevServer.config.configVikePromise =
      await globalObjectOriginal.viteDevServer.config.configVikePromise;
    const { viteDevServer, viteConfig } = globalObjectOriginal;
    const cleaned = {
      viteDevServer: removeFunctions(viteDevServer),
      viteConfig: removeFunctions(viteConfig),
    };
    await rpc.start(vite.config.root, entryPath, httpPort, stringify(cleaned));
  }

  restartWorker();
}

function removeFunctions(object, visited = new WeakSet()) {
  if (visited.has(object)) {
    return;
  }
  if (object === null || typeof object === "string") {
    return object;
  }
  visited.add(object);
  const output = {};
  Object.keys(object).forEach((key) => {
    if (object[key] !== undefined && typeof object[key] !== "function") {
      if (typeof object[key] === "object") {
        if (Array.isArray(object[key])) {
          output[key] = [];
          for (const e of object[key]) {
            output[key].push(removeFunctions(e, visited));
          }
        } else {
          const value = removeFunctions(object[key], visited);
          output[key] = value;
        }
      } else {
        output[key] = object[key];
      }
    }
  });
  return output;
}

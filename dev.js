import react from "@vitejs/plugin-react";
import { createBirpc } from "birpc";
import http from "http";
import { createServer } from "vite";
import { SHARE_ENV, Worker } from "worker_threads";
import vike from "vike/plugin";

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
        serialize: (v) => JSON.stringify(v),
        deserialize: (v) => JSON.parse(v),
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
    await rpc.start(vite.config.root, entryPath, httpPort, cleaned);
  }

  restartWorker();
}

function removeFunctions(obj) {
  const seenObjects = new WeakSet();

  function helper(currentObj) {
    if (currentObj === null || typeof currentObj !== "object") {
      return currentObj;
    }

    if (seenObjects.has(currentObj)) {
      return;
    }
    seenObjects.add(currentObj);

    let newObj = Array.isArray(currentObj) ? [] : {};
    for (let key in currentObj) {
      if (Object.hasOwn(currentObj, key)) {
        let value = currentObj[key];
        if (typeof value === "function") {
          continue;
        } else if (typeof value === "object") {
          value = helper(value);
        }
        newObj[key] = value;
      }
    }
    return newObj;
  }

  return helper(obj);
}

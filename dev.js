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
          const mods = ctx.modules.map((m) => m.id).filter(Boolean);
          const shouldRestart = await rpc.invalidateDepTree(mods);
          if (shouldRestart) {
            await restartWorker();
          }
        },
      },
    ],
  });

  const httpServer = http.createServer(vite.middlewares);
  httpServer.listen(httpPort);

  let rpc;
  let worker;

  async function restartWorker() {
    if (worker) {
      await worker.terminate();
    }

    worker = new Worker(workerPath, { env: SHARE_ENV });

    rpc = createBirpc(
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
        moduleGraphGetModuleById(id) {
          return removeFunctions(vite.moduleGraph.getModuleById(id));
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

    const originalInvalidateModule = vite.moduleGraph.invalidateModule.bind(
      vite.moduleGraph
    );
    vite.moduleGraph.invalidateModule = (mod, ...rest) => {
      if (mod.id) {
        rpc.deleteByModuleId(mod.id);
      }
      return originalInvalidateModule(mod, ...rest);
    };
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

    let newObj;
    if (currentObj instanceof Set) {
      newObj = new Set();
      for (let value of currentObj) {
        if (typeof value !== "function") {
          newObj.add(helper(value));
        }
      }
    } else if (currentObj instanceof Map) {
      newObj = new Map();
      for (let [key, value] of currentObj) {
        if (typeof value !== "function") {
          newObj.set(key, helper(value));
        }
      }
    } else {
      newObj = Array.isArray(currentObj) ? [] : {};
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
    }
    return newObj;
  }

  return helper(obj);
}

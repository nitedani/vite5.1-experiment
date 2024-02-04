import { createBirpc } from "birpc";
import http from "http";
import { Readable } from "stream";
import { ESModulesRunner, ViteRuntime } from "vite/runtime";
import { parentPort } from "worker_threads";
import { stringify, parse } from "devalue";

let runtime;

const rpc = createBirpc(
  {
    start,
    deleteByModuleId: (mod) => runtime.moduleCache.deleteByModuleId(mod),
    invalidateDepTree: (mods) => {
      const shouldRestart = mods.some(
        (m) => runtime.moduleCache.get(m).evaluated
      );
      runtime.moduleCache.invalidateDepTree(mods);
      return shouldRestart;
    },
  },
  {
    post: (data) => parentPort.postMessage(data),
    on: (data) => parentPort.on("message", data),
    serialize: (v) => stringify(v),
    deserialize: (v) => parse(v),
  }
);

async function start(root, entry, httpPort, globalObject) {
  console.log(`Loading server entry ${entry}`);
  globalObject.viteDevServer.ssrLoadModule = (id) => runtime.executeUrl(id);
  globalObject.viteDevServer.transformIndexHtml = rpc.transformIndexHtml;
  globalObject.viteDevServer.moduleGraph = {
    resolveUrl: rpc.moduleGraphResolveUrl,
    getModuleById: rpc.moduleGraphGetModuleById,
  };
  global._vike ??= {};
  global._vike["globalContext.ts"] = globalObject;

  patchHttp(httpPort);
  runtime = new ViteRuntime(
    {
      fetchModule: rpc.fetchModule,
      root,
      hmr: false,
    },
    new ESModulesRunner()
  );

  await runtime.executeUrl(entry);
}

function patchHttp(httpPort) {
  global.__proxyReq = async (req) => {
    delete req.headers["if-none-match"];
    const result = await fetch(`http://127.0.0.1:${httpPort}${req.url}`, {
      headers: req.headers,
    });
    return result;
  };

  const originalCreateServer = http.createServer.bind(http.createServer);
  http.createServer = (...args) => {
    const httpServer = originalCreateServer(...args);
    httpServer.on("listening", () => {
      const listeners = httpServer.listeners("request");
      httpServer.removeAllListeners("request");
      httpServer.on("request", async (req, res) => {
        const result = await __proxyReq(req);
        if (result.ok) {
          res.statusCode = result.status;
          for (const [k, v] of result.headers) {
            res.setHeader(k, v);
          }
          Readable.fromWeb(result.body).pipe(res);
          return;
        }

        for (const listener of listeners) {
          listener(req, res);
        }
      });
    });
    return httpServer;
  };
}

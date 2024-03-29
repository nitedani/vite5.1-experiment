import { ESModulesRunner, ViteRuntime } from "vite/runtime";
import { createBirpc } from "birpc";
import { parentPort } from "worker_threads";
import http from "http";
import { Readable } from "stream";

const rpc = createBirpc(
  { start },
  {
    post: (data) => parentPort.postMessage(data),
    on: (data) => parentPort.on("message", data),
    serialize: (v) => JSON.stringify(v),
    deserialize: (v) => JSON.parse(v),
  }
);

async function start(root, entry, httpPort) {
  console.log(`Loading server entry ${entry}`);
  patchHttp(httpPort);
  const runtime = new ViteRuntime(
    {
      fetchModule: (id, importer) => rpc.fetchModule(id, importer),
      root,
      hmr: false,
    },
    new ESModulesRunner()
  );

  await runtime.executeUrl(entry);
}

function patchHttp(httpPort) {
  global.proxyReq = async (req) => {
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
        const result = await proxyReq(req);
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

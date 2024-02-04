import react from "@vitejs/plugin-react";
import { createBirpc } from "birpc";
import http from "http";
import { createServer } from "vite";
import { SHARE_ENV, Worker } from "worker_threads";

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
      },
      {
        post: (data) => worker.postMessage(data),
        on: (data) => worker.on("message", data),
        serialize: (v) => JSON.stringify(v),
        deserialize: (v) => JSON.parse(v),
      }
    );

    await rpc.start(vite.config.root, entryPath, httpPort);
  }

  restartWorker();
}

import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { createBirpc } from "birpc";
import { SHARE_ENV, Worker } from "worker_threads";
import http from "http";

const entryPath = "./server/index.js";
const workerPath = "./worker.js";
const httpPort = 3333;

start();

async function start() {
  const vite = await createServer({
    appType: "custom",
    server: { middlewareMode: true },
    plugins: [react()],
  });
  const httpServer = http.createServer(vite.middlewares);
  httpServer.listen(httpPort);

  let worker;

  async function restartWorker() {
    if (worker) {
      await worker.terminate();
    }

    worker = new Worker(workerPath, { env: SHARE_ENV });

    const rpc = createBirpc(
      {
        fetchModule: vite.ssrFetchModule,
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

  const hmrChannel = vite.hot.channels.find((c) => c.name === "ws");
  const originalSend = hmrChannel.send.bind(hmrChannel);
  hmrChannel.send = async (payload) => {
    if (payload.type === "full-reload") {
      await restartWorker();
    }

    originalSend(payload);
  };

  restartWorker();
}

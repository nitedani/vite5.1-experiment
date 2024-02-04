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
  const httpServer = http.createServer(async (req, res) => {
    if (req.headers["x-vike-renderpage"]) {
      const html = await renderPage(req.url);
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html");
      res.write(html);
      res.end();
      return;
    }

    vite.middlewares(req, res);
  });
  httpServer.listen(httpPort);

  async function renderPage(url) {
    let template = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <script type="module">
      import RefreshRuntime from "/@react-refresh"
      RefreshRuntime.injectIntoGlobalHook(window)
      window.$RefreshReg$ = () => {}
      window.$RefreshSig$ = () => (type) => type
      window.__vite_plugin_react_preamble_installed__ = true
      </script>
      <script type="module" src="/@vite/client"></script>
      <meta charset="UTF-8" />
      <link rel="icon" type="image/svg+xml" href="/vite.svg" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Vite + React</title>
      <!--app-head-->
    </head>
    <body>
      <div id="root"><!--app-html--></div>
      <script type="module" src="/src/onRenderClient.jsx"></script>
    </body>
  </html>`;
    const render = (await vite.ssrLoadModule("./src/onRenderHtml.jsx")).render;

    const rendered = render();

    const html = template
      .replace(`<!--app-head-->`, rendered.head ?? "")
      .replace(`<!--app-html-->`, rendered.html ?? "");

    return html;
  }

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

export { renderPage };
export { initializeRenderPage };

function initializeRenderPage(vite) {
  global.vite = vite;
}

async function renderPage(url) {
  let template = `
  <!DOCTYPE html>
<html lang="en">
  <head>
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
  template = await vite.transformIndexHtml(url, template);
  const render = (await vite.ssrLoadModule("/src/onRenderHtml.jsx")).render;

  const rendered = await render();

  const html = template
    .replace(`<!--app-head-->`, rendered.head ?? "")
    .replace(`<!--app-html-->`, rendered.html ?? "");

  return html;
}

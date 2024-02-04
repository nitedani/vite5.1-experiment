export { renderPage };

import { Readable } from "stream";
async function renderPage(req) {
  req.headers["x-vike-renderpage"] = "true";
  const result = await global.proxyReq(req);

  const httpResponse = {
    pipe: (writable) => {
      const body = Readable.fromWeb(result.body);
      body.pipe(writable);
    },
    body: result.text.bind(result),
    headers: Array.from(result.headers),
    statusCode: result.status,
    contentType: result.headers["content-type"],
  };

  return httpResponse;
}

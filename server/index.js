import express from "express";
import { renderPage } from "vike/server";
import { two } from "./two";

const app = express();

two()

app.get("/api", (req, res) => {
  res.send("Hello from express api!");
});

app.get("*", async (req, res) => {
  const pageContextInit = {
    urlOriginal: req.originalUrl,
    req,
    res,
    userAgent: req.headers["user-agent"],
  };
  const { httpResponse } = await renderPage(pageContextInit);
  const { statusCode, headers } = httpResponse;
  headers.forEach(([name, value]) => res.setHeader(name, value));
  res.status(statusCode);
  httpResponse.pipe(res);
});

app.listen(3000, () => {
  console.log("listening on http://localhost:3000");
});

// Globals are reset on file changes
console.log("someGlobal before", global.someGlobal);
global.someGlobal = 22;
console.log("someGlobal after", global.someGlobal);

import express from "express";
import { renderPage } from "../ssr.js";

const app = express();

app.get("/api", (req, res) => {
  res.send("Hello from express api!");
});

app.get("*", async (req, res, next) => {
  const html = await renderPage(req.url);
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html");
  res.write(html);
  res.end();
});

app.listen(3000, () => {
  console.log("listening on http://localhost:3000");
});

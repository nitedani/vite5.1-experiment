import express from "express";
import { renderPage } from "./renderPage";

const app = express();

app.get("/api", (req, res) => {
  res.send("Hello from express api!");
});

app.get("*", async (req, res) => {
  const httpResponse = await renderPage(req);
  const { statusCode, headers } = httpResponse;
  headers.forEach(([name, value]) => res.setHeader(name, value));
  res.status(statusCode);
  httpResponse.pipe(res);
});

app.listen(3000, () => {
  console.log("listening on http://localhost:3000");
});

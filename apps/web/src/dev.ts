import index from "../index.html";

const server = Bun.serve({
  hostname: "0.0.0.0",
  port: 5173,
  development: true,
  routes: {
    "/api/*": async (req) => {
      const url = new URL(req.url);
      const backendUrl = new URL(
        url.pathname + url.search,
        "http://localhost:3000"
      );
      return fetch(new Request(backendUrl, req));
    },
    "/*": index,
  },
});

console.log(`Dev server running at http://localhost:${server.port}`);
const http = require("http");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const PORT = 4000;

function readData(file) {
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function writeData(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function sendJSON(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer((req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  // AUTH: POST /auth { username }
  if (req.url === "/auth" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { username } = JSON.parse(body || "{}");
        if (!username) return sendJSON(res, 400, { error: "username required" });

        const users = readData("users.json");
        let user = users.find((u) => u.username === username);
        if (!user) {
          user = { id: uuidv4(), username };
          users.push(user);
          writeData("users.json", users);
        }
        return sendJSON(res, 200, user);
      } catch {
        return sendJSON(res, 400, { error: "invalid json" });
      }
    });
    return;
  }

  // GET /boards?userId=...
  if (req.url.startsWith("/boards") && req.method === "GET") {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const userId = url.searchParams.get("userId");
    if (!userId) return sendJSON(res, 400, { error: "userId required" });

    const boards = readData("boards.json").filter((b) => b.userId === userId);
    return sendJSON(res, 200, boards);
  }

  // POST /boards { userId, title }
  if (req.url === "/boards" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { userId, title } = JSON.parse(body || "{}");
        if (!userId || !title) {
          return sendJSON(res, 400, { error: "userId and title required" });
        }
        const boards = readData("boards.json");
        const newBoard = {
          id: uuidv4(),
          userId,
          title,
          columns: { Start: [], Stop: [], Continue: [] },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        boards.push(newBoard);
        writeData("boards.json", boards);
        return sendJSON(res, 200, newBoard);
      } catch {
        return sendJSON(res, 400, { error: "invalid json" });
      }
    });
    return;
  }

  // PUT /boards/:id -> update board
  if (req.url.startsWith("/boards/") && req.method === "PUT") {
    const boardId = req.url.split("/")[2];
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const update = JSON.parse(body || "{}");
        let boards = readData("boards.json");
        let idx = boards.findIndex((b) => b.id === boardId);
        if (idx === -1) return sendJSON(res, 404, { error: "board not found" });

        boards[idx] = { ...boards[idx], ...update, updatedAt: Date.now() };
        writeData("boards.json", boards);
        return sendJSON(res, 200, boards[idx]);
      } catch {
        return sendJSON(res, 400, { error: "invalid json" });
      }
    });
    return;
  }

  return sendJSON(res, 404, { error: "Not Found" });
});

server.listen(PORT, () => {
  console.log(`Node server running at http://localhost:${PORT}`);
});

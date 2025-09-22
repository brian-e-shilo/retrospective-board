// backend/server.js
const http = require("http");
const { v4: uuidv4 } = require("uuid");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const PORT = 4000;
const DB_FILE = path.join(__dirname, "data.sqlite3");

// --- open DB and create tables if not exist ---
const db = new sqlite3.Database(DB_FILE);
db.serialize(() => {
  db.run(`PRAGMA foreign_keys = ON;`);

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );`);

  db.run(`CREATE TABLE IF NOT EXISTS boards (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    title TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
  );`);

  db.run(`CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    boardId TEXT NOT NULL,
    columnName TEXT NOT NULL,
    text TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    FOREIGN KEY(boardId) REFERENCES boards(id) ON DELETE CASCADE
  );`);
});

// --- helper to format dates ---
function formatDate() {
  const d = new Date();
  const pad = (n) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// --- helpers to use Promises with sqlite3 ---
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

// --- helpers ---
function sendJSON(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(payload));
}

function parseJSONBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) req.connection.destroy();
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("invalid json"));
      }
    });
  });
}

// --- server ---
const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // ---------- REGISTER ----------
    if (pathname === "/register" && req.method === "POST") {
      const { email, password } = await parseJSONBody(req);
      if (!email || !password)
        return sendJSON(res, 400, { error: "email/password required" });

      const existing = await get(`SELECT * FROM users WHERE email = ?`, [email]);
      if (existing)
        return sendJSON(res, 409, { error: "Email already registered" });

      const id = uuidv4();
      const createdAt = formatDate();
      await run(
        `INSERT INTO users (id, email, password, createdAt) VALUES (?, ?, ?, ?)`,
        [id, email, password, createdAt]
      );

      return sendJSON(res, 200, { id, email, createdAt });
    }

    // ---------- LOGIN ----------
    if (pathname === "/login" && req.method === "POST") {
      const { email, password } = await parseJSONBody(req);
      if (!email || !password)
        return sendJSON(res, 400, { error: "email/password required" });

      const user = await get(
        `SELECT * FROM users WHERE email = ? AND password = ?`,
        [email, password]
      );
      if (!user)
        return sendJSON(res, 401, { error: "Invalid email or password" });

      return sendJSON(res, 200, {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt,
      });
    }

    // ---------- GET BOARDS ----------
    if (pathname === "/boards" && req.method === "GET") {
      const userId = url.searchParams.get("userId");
      if (!userId) return sendJSON(res, 400, { error: "userId required" });

      const boards = await all(
        `SELECT * FROM boards WHERE userId = ? ORDER BY createdAt DESC`,
        [userId]
      );
      const results = [];
      for (const b of boards) {
        const notes = await all(
          `SELECT * FROM notes WHERE boardId = ? ORDER BY createdAt ASC`,
          [b.id]
        );
        const columns = { Start: [], Stop: [], Continue: [] };
        for (const n of notes)
          columns[n.columnName].push({
            id: n.id,
            text: n.text,
            createdAt: n.createdAt,
          });
        results.push({ ...b, columns });
      }
      return sendJSON(res, 200, results);
    }

    // ---------- CREATE BOARD ----------
    if (pathname === "/boards" && req.method === "POST") {
      const { userId, title } = await parseJSONBody(req);
      if (!userId || !title)
        return sendJSON(res, 400, { error: "userId and title required" });

      const id = uuidv4();
      const createdAt = formatDate();
      await run(
        `INSERT INTO boards (id, userId, title, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`,
        [id, userId, title, createdAt, createdAt]
      );

      return sendJSON(res, 200, {
        id,
        userId,
        title,
        createdAt,
        updatedAt: createdAt,
        columns: { Start: [], Stop: [], Continue: [] },
      });
    }

    // ---------- UPDATE BOARD ----------
    if (pathname.startsWith("/boards/") && req.method === "PUT") {
      const boardId = pathname.split("/")[2];
      const { title } = await parseJSONBody(req);
      const updatedAt = formatDate();
      await run(`UPDATE boards SET title = ?, updatedAt = ? WHERE id = ?`, [
        title,
        updatedAt,
        boardId,
      ]);

      const b = await get(`SELECT * FROM boards WHERE id = ?`, [boardId]);
      return sendJSON(res, 200, b);
    }

    // ---------- DELETE BOARD ----------
    if (pathname.match(/^\/boards\/[^/]+$/) && req.method === "DELETE") {
      const boardId = pathname.split("/")[2];
      await run(`DELETE FROM notes WHERE boardId = ?`, [boardId]);
      await run(`DELETE FROM boards WHERE id = ?`, [boardId]);
      return sendJSON(res, 200, { ok: true });
    }

    // ---------- CREATE NOTE ----------
    if (pathname.match(/^\/boards\/[^/]+\/notes$/) && req.method === "POST") {
      const boardId = pathname.split("/")[2];
      const { columnName, text } = await parseJSONBody(req);

      if (!boardId || !columnName || !text)
        return sendJSON(res, 400, {
          error: "boardId, columnName and text required",
        });

      const id = uuidv4();
      const createdAt = formatDate();
      await run(
        `INSERT INTO notes (id, boardId, columnName, text, createdAt) VALUES (?, ?, ?, ?, ?)`,
        [id, boardId, columnName, text, createdAt]
      );
      await run(`UPDATE boards SET updatedAt = ? WHERE id = ?`, [
        formatDate(),
        boardId,
      ]);

      return sendJSON(res, 200, { id, boardId, columnName, text, createdAt });
    }

    // ---------- UPDATE NOTE ----------
    if (pathname.match(/^\/boards\/[^/]+\/notes\/[^/]+$/) && req.method === "PUT") {
      const parts = pathname.split("/").filter(Boolean);
      const boardId = parts[1];
      const noteId = parts[3];
      const { columnName, text } = await parseJSONBody(req);

      if (columnName && text !== undefined)
        await run(`UPDATE notes SET columnName = ?, text = ? WHERE id = ?`, [
          columnName,
          text,
          noteId,
        ]);
      else if (columnName)
        await run(`UPDATE notes SET columnName = ? WHERE id = ?`, [
          columnName,
          noteId,
        ]);
      else
        await run(`UPDATE notes SET text = ? WHERE id = ?`, [text, noteId]);

      await run(`UPDATE boards SET updatedAt = ? WHERE id = ?`, [
        formatDate(),
        boardId,
      ]);
      const updated = await get(`SELECT * FROM notes WHERE id = ?`, [noteId]);
      return sendJSON(res, 200, updated);
    }

    // ---------- DELETE NOTE ----------
    if (pathname.match(/^\/boards\/[^/]+\/notes\/[^/]+$/) && req.method === "DELETE") {
      const parts = pathname.split("/").filter(Boolean);
      const boardId = parts[1];
      const noteId = parts[3];

      await run(`DELETE FROM notes WHERE id = ?`, [noteId]);
      await run(`UPDATE boards SET updatedAt = ? WHERE id = ?`, [
        formatDate(),
        boardId,
      ]);

      return sendJSON(res, 200, { ok: true });
    }

    // fallback
    return sendJSON(res, 404, { error: "Not Found" });
  } catch (err) {
    console.error(err);
    return sendJSON(res, 500, { error: "Server Error" });
  }
});

server.listen(PORT, () =>
  console.log(`Server running at http://localhost:${PORT}`)
);
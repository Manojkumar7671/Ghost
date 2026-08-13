const express = require("express");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3098;
const JWT_SECRET = "ghost_test_secret_key_12345";
const dbFile = path.join(__dirname, "db_data.json");

function loadDb() {
  if (!fs.existsSync(dbFile)) {
    return { users: [], notes: [] };
  }
  return JSON.parse(fs.readFileSync(dbFile, "utf8"));
}

function saveDb(data) {
  fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// JWT Auth Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Access token required" });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(401).json({ error: "Invalid or expired token" });
    req.user = user;
    next();
  });
}

// Auth Endpoints
app.post("/register", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });

  const db = loadDb();
  if (db.users.some(u => u.username === username)) {
    return res.status(400).json({ error: "Username already exists" });
  }

  const hashedPassword = bcrypt.hashSync(password, 10);
  const newUser = { id: db.users.length + 1, username, password: hashedPassword };
  db.users.push(newUser);
  saveDb(db);

  res.status(201).json({ success: true, userId: newUser.id });
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });

  const db = loadDb();
  const user = db.users.find(u => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: "1h" });
  res.json({ success: true, token, username: user.username });
});

// Protected Notes Endpoints
app.get("/notes", authenticateToken, (req, res) => {
  const db = loadDb();
  const userNotes = db.notes.filter(n => n.user_id === req.user.id);
  res.json(userNotes);
});

app.post("/notes", authenticateToken, (req, res) => {
  const { title, content } = req.body;
  if (!title || !content) return res.status(400).json({ error: "Title and content required" });

  const db = loadDb();
  const newNote = { id: db.notes.length + 1, user_id: req.user.id, title, content };
  db.notes.push(newNote);
  saveDb(db);

  res.status(201).json(newNote);
});

app.delete("/notes/:id", authenticateToken, (req, res) => {
  const noteId = parseInt(req.params.id, 10);
  const db = loadDb();
  db.notes = db.notes.filter(n => !(n.id === noteId && n.user_id === req.user.id));
  saveDb(db);
  res.json({ success: true, deletedId: noteId });
});

app.listen(PORT, () => {
  console.log("[Notes Auth App Backend] Server running on http://localhost:" + PORT);
});

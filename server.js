require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(express.json());

/* ==============================
   DATABASE CONNECTION
============================== */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool.connect()
  .then(() => console.log("PostgreSQL Connected ✅"))
  .catch((err) => console.error("DB Connection Error:", err));

/* ==============================
   CREATE TABLES
============================== */

const createTables = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(100) UNIQUE NOT NULL,
      password TEXT NOT NULL,
      country VARCHAR(100),
      state VARCHAR(100),
      city VARCHAR(100),
      college VARCHAR(200),
      bio TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS connections (
      id SERIAL PRIMARY KEY,
      sender_id INT REFERENCES users(id) ON DELETE CASCADE,
      receiver_id INT REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR(20) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      sender_id INT REFERENCES users(id) ON DELETE CASCADE,
      receiver_id INT REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS blocks (
      id SERIAL PRIMARY KEY,
      blocker_id INT REFERENCES users(id) ON DELETE CASCADE,
      blocked_id INT REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(blocker_id, blocked_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id SERIAL PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      description TEXT,
      created_by INT REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS room_members (
      id SERIAL PRIMARY KEY,
      room_id INT REFERENCES rooms(id) ON DELETE CASCADE,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(room_id, user_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS room_messages (
      id SERIAL PRIMARY KEY,
      room_id INT REFERENCES rooms(id) ON DELETE CASCADE,
      sender_id INT REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log("All tables ready ✅");
};

createTables();

/* ==============================
   AUTH MIDDLEWARE
============================== */

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader)
    return res.status(401).json({ message: "Access denied" });

  const token = authHeader.split(" ")[1];

  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    res.status(400).json({ message: "Invalid token" });
  }
};

/* ==============================
   REGISTER
============================== */

app.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const existing = await pool.query(
      "SELECT * FROM users WHERE email=$1",
      [email]
    );

    if (existing.rows.length > 0)
      return res.status(400).json({ message: "User already exists" });

    const hashed = await bcrypt.hash(password, 10);

    await pool.query(
      "INSERT INTO users (name,email,password) VALUES ($1,$2,$3)",
      [name, email, hashed]
    );

    res.status(201).json({ message: "User registered ✅" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ==============================
   LOGIN
============================== */

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await pool.query(
      "SELECT * FROM users WHERE email=$1",
      [email]
    );

    if (user.rows.length === 0)
      return res.status(400).json({ message: "Invalid credentials" });

    const valid = await bcrypt.compare(password, user.rows[0].password);

    if (!valid)
      return res.status(400).json({ message: "Invalid credentials" });

    const token = jwt.sign(
      { id: user.rows[0].id },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ==============================
   BLOCK USER
============================== */

app.post("/block/:userId", authenticateToken, async (req, res) => {
  try {
    const blockerId = req.user.id;
    const blockedId = parseInt(req.params.userId);

    if (blockerId === blockedId)
      return res.status(400).json({ message: "Cannot block yourself" });

    await pool.query(
      `INSERT INTO blocks (blocker_id, blocked_id)
       VALUES ($1,$2)
       ON CONFLICT DO NOTHING`,
      [blockerId, blockedId]
    );

    res.json({ message: "User blocked ✅" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ==============================
   PRIVATE MESSAGE
============================== */

app.post("/message/:userId", authenticateToken, async (req, res) => {
  try {
    const senderId = req.user.id;
    const receiverId = parseInt(req.params.userId);
    const { content } = req.body;

    const blockCheck = await pool.query(
      `SELECT * FROM blocks
       WHERE (blocker_id=$1 AND blocked_id=$2)
          OR (blocker_id=$2 AND blocked_id=$1)`,
      [senderId, receiverId]
    );

    if (blockCheck.rows.length > 0)
      return res.status(403).json({ message: "You cannot message this user" });

    await pool.query(
      `INSERT INTO messages (sender_id, receiver_id, content)
       VALUES ($1,$2,$3)`,
      [senderId, receiverId, content]
    );

    res.json({ message: "Message sent ✅" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ==============================
   CHAT
============================== */

app.get("/chat/:userId", authenticateToken, async (req, res) => {
  try {
    const messages = await pool.query(
      `SELECT * FROM messages
       WHERE (sender_id=$1 AND receiver_id=$2)
          OR (sender_id=$2 AND receiver_id=$1)
       ORDER BY created_at ASC`,
      [req.user.id, req.params.userId]
    );

    res.json(messages.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ==============================
   ROOM SYSTEM
============================== */

app.post("/rooms", authenticateToken, async (req, res) => {
  try {
    const { name, description } = req.body;

    const result = await pool.query(
      `INSERT INTO rooms (name, description, created_by)
       VALUES ($1,$2,$3)
       RETURNING *`,
      [name, description, req.user.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/rooms/:roomId/join", authenticateToken, async (req, res) => {
  try {
    const roomId = parseInt(req.params.roomId);

    await pool.query(
      `INSERT INTO room_members (room_id, user_id)
       VALUES ($1,$2)
       ON CONFLICT DO NOTHING`,
      [roomId, req.user.id]
    );

    res.json({ message: "Joined room ✅" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/rooms/:roomId/message", authenticateToken, async (req, res) => {
  try {
    const roomId = parseInt(req.params.roomId);
    const { content } = req.body;
    const userId = req.user.id;

    const memberCheck = await pool.query(
      `SELECT * FROM room_members
       WHERE room_id=$1 AND user_id=$2`,
      [roomId, userId]
    );

    if (memberCheck.rows.length === 0)
      return res.status(403).json({
        message: "You must join this room to send messages"
      });

    await pool.query(
      `INSERT INTO room_messages (room_id, sender_id, content)
       VALUES ($1,$2,$3)`,
      [roomId, userId, content]
    );

    res.json({ message: "Message sent in room ✅" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/rooms/:roomId/messages", authenticateToken, async (req, res) => {
  try {
    const roomId = parseInt(req.params.roomId);

    const result = await pool.query(
      `SELECT * FROM room_messages
       WHERE room_id=$1
       ORDER BY created_at ASC`,
      [roomId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ==============================
   SERVER START
============================== */

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} 🚀`);
});
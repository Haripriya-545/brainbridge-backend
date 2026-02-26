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

  console.log("Tables ready ✅");
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
  } catch {
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

  } catch {
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

    const valid = await bcrypt.compare(
      password,
      user.rows[0].password
    );

    if (!valid)
      return res.status(400).json({ message: "Invalid credentials" });

    const token = jwt.sign(
      { id: user.rows[0].id },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.json({ token });

  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

/* ==============================
   UPDATE PROFILE
============================== */

app.put("/profile", authenticateToken, async (req, res) => {
  try {
    const { country, state, city, college, bio } = req.body;

    await pool.query(
      `UPDATE users 
       SET country=$1, state=$2, city=$3, college=$4, bio=$5
       WHERE id=$6`,
      [country, state, city, college, bio, req.user.id]
    );

    res.json({ message: "Profile updated ✅" });

  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

/* ==============================
   GET USERS (Search by City)
============================== */

app.get("/users", async (req, res) => {
  try {
    const { city } = req.query;

    if (city) {
      const result = await pool.query(
        "SELECT id,name,email,country,state,city FROM users WHERE city ILIKE $1",
        [city]
      );
      return res.json(result.rows);
    }

    const result = await pool.query(
      "SELECT id,name,email,country,state,city FROM users"
    );

    res.json(result.rows);

  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

/* ==============================
   SEND CONNECTION REQUEST
============================== */

app.post("/connect/:userId", authenticateToken, async (req, res) => {
  try {
    const senderId = req.user.id;
    const receiverId = parseInt(req.params.userId);

    if (senderId === receiverId)
      return res.status(400).json({ message: "Cannot connect yourself" });

    const existing = await pool.query(
      `SELECT * FROM connections 
       WHERE sender_id=$1 AND receiver_id=$2`,
      [senderId, receiverId]
    );

    if (existing.rows.length > 0)
      return res.status(400).json({ message: "Request already sent" });

    await pool.query(
      `INSERT INTO connections (sender_id, receiver_id)
       VALUES ($1,$2)`,
      [senderId, receiverId]
    );

    res.json({ message: "Connection request sent ✅" });

  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

/* ==============================
   VIEW CONNECTIONS (FILTERABLE)
============================== */

app.get("/connections", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { status } = req.query;

    let query = `
      SELECT * FROM connections
      WHERE (sender_id=$1 OR receiver_id=$1)
    `;

    let values = [userId];

    if (status) {
      query += " AND status=$2";
      values.push(status);
    }

    const result = await pool.query(query, values);

    res.json(result.rows);

  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

/* ==============================
   ACCEPT CONNECTION
============================== */

app.put("/connect/accept/:id", authenticateToken, async (req, res) => {
  try {
    const connectionId = parseInt(req.params.id);
    const userId = req.user.id;

    const check = await pool.query(
      "SELECT * FROM connections WHERE id=$1 AND receiver_id=$2",
      [connectionId, userId]
    );

    if (check.rows.length === 0)
      return res.status(403).json({ message: "Not authorized" });

    await pool.query(
      "UPDATE connections SET status='accepted' WHERE id=$1",
      [connectionId]
    );

    res.json({ message: "Connection accepted ✅" });

  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

/* ==============================
   REJECT CONNECTION
============================== */

app.delete("/connect/reject/:id", authenticateToken, async (req, res) => {
  try {
    const connectionId = parseInt(req.params.id);
    const userId = req.user.id;

    const check = await pool.query(
      "SELECT * FROM connections WHERE id=$1 AND receiver_id=$2",
      [connectionId, userId]
    );

    if (check.rows.length === 0)
      return res.status(403).json({ message: "Not authorized" });

    await pool.query(
      "DELETE FROM connections WHERE id=$1",
      [connectionId]
    );

    res.json({ message: "Connection rejected ❌" });

  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

/* ==============================
   FRIEND LIST (ACCEPTED ONLY)
============================== */

app.get("/friends", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `
      SELECT u.id, u.name, u.email, u.city
      FROM connections c
      JOIN users u
        ON (
          (c.sender_id = $1 AND c.receiver_id = u.id)
          OR
          (c.receiver_id = $1 AND c.sender_id = u.id)
        )
      WHERE c.status = 'accepted'
      `,
      [userId]
    );

    res.json(result.rows);

  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

/* ==============================
   SERVER START
============================== */

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
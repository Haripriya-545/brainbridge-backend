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
   CREATE / UPDATE USERS TABLE
============================== */

const setupUsersTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password TEXT NOT NULL,
        country VARCHAR(100),
        state VARCHAR(100),
        city VARCHAR(100),
        college VARCHAR(150),
        bio TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS country VARCHAR(100),
      ADD COLUMN IF NOT EXISTS state VARCHAR(100),
      ADD COLUMN IF NOT EXISTS city VARCHAR(100),
      ADD COLUMN IF NOT EXISTS college VARCHAR(150),
      ADD COLUMN IF NOT EXISTS bio TEXT;
    `);

    console.log("Users table ready & updated ✅");
  } catch (err) {
    console.error("Table setup error:", err);
  }
};

setupUsersTable();

/* ==============================
   AUTH MIDDLEWARE
============================== */

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ message: "Access denied" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    return res.status(400).json({ message: "Invalid token" });
  }
};

/* ==============================
   REGISTER
============================== */

app.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const existingUser = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      "INSERT INTO users (name, email, password) VALUES ($1, $2, $3)",
      [name, email, hashedPassword]
    );

    res.status(201).json({ message: "User registered successfully ✅" });

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

    if (!email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const user = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    if (user.rows.length === 0) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const validPassword = await bcrypt.compare(
      password,
      user.rows[0].password
    );

    if (!validPassword) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign(
      { id: user.rows[0].id },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.status(200).json({
      message: "Login successful ✅",
      token,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ==============================
   UPDATE PROFILE
============================== */

app.put("/profile", authMiddleware, async (req, res) => {
  try {
    const { country, state, city, college, bio } = req.body;

    await pool.query(
      `UPDATE users
       SET country = $1,
           state = $2,
           city = $3,
           college = $4,
           bio = $5
       WHERE id = $6`,
      [country, state, city, college, bio, req.user.id]
    );

    res.json({ message: "Profile updated successfully ✅" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ==============================
   GET PROFILE
============================== */

app.get("/profile", authMiddleware, async (req, res) => {
  try {
    const user = await pool.query(
      `SELECT id, name, email, country, state, city, college, bio
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    res.json(user.rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ==============================
   SEARCH USERS (NEW FEATURE)
============================== */

app.get("/users", async (req, res) => {
  try {
    const { country, state, city, college } = req.query;

    let query = `
      SELECT id, name, email, country, state, city, college, bio
      FROM users
      WHERE 1=1
    `;

    const values = [];
    let index = 1;

    if (country) {
      query += ` AND country = $${index++}`;
      values.push(country);
    }

    if (state) {
      query += ` AND state = $${index++}`;
      values.push(state);
    }

    if (city) {
      query += ` AND city = $${index++}`;
      values.push(city);
    }

    if (college) {
      query += ` AND college = $${index++}`;
      values.push(college);
    }

    const result = await pool.query(query, values);

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ==============================
   PROTECTED TEST ROUTE
============================== */

app.get("/protected", authMiddleware, (req, res) => {
  res.json({
    message: "Protected route accessed ✅",
    user: req.user,
  });
});

/* ==============================
   SERVER START
============================== */

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
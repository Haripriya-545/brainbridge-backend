// 🔹 Fix DNS SRV resolution issue (important for MongoDB Atlas)
const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

// 🔹 Load environment variables
require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());

// 🔹 Debug: Check if MONGO_URI is loading
console.log("ENV CHECK:", process.env.MONGO_URI);

// 🔹 Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected ✅"))
  .catch((err) => console.log("MongoDB Error:", err));

// 🔹 Basic route
app.get("/", (req, res) => {
  res.send("BrainBridge Server Running 🚀");
});

// 🔹 Socket.io basic setup
io.on("connection", (socket) => {
  console.log("User connected");

  socket.on("sendMessage", (message) => {
    io.emit("receiveMessage", message);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected");
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
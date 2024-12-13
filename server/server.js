const mongoose = require("mongoose");
const cors = require("cors");
const express = require("express");
const cookiePaser = require('cookie-parser');
const http = require('http');
const { Server } = require("socket.io");
const userRoutes = require("./routes/userRoutes");
const messageRoutes = require('./routes/messageRoutes');


const app = express();
require("dotenv").config();

const PORT = process.env.PORT || 5000;

// create http server
const server = http.createServer(app);

// Apply CORS middleware for websocket connections
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    credentials: true,
    methods: ["GET", "POST"],
  },
});


// Apply CORS middleware for the regular http requests
app.use (
  cors({
    origin: "http://localhost:3000", // allows request from the origin
    credentials: true, // allow cookies to be sent
  })
);

// Middelware
app.use(cookiePaser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// routes
app.use("/api/users", userRoutes);
app.use("/api/messages", messageRoutes)

// using Map to store online users
const onlineUsers = new Map();

// setup socket.io
io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on('user-online', (userId) => {
    onlineUsers.set(userId, socket.id);
    io.emit('online-users', Array.from(onlineUsers.keys()));  // notify the clients about online users
  })

  // Join a room for real-time chat
  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    console.log(`User joined room: ${roomId}`);
  });

  // send a message
  socket.on("send-message", (data) => {
    io.to(data.roomId).emit("receive-message", data);
  });

  socket.on('disconnect', () => {
    console.log("A user disconnected:", socket.id);
    const userId = [...onlineUsers.entries()].find(
      ([, socketId]) => socketId === socket.id)?.[0];
    if(userId){
      onlineUsers.delete(userId);
    }
    io.emit('online-users', Array.from(onlineUsers.keys()));
  });
});

// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log(`MongoDB connected`);
    server.listen(PORT, () => {
      console.log(`server is running on port ${PORT}`);
    });
  })
  .catch((err) => console.log("Error connecting to MongoDB:", err));

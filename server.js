const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const animeDB = require('./anime_data.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// 提供静态文件
app.use(express.static(path.join(__dirname, 'client/build')));

// 捕获所有路由并返回前端的 index.html
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
  });
  

// 添加错误处理
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

let players = [];
let currentPainter = 0;

io.on('connection', socket => {
  console.log(`New connection: ${socket.id}`);

  // 玩家加入
  socket.on('join', name => {
    if (!players.find(p => p.id === socket.id)) {
      players.push({ id: socket.id, name, socket });
      io.emit('playerList', players.map(p => p.name));
    }
  });

  // 游戏流程事件
  socket.on('startGame', () => startRound());
  socket.on('drawing', data => socket.broadcast.emit('drawing', data));
  socket.on('drawShape', shape => socket.broadcast.emit('drawShape', shape));
  socket.on('clearCanvas', () => io.emit('clearCanvas'));
  socket.on('guess', text => {
    const painterSocket = players[currentPainter]?.socket;
    if (painterSocket) painterSocket.emit('newGuess', text);
  });
  socket.on('endRound', () => nextRound());
  socket.on('skipPrompt', () => startRound());

  // 玩家断开连接
  socket.on('disconnect', () => {
    const wasPainter = players[currentPainter]?.id === socket.id;
    players = players.filter(p => p.id !== socket.id);
    if (wasPainter && players.length > 0) {
      currentPainter %= players.length;
      startRound();
    } else if (currentPainter >= players.length) {
      currentPainter = 0;
    }
    io.emit('playerList', players.map(p => p.name));
  });
});

function startRound() {
  if (players.length < 2) return;
  const idx = Math.floor(Math.random() * animeDB.length);
  const prompt = animeDB[idx];
  io.emit('roleUpdate', players[currentPainter].name);
  players[currentPainter].socket.emit('newPrompt', prompt);
  io.emit('clearCanvas');
}

function nextRound() {
  currentPainter = (currentPainter + 1) % players.length;
  startRound();
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

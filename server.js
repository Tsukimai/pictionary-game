const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const animeDB = require('./anime_data.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// 用于托管前端打包后的静态文件（后面会用到）
app.use(express.static(path.join(__dirname, 'public')));

let players = [];       // 存放所有玩家
let currentPainter = 0; // 画家在 players 数组中的索引

io.on('connection', socket => {
  // 新玩家加入，先让客户端发来“加入”消息
  socket.on('join', name => {
    players.push({ id: socket.id, name, socket });
    io.emit('playerList', players.map(p=>p.name));
  });

  // 开始游戏（所有人准备好后由客户端触发）
  socket.on('startGame', () => startRound());

  // 画笔轨迹广播给其他人
  socket.on('drawing', data => {
    socket.broadcast.emit('drawing', data);
  });

  // 猜词广播给画家
  socket.on('guess', text => {
    const painterSocket = players[currentPainter].socket;
    painterSocket.emit('newGuess', text);
  });

  // 结束回合，切换到下一个画家
  socket.on('endRound', () => nextRound());
  socket.on('skipPrompt', () => {
    // 新提示并清画布
    startRound();
  });
  // 玩家断开，需从列表移除
  socket.on('disconnect', () => {
    players = players.filter(p => p.id !== socket.id);
    io.emit('playerList', players.map(p=>p.name));
  });
});

function startRound() {
  if (players.length < 2) return; // 最少两人才能玩
  // 随机选一个动画作为提示
  const idx = Math.floor(Math.random() * animeDB.length);
  const prompt = animeDB[idx];
  // 通知所有人谁是画家
  io.emit('roleUpdate', players[currentPainter].name);
  // 只有画家看到提示
  players[currentPainter].socket.emit('newPrompt', prompt);
  // 通知清空画布
  io.emit('clearCanvas');
}

function nextRound() {
  currentPainter = (currentPainter + 1) % players.length;
  startRound();
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`后端启动，端口 ${PORT}`));



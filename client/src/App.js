import React, { useState, useEffect, useRef } from 'react';
// 注意这里用命名导入 io
import { io } from 'socket.io-client';
import './App.css';

// 如果你希望上线后自动连到当前域名，直接 io()
// 本地开发若需要连本地，可以在 .env.development 里设 REACT_APP_SERVER_URL
const SERVER_URL = process.env.REACT_APP_SERVER_URL || '';
const socket = io(SERVER_URL, {
  path: '/socket.io'
});

function App() {
  const [name, setName] = useState('');
  const [joined, setJoined] = useState(false);
  const [players, setPlayers] = useState([]);
  const [role, setRole] = useState('');
  const [prompt, setPrompt] = useState(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [guessInput, setGuessInput] = useState('');
  const [guesses, setGuesses] = useState([]);
  const [brushColor, setBrushColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(4);
  const canvasRef = useRef();

  useEffect(() => {
    socket.on('playerList', list => setPlayers(list));
    socket.on('roleUpdate', painter => setRole(painter));
    socket.on('newPrompt', p => setPrompt(p));
    socket.on('clearCanvas', () => {
      const canvas = canvasRef.current;
      canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
      setGuesses([]);
    });
    socket.on('drawing', ({ x, y, color, size }) => drawPoint(x, y, color, size));
    socket.on('newGuess', guess => setGuesses(prev => [...prev, guess]));

    return () => socket.off();
  }, []);

  function handleJoin() {
    if (!name.trim()) return alert('请输入昵称');
    socket.emit('join', name.trim());
    setJoined(true);
  }

  function handleStart() {
    socket.emit('startGame');
  }

  function handleSkip() {
    socket.emit('skipPrompt');
  }

  function handleMouseDown(e) {
    if (role !== name || e.button !== 0) return;
    setIsDrawing(true);
    handleMouseMove(e);
  }

  function handleMouseUp() {
    setIsDrawing(false);
  }

  function handleMouseLeave() {
    setIsDrawing(false);
  }

  function handleMouseMove(e) {
    if (!isDrawing || role !== name) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    drawPoint(x, y, brushColor, brushSize);
    socket.emit('drawing', { x, y, color: brushColor, size: brushSize });
  }

  function drawPoint(x, y, color, size) {
    const ctx = canvasRef.current.getContext('2d');
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, 2 * Math.PI);
    ctx.fill();
  }

  function submitGuess() {
    const text = guessInput.trim();
    if (!text) return;
    socket.emit('guess', { name, text });
    setGuessInput('');
  }

  // 样式略……

  return (
    <div style={{ maxWidth: 800, margin: '20px auto', padding: 20 }}>
      {!joined ? (
        <div style={{ textAlign: 'center' }}>
          <input
            placeholder="昵称"
            value={name}
            onChange={e => setName(e.target.value)}
          />
          <button onClick={handleJoin}>加入</button>
        </div>
      ) : (
        <>
          <div><strong>在线玩家：</strong>{players.join('，')}</div>
          <button onClick={handleStart}>开始游戏</button>
          <div><strong>当前画家：</strong><span style={{ color: '#d32f2f' }}>{role}</span></div>

          {role === name && prompt && (
            <div>请画：<b>{prompt.title}</b>（{prompt.tags.join('，')}）</div>
          )}

          {role === name && (
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <label>颜色：</label>
              <input
                type="color"
                value={brushColor}
                onChange={e => setBrushColor(e.target.value)}
              />
              <label style={{ marginLeft: 16 }}>粗细：</label>
              <input
                type="range"
                min={1}
                max={20}
                value={brushSize}
                onChange={e => setBrushSize(+e.target.value)}
              />
              <span style={{ marginLeft: 8 }}>{brushSize}px</span>
            </div>
          )}

          <canvas
            ref={canvasRef}
            width={700}
            height={400}
            style={{ border: '2px solid #666', background: '#fff' }}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            onMouseMove={handleMouseMove}
          />

          {role === name ? (
            <div>
              <h3>猜词列表</h3>
              <ul>
                {guesses.map((g, i) => (
                  <li key={i}><b>{g.name}：</b>{g.text}</li>
                ))}
              </ul>
              <button onClick={() => socket.emit('endRound')}>结束本轮</button>
              <button onClick={handleSkip}>跳过</button>
            </div>
          ) : (
            <div>
              <input
                placeholder="输入你的猜词"
                value={guessInput}
                onChange={e => setGuessInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submitGuess()}
              />
              <button onClick={submitGuess}>提交猜词</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default App;

import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const SERVER_URL = process.env.REACT_APP_SERVER_URL || '';
const socket = io(SERVER_URL, { path: '/socket.io' });

function App() {
  const [name, setName] = useState('');
  const [joined, setJoined] = useState(false);
  const [players, setPlayers] = useState([]);
  const [role, setRole] = useState('');
  const [prompt, setPrompt] = useState(null);
  const [guesses, setGuesses] = useState([]);

  // 画笔状态
  const [tool, setTool] = useState('brush'); // 'brush'|'eraser'|'line'|'rect'|'circle'
  const [brushColor, setBrushColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(4);
  const [startPos, setStartPos] = useState(null);
  const [isDrawing, setIsDrawing] = useState(false);

  const [guessInput, setGuessInput] = useState('');
  const canvasRef = useRef();

  useEffect(() => {
    socket.on('playerList', setPlayers);
    socket.on('roleUpdate', setRole);
    socket.on('newPrompt', setPrompt);
    socket.on('clearCanvas', () => {
      const c = canvasRef.current;
      c.getContext('2d').clearRect(0, 0, c.width, c.height);
      setGuesses([]);
    });
    socket.on('drawing', data => drawPoint(data));
    socket.on('drawShape', shape => drawShape(shape));
    socket.on('newGuess', g => setGuesses(prev => [...prev, g]));

    return () => socket.off();
  }, []);

  // 绘制单点（画笔 & 橡皮）
  function drawPoint({ x, y, color, size }) {
    const ctx = canvasRef.current.getContext('2d');
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, 2 * Math.PI);
    ctx.fill();
  }

  // 绘制线/矩形/圆
  function drawShape({ tool, start, end, color, size }) {
    const ctx = canvasRef.current.getContext('2d');
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    if (tool === 'line') {
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }
    else if (tool === 'rect') {
      ctx.strokeRect(start.x, start.y, dx, dy);
    }
    else if (tool === 'circle') {
      const r = Math.sqrt(dx * dx + dy * dy);
      ctx.beginPath();
      ctx.arc(start.x, start.y, r, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }

  function getMousePos(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handleMouseDown(e) {
    if (role !== name || e.button !== 0) return;
    const pos = getMousePos(e);

    if (tool === 'brush' || tool === 'eraser') {
      setIsDrawing(true);
      const color = tool === 'eraser' ? '#ffffff' : brushColor;
      drawPoint({ x: pos.x, y: pos.y, color, size: brushSize });
      socket.emit('drawing', { x: pos.x, y: pos.y, color, size: brushSize });
    } else {
      setStartPos(pos);
      setIsDrawing(true);
    }
  }

  function handleMouseMove(e) {
    if (!isDrawing || role !== name) return;
    if (tool === 'brush' || tool === 'eraser') {
      const pos = getMousePos(e);
      const color = tool === 'eraser' ? '#ffffff' : brushColor;
      drawPoint({ x: pos.x, y: pos.y, color, size: brushSize });
      socket.emit('drawing', { x: pos.x, y: pos.y, color, size: brushSize });
    }
  }

  function handleMouseUp(e) {
    if (role !== name) return;
    if (tool === 'brush' || tool === 'eraser') {
      setIsDrawing(false);
    } else {
      const end = getMousePos(e);
      const shape = { tool, start: startPos, end, color: brushColor, size: brushSize };
      drawShape(shape);
      socket.emit('drawShape', shape);
      setIsDrawing(false);
    }
  }

  function submitGuess() {
    const text = guessInput.trim();
    if (!text) return;
    socket.emit('guess', { name, text });
    setGuessInput('');
  }

  function handleJoin() {
    if (!name.trim()) return alert('请输入昵称');
    socket.emit('join', name.trim());
    setJoined(true);
  }

  function handleStart() { socket.emit('startGame'); }
  function handleSkip() { socket.emit('skipPrompt'); }
  function handleClear() { socket.emit('clearBoard'); }

  // 简单样式略……
  const btn = { margin: 4, padding: '6px 12px' };
  const active = { background: '#4CAF50', color: '#fff' };

  return (
    <div style={{ maxWidth: 800, margin: '20px auto', padding: 20 }}>
      {!joined ? (
        <div style={{ textAlign: 'center' }}>
          <input placeholder="昵称" value={name} onChange={e => setName(e.target.value)} />
          <button onClick={handleJoin} style={btn}>加入</button>
        </div>
      ) : (
        <>
          <div><strong>在线：</strong>{players.join('，')}</div>
          <button onClick={handleStart} style={btn}>开始游戏</button>
          <div><strong>画家：</strong><span style={{ color: 'red' }}>{role}</span></div>

          {/* 画布工具栏 */}
          {joined && (
            <div style={{ margin: '12px 0' }}>
              <label>工具：</label>
              {['brush','eraser','line','rect','circle'].map(t => (
                <button
                  key={t}
                  onClick={() => setTool(t)}
                  style={{ ...btn, ...(tool===t ? active : {}) }}
                >
                  {t}
                </button>
              ))}

              <label>颜色：</label>
              <input
                type="color" value={brushColor}
                onChange={e => setBrushColor(e.target.value)}
                disabled={tool === 'eraser'}
                style={{ margin: '0 12px' }}
              />

              <label>粗细：</label>
              <input
                type="range" min={1} max={20}
                value={brushSize}
                onChange={e => setBrushSize(+e.target.value)}
              />

              <button onClick={handleClear} style={{ ...btn, marginLeft: 32 }}>清空画布</button>
            </div>
          )}

          {/* 提示 & 画布 */}
          {role === name && prompt && (
            <div style={{ marginBottom: 12 }}>
              请画：<b>{prompt.title}</b>（{prompt.tags.join('，')}）
            </div>
          )}
          <canvas
            ref={canvasRef}
            width={700} height={400}
            style={{ border: '2px solid #666', background: '#fff' }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          />

          {/* 结束/跳过 or 猜词 */}
          {role === name ? (
            <div style={{ marginTop: 16 }}>
              <h3>猜词</h3>
              <ul>
                {guesses.map((g,i) => <li key={i}><b>{g.name}：</b>{g.text}</li>)}
              </ul>
              <button onClick={() => socket.emit('endRound')} style={btn}>结束回合</button>
              <button onClick={handleSkip} style={btn}>跳过</button>
            </div>
          ) : (
            <div style={{ marginTop: 16 }}>
              <input
                placeholder="输入猜词"
                value={guessInput}
                onChange={e => setGuessInput(e.target.value)}
                onKeyDown={e => e.key==='Enter' && submitGuess()}
              />
              <button onClick={submitGuess} style={btn}>提交</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default App;


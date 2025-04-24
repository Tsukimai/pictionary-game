import React, { useState, useEffect, useRef, useCallback } from 'react';
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

  // 工具状态
  const [tool, setTool] = useState('brush');
  const [brushColor, setBrushColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(4);
  const [shapes, setShapes] = useState([]);
  const [hoverPos, setHoverPos] = useState(null);

  const [guessInput, setGuessInput] = useState('');
  const canvasRef = useRef(null);
  const startPosRef = useRef(null);
  const lastPosRef = useRef(null);
  const currentPathRef = useRef(null);
  const isDrawingRef = useRef(false);

  // 绘制点
  const drawPoint = useCallback(({ x, y, color, size }) => {
    const ctx = canvasRef.current.getContext('2d');
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, size, 0, 2 * Math.PI); ctx.fill();
  }, []);

  // 绘制连续线
  const drawContinuous = useCallback(({ x, y, color, size }) => {
    const ctx = canvasRef.current.getContext('2d');
    ctx.strokeStyle = color;
    ctx.lineWidth = size * 2;
    const last = lastPosRef.current;
    if (last) {
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(x, y); ctx.stroke();
    }
    drawPoint({ x, y, color, size });
    lastPosRef.current = { x, y };
  }, [drawPoint]);

  // 绘制形状
  const drawShape = useCallback(({ tool, start, end, color, size }) => {
    const ctx = canvasRef.current.getContext('2d');
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    const dx = end.x - start.x, dy = end.y - start.y;
    ctx.beginPath();
    if (tool === 'line') {
      ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke();
    } else if (tool === 'rect') {
      ctx.strokeRect(start.x, start.y, dx, dy);
    } else if (tool === 'circle') {
      const r = Math.hypot(dx, dy);
      ctx.arc(start.x, start.y, r, 0, 2 * Math.PI); ctx.stroke();
    }
  }, []);

  // 添加形状或路径
  const addShape = useCallback(shape => {
    setShapes(prev => [...prev, shape]);
    // 绘制存储
    if (shape.tool === 'path') {
      // 绘制路径
      const ctx = canvasRef.current.getContext('2d');
      ctx.strokeStyle = shape.color;
      ctx.lineWidth = shape.size * 2;
      ctx.beginPath();
      const pts = shape.points;
      if (pts.length) {
        ctx.moveTo(pts[0].x, pts[0].y);
        pts.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.stroke();
      }
    } else {
      drawShape(shape);
    }
  }, [drawShape]);

  // 重绘所有
  const redraw = useCallback(preview => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    shapes.forEach(s => addShape(s));
    if (preview) addShape(preview);
  }, [shapes, addShape]);

  // 清空
  const resetCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setGuesses([]);
    setShapes([]);
  }, []);

  const getMousePos = e => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // Socket 事件
  useEffect(() => {
    socket.on('playerList', setPlayers);
    socket.on('roleUpdate', setRole);
    socket.on('newPrompt', setPrompt);
    socket.on('clearCanvas', resetCanvas);
    socket.on('drawing', data => addShape({ tool: 'path', points: [data], color: data.color, size: data.size }));
    socket.on('drawShape', addShape);
    socket.on('newGuess', g => setGuesses(prev => [...prev, g]));
    return () => socket.off();
  }, [resetCanvas, addShape]);

  // 鼠标按下
  const handleMouseDown = e => {
    if (role !== name || e.button !== 0) return;
    const pos = getMousePos(e);
    startPosRef.current = pos;
    isDrawingRef.current = true;
    if (tool === 'brush' || tool === 'eraser') {
      lastPosRef.current = pos;
      const color = tool === 'eraser' ? '#ffffff' : brushColor;
      // 初始化路径
      currentPathRef.current = { tool: 'path', points: [pos], color, size: brushSize };
      setShapes(prev => [...prev, currentPathRef.current]);
      drawContinuous({ x: pos.x, y: pos.y, color, size: brushSize });
      socket.emit('drawing', { x: pos.x, y: pos.y, color, size: brushSize });
    }
  };

  // 鼠标移动
  const handleMouseMove = e => {
    const pos = getMousePos(e);
    setHoverPos(pos);
    if (!isDrawingRef.current || role !== name) return;
    if (tool === 'brush' || tool === 'eraser') {
      const color = tool === 'eraser' ? '#ffffff' : brushColor;
      currentPathRef.current.points.push(pos);
      drawContinuous({ x: pos.x, y: pos.y, color, size: brushSize });
      socket.emit('drawing', { x: pos.x, y: pos.y, color, size: brushSize });
    } else {
      const preview = { tool, start: startPosRef.current, end: pos, color: brushColor, size: brushSize };
      redraw(preview);
    }
  };

  // 鼠标松开
  const handleMouseUp = e => {
    if (!isDrawingRef.current || role !== name) return;
    const pos = getMousePos(e);
    if (tool !== 'brush' && tool !== 'eraser') {
      const shape = { tool, start: startPosRef.current, end: pos, color: brushColor, size: brushSize };
      addShape(shape);
      socket.emit('drawShape', shape);
    } else {
      currentPathRef.current = null;
    }
    isDrawingRef.current = false;
  };

  // 提交猜词
  const submitGuess = () => {
    const text = guessInput.trim();
    if (!text) return;
    socket.emit('guess', { name, text });
    setGuessInput('');
  };

  // 控制事件
  const handleJoin = () => { if (!name.trim()) return alert('请输入昵称'); socket.emit('join', name.trim()); setJoined(true); };
  const handleStart = () => socket.emit('startGame');
  const handleSkip = () => socket.emit('skipPrompt');
  const handleClear = () => socket.emit('clearCanvas');
  const handleUndo = () => { setShapes(prev => prev.slice(0, -1)); redraw(); socket.emit('undo'); };

  // 样式
  const containerStyle = { maxWidth: 1000, margin: '20px auto', padding: 20, background: '#f5f5f5', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' };
  const btn = { padding:'8px 16px', marginRight:8, border:'none', borderRadius:4, cursor:'pointer' };
  const activeBtn = { background:'#4CAF50', color:'#fff' };
  const neutralBtn = { background:'#e0e0e0' };

  return (
    <div style={containerStyle}>
      {!joined ? (
        <div style={{ textAlign:'center' }}>
          <input placeholder="昵称" value={name} onChange={e=>setName(e.target.value)} style={{ padding:6, marginRight:8, borderRadius:4, border:'1px solid #ccc' }} />
          <button onClick={handleJoin} style={{ ...btn, ...activeBtn }}>加入</button>
        </div>
      ) : (
        <>
          <div style={{ marginBottom:12 }}><strong>在线玩家：</strong>{players.join('，')}</div>
          <button onClick={handleStart} style={{ ...btn, ...activeBtn }}>开始游戏</button>
          <div style={{ margin:'12px 0' }}><strong>当前画家：</strong><span style={{ color:'#d32f2f' }}>{role}</span></div>

          <div style={{ margin:'12px 0', display:'flex', alignItems:'center', flexWrap:'wrap' }}>
            <label style={{ marginRight:8 }}>工具：</label>
            {['brush','eraser','line','rect','circle'].map(t => (
              <button key={t} onClick={()=>setTool(t)} style={{ ...btn, ...(tool===t?activeBtn:neutralBtn) }}>{t}</button>
            ))}
            <label style={{ margin:'0 8px 0 16px' }}>颜色：</label>
            <input type="color" value={brushColor} onChange={e=>setBrushColor(e.target.value)} disabled={tool==='eraser'} style={{ marginRight:16 }} />
            <label style={{ marginRight:8 }}>粗细：</label>
            <input type="range" min={1} max={20} value={brushSize} onChange={e=>setBrushSize(+e.target.value)} />
            <span style={{ marginLeft:8 }}>{brushSize}px</span>
            <button onClick={handleClear} style={{ ...btn, background:'#f44336', color:'#fff', marginLeft:32 }}>清空画布</button>
            {role===name && <button onClick={handleUndo} style={{ ...btn, background:'#ff9800', color:'#fff', marginLeft:8 }}>撤销</button>}
          </div>

          {role===name && prompt && (
            <div style={{ marginBottom:12 }}>请画：<b>{prompt.title}</b>（{prompt.tags.join('，')}）</div>
          )}

          <canvas
            ref={canvasRef}
            width={800} height={500}
            style={{ border:'2px solid #666', borderRadius:4, background:'#fff', cursor:'crosshair' }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          />

          {tool==='eraser' && hoverPos && (
            <div style={{
              position:'absolute', top:hoverPos.y, left:hoverPos.x,
              width:brushSize*2, height:brushSize*2,
              border:'1px dashed #000', borderRadius:'50%',
              pointerEvents:'none', transform:'translate(-50%, -50%)'
            }} />
          )}

          {role===name ? (
            <div style={{ marginTop:16 }}>
              <h3>猜词列表</h3>
              <ul style={{ padding:0, listStyle:'none' }}>{guesses.map((g,i)=><li key={i}><b>{g.name}：</b>{g.text}</li>)}</ul>
              <button onClick={()=>socket.emit('endRound')} style={{ ...btn, ...activeBtn }}>结束回合</button>
              <button onClick={handleSkip} style={{ ...btn, ...neutralBtn }}>跳过</button>
            </div>
          ) : (
            <div style={{ marginTop:16 }}>
              <input
                placeholder="输入猜词"
                value={guessInput}
                onChange={e=>setGuessInput(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&submitGuess()}
                style={{ padding:6, marginRight:8, borderRadius:4, border:'1px solid #ccc' }}
              />
              <button onClick={submitGuess} style={{ ...btn, ...activeBtn }}>提交猜词</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default App;




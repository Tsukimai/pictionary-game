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

  // 用一个动作列表(actions)同时保存笔刷点/连线和形状
  const [actions, setActions] = useState([]);
  const [hoverPos, setHoverPos] = useState(null);

  const [guessInput, setGuessInput] = useState('');
  const canvasRef = useRef(null);
  const canvasWrapperRef = useRef(null);
  const startPosRef = useRef(null);
  const lastPosRef = useRef(null);
  const isDrawingRef = useRef(false);

  // 单点绘制
  const drawPoint = useCallback(({ x, y, color, size, begin }) => {
    const ctx = canvasRef.current.getContext('2d');
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, 2 * Math.PI);
    ctx.fill();
  
    // 如果这是一次“起笔”，就把 lastPosRef 设为这个点
    if (begin) {
      lastPosRef.current = { x, y };
    }
  }, []);
  // 连续绘制（两点连线 + 当前点）
  const drawContinuous = useCallback(({ x, y, color, size }) => {
    const ctx = canvasRef.current.getContext('2d');
    ctx.strokeStyle = color;
    ctx.lineWidth = size * 2;
    const last = lastPosRef.current;
    if (last) {
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(x, y, size, 0, 2 * Math.PI);
    ctx.fill();
    lastPosRef.current = { x, y };
  }, []);

  // 画形状：line / rect / circle
  const drawShape = useCallback(({ tool, start, end, color, size }) => {
    const ctx = canvasRef.current.getContext('2d');
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    ctx.beginPath();
    if (tool === 'line') {
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    } else if (tool === 'rect') {
      ctx.strokeRect(start.x, start.y, dx, dy);
    } else if (tool === 'circle') {
      const r = Math.hypot(dx, dy);
      ctx.arc(start.x, start.y, r, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }, []);

  // 重绘整个画布：回放 actions
  const redraw = useCallback(preview => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  
    // **这里清空全局的 lastPos，让后续 replay 从头开始连线**
    lastPosRef.current = null;
  
    actions.forEach(act => {
      if (act.tool === 'brush') {
        if (act.begin) {
          drawPoint(act);            // 这里会因为 begin=true 而更新 lastPosRef
        } else {
          drawContinuous(act);       // 正常从 lastPosRef 连到 act
        }
      } else {
        drawShape(act);
      }
    });
  
    // 最后再把当前的 shape 预览画上去
    if (preview) drawShape(preview);
  }, [actions, drawPoint, drawContinuous, drawShape]);

  // 完全重置
  const resetCanvas = useCallback(() => {
    const c = canvasRef.current;
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
    setActions([]);
    setGuesses([]);
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

    // 接收画笔事件
    socket.on('drawing', data => {
      // 先画
      if (data.begin) {
        lastPosRef.current = { x: data.x, y: data.y };
        drawPoint(data);
      } else {
        drawContinuous(data);
      }
      // 再记录
      setActions(prev => [...prev, data]);
    });

    // 接收形状
    socket.on('drawShape', shape => {
      drawShape(shape);
      setActions(prev => [...prev, shape]);
    });

    socket.on('newGuess', g => setGuesses(prev => [...prev, g]));

    socket.on('undo', () => {
      // 所有人都在这里删一次
      setActions(prev => {
        const next = prev.slice(0, -1);
        return next;
      });
      // redraw 也要同步回调
      setTimeout(() => redraw(), 0);
    });

    return () => socket.off();
  }, [drawPoint, drawContinuous, drawShape, resetCanvas, redraw]);

  // 鼠标按下
  const handleMouseDown = e => {
    if (role !== name || e.button !== 0) return;
    const pos = getMousePos(e);
    startPosRef.current = pos;
    isDrawingRef.current = true;
    if (tool === 'brush' || tool === 'eraser') {
      lastPosRef.current = pos;
      const color = tool === 'eraser' ? '#ffffff' : brushColor;
      const act = { tool: 'brush', x: pos.x, y: pos.y, color, size: brushSize, begin: true };
      // 本地画并记录
      drawPoint(act);
      setActions(prev => [...prev, act]);
      // 发给别人
      socket.emit('drawing', act);
    }
  };

  // 鼠标移动
  const handleMouseMove = e => {
    const pos = getMousePos(e);
    setHoverPos(pos);
    if (!isDrawingRef.current || role !== name) return;

    if (tool === 'brush' || tool === 'eraser') {
      const color = tool === 'eraser' ? '#ffffff' : brushColor;
      const act = { tool: 'brush', x: pos.x, y: pos.y, color, size: brushSize, begin: false };
      drawContinuous(act);
      setActions(prev => [...prev, act]);
      socket.emit('drawing', act);
    } else {
      // shape 预览
      const preview = {
        tool, start: startPosRef.current,
        end: pos, color: brushColor, size: brushSize
      };
      redraw(preview);
    }
  };

  // 鼠标松开
  const handleMouseUp = e => {
    if (!isDrawingRef.current || role !== name) return;
    const pos = getMousePos(e);
    if (tool !== 'brush' && tool !== 'eraser') {
      const shape = { tool, start: startPosRef.current, end: pos, color: brushColor, size: brushSize };
      // 本地画并记录
      drawShape(shape);
      setActions(prev => [...prev, shape]);
      socket.emit('drawShape', shape);
    }
    isDrawingRef.current = false;
  };

  const submitGuess = () => {
    const text = guessInput.trim();
    if (!text) return;
    socket.emit('guess', { name, text });
    setGuessInput('');
  };

  const handleJoin = () => {
    if (!name.trim()) return alert('请输入昵称');
    socket.emit('join', name.trim());
    setJoined(true);
  };
  const handleStart = () => socket.emit('startGame');
  const handleSkip  = () => socket.emit('skipPrompt');
  const handleClear = () => socket.emit('clearCanvas');
  const handleUndo  = () => socket.emit('undo');  // 只发一次，服务端广播后所有人在 on('undo') 删除一次

  const btnStyle   = { padding:'8px 16px', marginRight:8, border:'none', borderRadius:4, cursor:'pointer' };
  const activeBtn  = { background:'#4CAF50', color:'#fff' };
  const neutralBtn = { background:'#e0e0e0' };

  return (
    <div style={{
      position:'relative', maxWidth:1000, margin:'20px auto', padding:20,
      background:'#f5f5f5', borderRadius:8, boxShadow:'0 2px 8px rgba(0,0,0,0.1)'
    }}>
      {!joined ? (
        <div style={{ textAlign:'center' }}>
          <input
            placeholder="昵称"
            value={name}
            onChange={e=>setName(e.target.value)}
            style={{ padding:6, marginRight:8, borderRadius:4, border:'1px solid #ccc' }}
          />
          <button onClick={handleJoin} style={{ ...btnStyle, ...activeBtn }}>加入</button>
        </div>
      ) : (
        <>
          <div style={{ marginBottom:12 }}>
            <strong>在线玩家：</strong>{players.join('，')}
          </div>
          <button onClick={handleStart} style={{ ...btnStyle, ...activeBtn }}>开始游戏</button>
          <div style={{ margin:'12px 0' }}>
            <strong>当前画家：</strong>
            <span style={{ color:'#d32f2f' }}>{role}</span>
          </div>

          {/* 工具栏 */}
          <div style={{ margin:'12px 0', display:'flex', alignItems:'center' }}>
            <label style={{ marginRight:8 }}>工具：</label>
            {['brush','eraser','line','rect','circle'].map(t => (
              <button
                key={t}
                onClick={()=>setTool(t)}
                style={{ ...btnStyle, ...(tool===t? activeBtn: neutralBtn) }}
              >{t}</button>
            ))}
            <label style={{ margin:'0 8px 0 16px' }}>颜色：</label>
            <input
              type="color"
              value={brushColor}
              onChange={e=>setBrushColor(e.target.value)}
              disabled={tool==='eraser'}
              style={{ marginRight:16 }}
            />
            <label style={{ marginRight:8 }}>粗细：</label>
            <input
              type="range" min={1} max={20}
              value={brushSize}
              onChange={e=>setBrushSize(+e.target.value)}
            />
            <span style={{ marginLeft:8 }}>{brushSize}px</span>
            <button
              onClick={handleClear}
              style={{ ...btnStyle, background:'#f44336', color:'#fff', marginLeft:32 }}
            >清空画布</button>
            {role===name && (
              <button
                onClick={handleUndo}
                style={{ ...btnStyle, background:'#ff9800', color:'#fff', marginLeft:8 }}
              >撤销</button>
            )}
          </div>

          {/* 提示 */}
          {role===name && prompt && (
            <div style={{ marginBottom:12 }}>
              请画：<b>{prompt.title}</b>（{prompt.tags.join('，')}）
            </div>
          )}

          {/* 画布 + 橡皮预览 */}
          <div ref={canvasWrapperRef} style={{ position:'relative', display:'inline-block' }}>
            <canvas
              ref={canvasRef}
              width={800} height={500}
              style={{
                border:'2px solid #666',
                borderRadius:4,
                background:'#fff',
                cursor:'crosshair'
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            />
            {tool==='eraser' && hoverPos && (
              <div style={{
                position:'absolute',
                top:    hoverPos.y,
                left:   hoverPos.x,
                width:  brushSize*2,
                height: brushSize*2,
                border: '1px dashed #000',
                borderRadius: '50%',
                pointerEvents: 'none',
                transform: 'translate(-50%, -50%)'
              }}/>
            )}
          </div>

          {/* 猜词区 */}
          {role===name ? (
            <div style={{ marginTop:16 }}>
              <h3>猜词列表</h3>
              <ul style={{ listStyle:'none', padding:0 }}>
                {guesses.map((g,i)=>(
                  <li key={i} style={{ marginBottom:4 }}>
                    <b>{g.name}：</b>{g.text}
                  </li>
                ))}
              </ul>
              <button
                onClick={()=>socket.emit('endRound')}
                style={{ ...btnStyle, ...activeBtn }}
              >结束回合</button>
              <button
                onClick={handleSkip}
                style={{ ...btnStyle, ...neutralBtn }}
              >跳过</button>
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
              <button
                onClick={submitGuess}
                style={{ ...btnStyle, ...activeBtn }}
              >提交猜词</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default App;









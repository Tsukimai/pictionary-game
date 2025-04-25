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

  const [tool, setTool] = useState('brush');
  const [brushColor, setBrushColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(4);

  // 所有操作：stroke 或 shape
  const [actions, setActions] = useState([]);
  const [hoverPos, setHoverPos] = useState(null);
  const [guessInput, setGuessInput] = useState('');

  const canvasRef = useRef(null);
  const wrapperRef = useRef(null);
  const startPosRef = useRef(null);
  const lastPosRef = useRef(null);
  const isDrawingRef = useRef(false);

  // 绘制单点
  const drawPoint = useCallback(({ x, y, color, size }) => {
    const ctx = canvasRef.current.getContext('2d');
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, 2 * Math.PI);
    ctx.fill();
  }, []);

  // 连续绘制
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

  // 绘制直线/矩形/圆
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

  // 重绘所有 actions
  const redraw = useCallback(preview => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    actions.forEach(act => {
      if (act.type === 'stroke') {
        lastPosRef.current = null;
        act.points.forEach((pt, idx) => {
          if (idx === 0) {
            drawPoint(pt);
            lastPosRef.current = { x: pt.x, y: pt.y };
          } else {
            drawContinuous(pt);
          }
        });
      } else {
        drawShape(act);
      }
    });
    if (preview) drawShape(preview);
  }, [actions, drawPoint, drawContinuous, drawShape]);

  // 清空
  const resetCanvas = useCallback(() => {
    const ctx = canvasRef.current.getContext('2d');
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setActions([]);
    setGuesses([]);
  }, []);

  const getMousePos = e => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // Socket 同步
  useEffect(() => {
    socket.on('playerList', setPlayers);
    socket.on('roleUpdate', setRole);
    socket.on('newPrompt', setPrompt);
    socket.on('clearCanvas', resetCanvas);

    socket.on('strokeBegin', data => {
      setActions(prev => [...prev, { type: 'stroke', color: data.color, size: data.size, points: [data] }]);
      drawPoint(data);
      lastPosRef.current = { x: data.x, y: data.y };
    });

    socket.on('drawing', data => {
      setActions(prev => {
        const copy = [...prev];
        const last = copy[copy.length - 1]; if (last && last.type==='stroke') last.points.push(data);
        return copy;
      });
      drawContinuous(data);
    });

    socket.on('drawShape', shape => {
      setActions(prev => [...prev, { type: 'shape', ...shape }]);
      drawShape(shape);
    });

    socket.on('newGuess', g => setGuesses(prev => [...prev, g]));

    socket.on('undo', () => {
      setActions(prev => prev.slice(0, -1));
      setTimeout(() => redraw(), 0);
    });

    return () => socket.off();
  }, [drawPoint, drawContinuous, drawShape, resetCanvas, redraw]);

  // 画布交互
  const handleMouseDown = e => {
    if (role!==name || e.button!==0) return;
    const pos = getMousePos(e);
    startPosRef.current = pos;
    isDrawingRef.current = true;
    if (tool==='brush'||tool==='eraser'){
      const color = tool==='eraser'?'#fff':brushColor;
      const data={x:pos.x,y:pos.y,color,size:brushSize};
      setActions(prev=>[...prev,{type:'stroke',color,size:brushSize,points:[data]}]);
      drawPoint(data);
      lastPosRef.current=pos;
      socket.emit('strokeBegin',data);
    }
  };

  const handleMouseMove = e => {
    const pos = getMousePos(e);
    setHoverPos(pos);
    if (!isDrawingRef.current||role!==name) return;
    if(tool==='brush'||tool==='eraser'){
      const color=tool==='eraser'?'#fff':brushColor;
      const data={x:pos.x,y:pos.y,color,size:brushSize};
      setActions(prev=>{const c=[...prev];const l=c[c.length-1];if(l&&l.type==='stroke')l.points.push(data);return c;});
      drawContinuous(data);
      socket.emit('drawing',data);
    } else {
      const preview={tool,start:startPosRef.current,end:pos,color:brushColor,size:brushSize};
      redraw(preview);
    }
  };

  const handleMouseUp = e => {
    if(!isDrawingRef.current||role!==name) return;
    const pos=getMousePos(e);
    if(tool!=='brush'&&tool!=='eraser'){
      const shape={tool,start:startPosRef.current,end:pos,color:brushColor,size:brushSize};
      setActions(prev=>[...prev,{type:'shape',...shape}]);
      drawShape(shape);
      socket.emit('drawShape',shape);
    }
    isDrawingRef.current=false;
  };

  // 其他事件
  const submitGuess=()=>{const t=guessInput.trim();if(!t)return;socket.emit('guess',{name,text:t});setGuessInput('');};
  const handleJoin=()=>{if(!name.trim())return alert('请输入昵称');socket.emit('join',name.trim());setJoined(true);};
  const handleStart=()=>socket.emit('startGame');
  const handleSkip=()=>socket.emit('skipPrompt');
  const handleClear=()=>socket.emit('clearCanvas');
  const handleUndo=()=>socket.emit('undo');

  const btn={padding:'8px 16px',marginRight:8,border:'none',borderRadius:4,cursor:'pointer'};
  const active={background:'#4CAF50',color:'#fff'};
  const neutral={background:'#e0e0e0'};

  return (
    <div style={{position:'relative',maxWidth:1000,margin:'20px auto',padding:20,background:'#f5f5f5',borderRadius:8,boxShadow:'0 2px 8px rgba(0,0,0,0.1)'}}>
      {!joined ? (
        <div style={{textAlign:'center'}}>
          <input placeholder="昵称" value={name} onChange={e=>setName(e.target.value)}
            style={{padding:6,marginRight:8,borderRadius:4,border:'1px solid #ccc'}} />
          <button onClick={handleJoin} style={{...btn,...active}}>加入</button>
        </div>
      ):(<>
        <div style={{marginBottom:12}}><strong>在线：</strong>{players.join('，')}</div>
        <button onClick={handleStart} style={{...btn,...active}}>开始游戏</button>
        <div style={{margin:'12px 0'}}><strong>画家：</strong><span style={{color:'#d32f2f'}}>{role}</span></div>
        <div style={{margin:'12px 0',display:'flex',alignItems:'center'}}>
          <label>工具：</label>
          {['brush','eraser','line','rect','circle'].map(t=>(
            <button key={t} onClick={()=>setTool(t)}
              style={{...btn,...(tool===t?active:neutral)}}>{t}</button>
          ))}
          <label style={{marginLeft:16}}>颜色：</label>
          <input type="color" value={brushColor} onChange={e=>setBrushColor(e.target.value)}
            disabled={tool==='eraser'} style={{margin:'0 16px'}} />
          <label>粗细：</label>
          <input type="range" min={1} max={20} value={brushSize}
            onChange={e=>setBrushSize(+e.target.value)} />
          <span style={{marginLeft:8}}>{brushSize}px</span>
          <button onClick={handleClear} style={{...btn,background:'#f44336',color:'#fff',marginLeft:32}}>清空画布</button>
          {role===name&&<button onClick={handleUndo} style={{...btn,background:'#ff9800',color:'#fff',marginLeft:8}}>撤销</button>}
        </div>
        {role===name&&prompt&&(
          <div style={{marginBottom:12}}>请画：<b>{prompt.title}</b>（{prompt.tags.join('，')}）</div>
        )}
        <div ref={wrapperRef} style={{position:'relative',display:'inline-block'}}>
          <canvas ref={canvasRef} width={800} height={500}
            style={{border:'2px solid #666',borderRadius:4,background:'#fff',cursor:'crosshair'}}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp} />
          {tool==='eraser'&&hoverPos&&(
            <div style={{position:'absolute',top:hoverPos.y,left:hoverPos.x,
              width:brushSize*2,height:brushSize*2,border:'1px dashed #000',borderRadius:'50%',
              pointerEvents:'none',transform:'translate(-50%,-50%)'}} />
          )}
        </div>
        {role===name? (
          <div style={{marginTop:16}}>
            <h3>猜词</h3>
            <ul style={{listStyle:'none',padding:0}}>
              {guesses.map((g,i)=>(<li key={i} style={{marginBottom:4}}>
                <b>{g.name}：</b>{g.text}</li>))}
            </ul>
            <button onClick={()=>socket.emit('endRound')} style={{...btn,...active}}>结束</button>
            <button onClick={handleSkip} style={{...btn,...neutral}}>跳过</button>
          </div>
        ):(
          <div style={{marginTop:16}}>
            <input placeholder="输入猜词" value={guessInput} onChange={e=>setGuessInput(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&submitGuess()} style={{padding:6,marginRight:8,border:'1px solid #ccc',borderRadius:4}} />
            <button onClick={submitGuess} style={{...btn,...active}}>提交</button>
          </div>
        )}
      </>)}
    </div>
  );
}

export default App;












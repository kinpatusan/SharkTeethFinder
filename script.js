// script.js – Shark‑tooth detector PWA (UI thread)
// -----------------------------------------------------------------------------
// 2025‑06‑25  Portrait 4:3 full‑width, 1:1 detect, top/bottom mask – FINAL
//   • ビデオは画面横幅ぴったり（cover で黒帯ゼロ）
//   • 正方形検知エリア (1:1) の上下だけ半透明マスク
//   • bbox を cover スケールで再計算、検知領域外は描画しない
// -----------------------------------------------------------------------------
(() => {
  /* === DOM === */
  const video  = document.getElementById('cam');
  const canvas = document.getElementById('view');
  const status = document.getElementById('status');
  const ctx    = canvas.getContext('2d');

  const maskT = document.getElementById('maskT');
  const maskB = document.getElementById('maskB');
  // 左右マスクは不使用
  const maskL = document.getElementById('maskL');
  const maskR = document.getElementById('maskR');
  maskL.style.display = 'none';
  maskR.style.display = 'none';

  /* === UI === */
  const ui = document.createElement('div');
  Object.assign(ui.style, {
    position:'fixed',top:'8px',left:'50%',transform:'translateX(-50%)',
    background:'rgba(0,0,0,.55)',padding:'6px 12px',borderRadius:'8px',
    color:'#fff',fontSize:'14px',zIndex:1000,whiteSpace:'nowrap'});
  ui.innerHTML = `TH: <span id="thrVal">0.65</span>
    <input id="thr" type="range" min="0.10" max="0.90" step="0.05" value="0.65" style="width:120px;vertical-align:middle;">
    &nbsp;| Camera: <select id="camSel" style="background:#222;color:#fff;border-radius:4px;padding:2px 4px;"></select>`;
  document.body.appendChild(ui);
  const slider = document.getElementById('thr');
  const sliderVal = document.getElementById('thrVal');
  const camSel = document.getElementById('camSel');
  let TH = 0.65;
  slider.oninput = e => { TH = +e.target.value; sliderVal.textContent = TH.toFixed(2); };

  /* === Worker === */
  const wk = new Worker('worker.js');
  let workerReady = false;
  wk.onmessage = e => {
    if (e.data.type === 'ready') { workerReady = true; status.textContent = 'Ready'; }
    else if (e.data.type === 'bbox') { lastBoxes = new Float32Array(e.data.boxes); pending = false; }
  };
  wk.postMessage({ type:'init', modelUrl:'best.onnx', numThreads:2 });

  /* === Camera helpers === */
  let currentStream = null;
  async function listCams() { return (await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput'); }
  async function populateCamSel() {
    const cams = await listCams();
    const rear = cams.filter(c=>/rear|back|背面/i.test(c.label));
    const wide = rear[0] || cams[0];
    const ultra = rear.find(c=>/ultra[- ]?wide|超広角/i.test(c.label));
    camSel.innerHTML = '';
    const add = (c,l) => { if(!c) return; const o=document.createElement('option'); o.value=c.deviceId; o.textContent=l; camSel.appendChild(o);} ;
    add(wide,'背面カメラ'); add(ultra,'背面超広角');
    camSel.disabled = camSel.options.length<=1;
  }
  async function setupCamera(deviceId){
    if(currentStream) currentStream.getTracks().forEach(t=>t.stop());
    const constr = deviceId ? {video:{deviceId:{exact:deviceId}},audio:false}
                            : {video:{facingMode:'environment'},audio:false};
    currentStream = await navigator.mediaDevices.getUserMedia(constr);
    video.srcObject = currentStream;
    await video.play();
    layout.update(video.videoWidth, video.videoHeight);
  }
  camSel.onchange = async e => { status.textContent='Switching…'; await setupCamera(e.target.value); status.textContent='Ready'; };

  /* === Layout (cover) === */
  const layout = {
    scale:1, offsetX:0, offsetY:0, detectTop:0,
    update(sw,sh){
      if(!sw||!sh) return;
      // canvas = viewport (全画面)
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
      canvas.style.top = '0px';
      // cover scale
      this.scale = Math.max(canvas.width/sw, canvas.height/sh);
      const drawnW = sw * this.scale;
      const drawnH = sh * this.scale;
      this.offsetX = (canvas.width  - drawnW)/2;
      this.offsetY = (canvas.height - drawnH)/2;
      // 1:1 detect square top位置
      this.detectTop = (canvas.height - canvas.width) / 2;
      // mask update (半透明)
      maskT.style.cssText = `left:0;top:0;width:${canvas.width}px;height:${this.offsetY + this.detectTop}px;background:rgba(0,0,0,.45);position:fixed;pointer-events:none;z-index:999;`;
      maskB.style.cssText = `left:0;top:${this.offsetY + this.detectTop + canvas.width}px;width:${canvas.width}px;height:${canvas.height - (this.offsetY + this.detectTop + canvas.width)}px;background:rgba(0,0,0,.45);position:fixed;pointer-events:none;z-index:999;`;
    }
  };
  window.addEventListener('resize', () => layout.update(video.videoWidth, video.videoHeight));

  /* === Worker input (640×640) === */
  const tmp = document.createElement('canvas'); tmp.width = tmp.height = 640; const tctx = tmp.getContext('2d');
  function drawLetterbox(){
    const sw=video.videoWidth, sh=video.videoHeight;
    const s=Math.min(640/sw,640/sh);
    const dw=sw*s, dh=sh*s;
    const dx=(640-dw)/2, dy=(640-dh)/2;
    tctx.drawImage(video,0,0,sw,sh,dx,dy,dw,dh);
  }

  /* === Render loop === */
  let pending=false, lastBoxes=null;
  async function loop(){
    if(video.readyState>=2 && workerReady){
      const sw=video.videoWidth, sh=video.videoHeight;
      layout.update(sw,sh);
      // send frame to worker
      if(!pending){ drawLetterbox(); const bmp = await createImageBitmap(tmp); wk.postMessage({type:'frame', bitmap:bmp}, [bmp]); pending=true; }
      // draw background
      ctx.drawImage(video,0,0,sw,sh,layout.offsetX,layout.offsetY,sw*layout.scale,sh*layout.scale);
      // draw boxes
      if(lastBoxes){
        const sL=Math.min(640/sw,640/sh);
        const dwL=sw*sL, dhL=sh*sL;
        const dxL=(640-dwL)/2, dyL=(640-dhL)/2;
        ctx.lineWidth=3; ctx.strokeStyle='red'; ctx.fillStyle='yellow'; ctx.font='14px sans-serif';
        for(let i=0;i<lastBoxes.length;i+=6){
          const conf=lastBoxes[i+4]; if(conf<TH) continue;
          const vx1=(lastBoxes[i]   -dxL)/sL;
          const vy1=(lastBoxes[i+1] -dyL)/sL;
          const vx2=(lastBoxes[i+2] -dxL)/sL;
          const vy2=(lastBoxes[i+3] -dyL)/sL;
          const x1=layout.offsetX + vx1*layout.scale;
          const x2=layout.offsetX + vx2*layout.scale;
          const y1=layout.offsetY + vy1*layout.scale;
          const y2=layout.offsetY + vy2*layout.scale;
          if(y1<layout.detectTop || y2>layout.detectTop+canvas.width) continue;
          ctx.strokeRect(x1,y1,x2-x1,y2-y1);
          ctx.fillText((conf*100).toFixed(1)+'%', x1+4, y1+16);
        }
      }
    }
    requestAnimationFrame(loop);
  }

  /* === Init === */
  (async()=>{
    status.textContent='Requesting camera…';
    try{ await setup

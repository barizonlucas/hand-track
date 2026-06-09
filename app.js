import {
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

console.log(
  "%c[ VISÃO COMPUTACIONAL INICIADA ]%c SYS.ARCHITECT // BARIZA.DEV",
  "color: #00ff8c; font-weight: bold; background: #0c0d10; padding: 4px; border: 1px solid #00ff8c;",
  "color: #a0aab5; background: #0c0d10; padding: 4px;"
);

const WASM_CDN  = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const INDEX_TIP = 8;

const C = {
  connection: "rgba(0, 255, 140, 0.55)",
  landmark:   "#00ff8c",
  indexTip:   "#ffe500",
};

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]
];

const video          = document.getElementById("webcam");
const canvas         = document.getElementById("output-canvas");
const ctx            = canvas.getContext("2d");
const loadingOverlay = document.getElementById("loading-overlay");
const loaderSub      = document.getElementById("loader-sub");
const badgeDot       = document.getElementById("badge-dot");
const badgeLabel     = document.getElementById("badge-label");
const handCountEl    = document.getElementById("hand-count");
const fpsEl          = document.getElementById("fps-value");
const scoreCard      = document.getElementById("metric-score");
const scoreEl        = document.getElementById("score-value");

let handLandmarker = null;
let lastResults    = null;
let lastVideoTime  = -1;
let fpsSamples  = [];
let lastFrameTs = 0;

let activeTab = 'symmetry';

// ── Synth State ─────────────────
let audioCtx = null;
let osc = null;
let synthGain = null;
let synthFilter = null;
const C_MAJOR_SCALE = [261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88, 523.25];

// ── Reflex State ────────────────
let targetX = 0;
let targetY = 0;
let targetRadius = 40;
let score = 0;
let timeLeft = 30;
let gameState = 'waiting'; // 'waiting', 'playing', 'gameover'
let timerInterval = null;

// ── Lockpick State ──────────────
let lockTargets = []; // [Y_IND, Y_MED, Y_ANE, Y_MIN]
let lockScore = 0;
let lockHoldFrames = 0;
let lockState = 'playing'; // 'playing', 'success'
let lockSuccessTime = 0;

function generateLockpickTargets(H) {
  let points = [Math.random(), Math.random(), Math.random(), Math.random()];
  points.sort((a,b) => a - b);
  const safeTop = H * 0.2;
  const safeRange = H * 0.6;
  return points.map(p => safeTop + p * safeRange);
}

// ── Tab Wiring ──────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    activeTab = e.target.dataset.tab;
    
    scoreCard.style.display = activeTab === 'reflex' ? 'flex' : 'none';
    if (activeTab === 'synth') {
      if (!audioCtx) initAudio();
      else audioCtx.resume();
    } else if (audioCtx) {
      audioCtx.suspend();
    }

    if (activeTab !== 'reflex') {
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      gameState = 'waiting';
      score = 0;
      timeLeft = 30;
      scoreEl.textContent = score;
    }
    
    if (activeTab !== 'symmetry') {
      symShapeName = '';
    }
    
    if (activeTab !== 'lockpick') {
      lockHoldFrames = 0;
    }
  });
});

function initAudio() {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  osc = audioCtx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = C_MAJOR_SCALE[0];
  osc.start();
  
  synthFilter = audioCtx.createBiquadFilter();
  synthFilter.type = 'lowpass';
  synthFilter.frequency.value = 5000;
  
  synthGain = audioCtx.createGain();
  synthGain.gain.value = 0; // muted until hand appears
  
  osc.connect(synthFilter);
  synthFilter.connect(synthGain);
  synthGain.connect(audioCtx.destination);
}

function setStatus(label, state = "idle") {
  badgeLabel.textContent = label;
  badgeDot.className = "badge-dot" + (state === "active" ? " active" : state === "error" ? " error" : "");
}

function setLoaderText(t) { loaderSub.textContent = t; }
function hideLoader()      { loadingOverlay.classList.add("hidden"); }

function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}

function coverFit(vW, vH, cW, cH) {
  const vr = vW / vH;
  const cr = cW / cH;
  let dw, dh, dx, dy;
  if (vr > cr) {
    dh = cH; dw = cH * vr;
    dx = (cW - dw) / 2; dy = 0;
  } else {
    dw = cW; dh = cW / vr;
    dx = 0; dy = (cH - dh) / 2;
  }
  return { dx, dy, dw, dh };
}

function neon(color, lineWidth = 2, blur = 14) {
  ctx.strokeStyle = color;
  ctx.lineWidth   = lineWidth;
  ctx.shadowBlur  = blur;
  ctx.shadowColor = color;
}

function dot(x, y, color, radius = 4) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle   = color;
  ctx.shadowBlur  = 18;
  ctx.shadowColor = color;
  ctx.fill();
  ctx.shadowBlur  = 0;
}

// ── Symmetry Game State & Logic ────────────────
const SYM_SHAPES = ['diamond', 'circle', 'hexagon', 'star', 'sun'];
let symShapeName = '';
let symDrawSide = 'left'; 
let symTargetWaypoints = []; 
let symRefPoints = []; 
let symCurrentIndex = 0;
let symTrail = []; 
let symState = 'playing'; // 'playing', 'success'
let symSuccessStartTime = 0;
let symTargetRadius = 35; // collision tolerance

function getShapeWaypoints(shapeId) {
  const points = [];
  if (shapeId === 'circle') {
    const steps = 100;
    for (let i=0; i<=steps; i++) {
      const a = (i/steps) * Math.PI * 2;
      points.push({ x: Math.sin(a), y: -Math.cos(a) });
    }
  } else if (shapeId === 'diamond') {
    const corners = [{x:0, y:-1}, {x:1, y:0}, {x:0, y:1}, {x:-1, y:0}, {x:0, y:-1}];
    for(let c=0; c<4; c++) {
      const p1 = corners[c];
      const p2 = corners[c+1];
      for(let i=0; i<25; i++) {
        const t = i/25;
        points.push({ x: p1.x + (p2.x-p1.x)*t, y: p1.y + (p2.y-p1.y)*t });
      }
    }
  } else if (shapeId === 'hexagon') {
    const corners = [];
    for(let c=0; c<=6; c++) {
      const a = (c/6) * Math.PI * 2 - Math.PI/2;
      corners.push({ x: Math.cos(a), y: Math.sin(a) });
    }
    for(let c=0; c<6; c++) {
      const p1 = corners[c];
      const p2 = corners[c+1];
      for(let i=0; i<16; i++) {
        const t = i/16;
        points.push({ x: p1.x + (p2.x-p1.x)*t, y: p1.y + (p2.y-p1.y)*t });
      }
    }
  } else if (shapeId === 'star') {
    const corners = [];
    for(let c=0; c<=10; c++) {
      const a = (c/10) * Math.PI * 2 - Math.PI/2;
      const r = c % 2 === 0 ? 1 : 0.4;
      corners.push({ x: Math.cos(a)*r, y: Math.sin(a)*r });
    }
    for(let c=0; c<10; c++) {
      const p1 = corners[c];
      const p2 = corners[c+1];
      for(let i=0; i<10; i++) {
        const t = i/10;
        points.push({ x: p1.x + (p2.x-p1.x)*t, y: p1.y + (p2.y-p1.y)*t });
      }
    }
  } else if (shapeId === 'sun') {
    const corners = [];
    for(let c=0; c<=24; c++) {
      const a = (c/24) * Math.PI * 2 - Math.PI/2;
      const r = c % 2 === 0 ? 1 : 0.7;
      corners.push({ x: Math.cos(a)*r, y: Math.sin(a)*r });
    }
    for(let c=0; c<24; c++) {
      const p1 = corners[c];
      const p2 = corners[c+1];
      for(let i=0; i<5; i++) {
        const t = i/5;
        points.push({ x: p1.x + (p2.x-p1.x)*t, y: p1.y + (p2.y-p1.y)*t });
      }
    }
  }
  return points;
}

function initSymmetryGame(W, H) {
  const shapeId = SYM_SHAPES[Math.floor(Math.random() * SYM_SHAPES.length)];
  symShapeName = shapeId.toUpperCase();
  symDrawSide = Math.random() > 0.5 ? 'left' : 'right';
  symState = 'playing';
  symCurrentIndex = 0;
  symTrail = [];
  
  const rawPoints = getShapeWaypoints(shapeId);
  symTargetWaypoints = [];
  symRefPoints = [];
  
  const scale = Math.min(W, H) * 0.25; // Safe Zone scaling
  const cx = W / 2;
  const cy = H * 0.50; // Centered to balance top HUD and bottom footer
  
  for (const pt of rawPoints) {
    const sx = cx + pt.x * scale;
    const sy = cy + pt.y * scale;
    
    const isLeft = pt.x < 0;
    const isCenter = Math.abs(pt.x) < 0.01;
    
    if (symDrawSide === 'left') {
      if (isLeft || isCenter) symTargetWaypoints.push({x: sx, y: sy});
      if (!isLeft || isCenter) symRefPoints.push({x: sx, y: sy});
    } else {
      if (!isLeft || isCenter) symTargetWaypoints.push({x: sx, y: sy});
      if (isLeft || isCenter) symRefPoints.push({x: sx, y: sy});
    }
  }
}

function renderSymmetry(landmarks, W, H) {
  if (!symShapeName) {
    initSymmetryGame(W, H);
  }
  
  const cx = W / 2;
  
  // ── Draw HUD ──
  ctx.save();
  ctx.scale(-1, 1);
  ctx.translate(-W, 0);
  ctx.font = "bold 24px 'Space Mono', monospace";
  ctx.textAlign = "center";
  
  if (symState === 'playing') {
    ctx.fillStyle = "#ff00aa";
    ctx.fillText(`DESENHE O LADO PONTILHADO`, cx, 60);
    
    const pct = Math.round((symCurrentIndex / Math.max(1, symTargetWaypoints.length)) * 100);
    ctx.fillStyle = "#00ff8c";
    ctx.fillText(`PRECISÃO: ${pct}%`, cx, 96);
  } else if (symState === 'success') {
    ctx.fillStyle = "#00ff8c";
    ctx.font = "bold 38px 'Space Grotesk', sans-serif";
    ctx.fillText("SIMETRIA PERFEITA!", cx, H/2);
  }
  ctx.restore();

  // Draw Center Line
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, H);
  neon("rgba(255,0,170,0.5)", 2, 10);
  ctx.stroke();

  if (symState === 'playing') {
    // Draw Reference Half
    if (symRefPoints.length > 0) {
      ctx.beginPath();
      ctx.moveTo(symRefPoints[0].x, symRefPoints[0].y);
      for(let i=1; i<symRefPoints.length; i++) ctx.lineTo(symRefPoints[i].x, symRefPoints[i].y);
      neon("#ff00aa", 4, 15);
      ctx.stroke();
    }
    
    // Draw Collected Path
    if (symCurrentIndex > 1 && symTargetWaypoints.length > 0) {
      ctx.beginPath();
      ctx.moveTo(symTargetWaypoints[0].x, symTargetWaypoints[0].y);
      for(let i=1; i<symCurrentIndex; i++) ctx.lineTo(symTargetWaypoints[i].x, symTargetWaypoints[i].y);
      neon("#00ff8c", 4, 15);
      ctx.stroke();
    }
    
    // Draw Next 3 Ghost Points (Breadcrumbs)
    for(let i=symCurrentIndex; i<Math.min(symCurrentIndex + 3, symTargetWaypoints.length); i++) {
      const pt = symTargetWaypoints[i];
      const alpha = i === symCurrentIndex ? 1 : i === symCurrentIndex + 1 ? 0.6 : 0.3;
      dot(pt.x, pt.y, `rgba(0, 255, 140, ${alpha})`, 5);
    }
    
    // Draw Comet Trail
    if (symTrail.length > 1) {
      ctx.beginPath();
      ctx.moveTo(symTrail[0].x, symTrail[0].y);
      for(let i=1; i<symTrail.length; i++) ctx.lineTo(symTrail[i].x, symTrail[i].y);
      neon("#00c8ff", 6, 15);
      ctx.stroke();
    }
    
    if (landmarks && landmarks.length > 0) {
      const hand = landmarks[0];
      const tip = hand[INDEX_TIP];
      const x = tip.x * W;
      const y = tip.y * H;
      
      dot(x, y, C.indexTip, 8);
      
      symTrail.push({x, y});
      if (symTrail.length > 10) symTrail.shift(); // Fading comet length
      
      // Sequential Collision check
      if (symCurrentIndex < symTargetWaypoints.length) {
        const targetPt = symTargetWaypoints[symCurrentIndex];
        const dist = Math.sqrt((x-targetPt.x)**2 + (y-targetPt.y)**2);
        if (dist < symTargetRadius) {
          symCurrentIndex++;
        }
      }
      
      // Check Win (100% completion)
      if (symTargetWaypoints.length > 0 && symCurrentIndex === symTargetWaypoints.length) {
        symState = 'success';
        symSuccessStartTime = performance.now();
      }
    } else {
      if (symTrail.length > 0) symTrail.shift();
    }
  } else if (symState === 'success') {
    // Draw full glowing shape
    ctx.beginPath();
    if (symRefPoints.length > 0) {
      ctx.moveTo(symRefPoints[0].x, symRefPoints[0].y);
      for(let i=1; i<symRefPoints.length; i++) ctx.lineTo(symRefPoints[i].x, symRefPoints[i].y);
    }
    neon("#00ff8c", 8, 30);
    ctx.stroke();
    
    ctx.beginPath();
    if (symTargetWaypoints.length > 0) {
      ctx.moveTo(symTargetWaypoints[0].x, symTargetWaypoints[0].y);
      for(let i=1; i<symTargetWaypoints.length; i++) ctx.lineTo(symTargetWaypoints[i].x, symTargetWaypoints[i].y);
    }
    neon("#00ff8c", 8, 30);
    ctx.stroke();

    if (performance.now() - symSuccessStartTime > 1500) {
      symShapeName = ''; // reset game on next frame
    }
  }
}

function renderSynth(landmarks, handednesses, W, H) {
  // Draw base synth UI
  ctx.fillStyle = "rgba(0, 200, 255, 0.05)";
  ctx.fillRect(0, H - 100, W, 100);
  
  // Draw scale lanes
  const laneHeight = (H * 0.70) / 8;
  const safeZoneTop = H * 0.15;
  
  ctx.save();
  ctx.scale(-1, 1);
  ctx.translate(-W, 0);
  ctx.font = "bold 12px 'Space Mono', monospace";
  ctx.fillStyle = "rgba(0, 200, 255, 0.4)";
  ctx.textAlign = "left";
  for(let i=0; i<8; i++) {
    const y = safeZoneTop + (7 - i) * laneHeight;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(0, 200, 255, 0.1)";
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText(`${C_MAJOR_SCALE[i].toFixed(1)} Hz`, 20, y + 16);
  }
  ctx.restore();

  let pitchHand = null;
  let expHand = null;

  if (landmarks && handednesses) {
    for (let i = 0; i < landmarks.length; i++) {
      // MediaPipe "Left" = Camera Left = Physical Right Hand
      if (handednesses[i][0].categoryName === "Left") {
        pitchHand = landmarks[i];
      } else if (handednesses[i][0].categoryName === "Right") {
        expHand = landmarks[i];
      }
    }
  }

  if (audioCtx) {
    if (pitchHand || expHand) {
      if (pitchHand) {
        const tip = pitchHand[INDEX_TIP];
        const x = tip.x * W;
        const y = tip.y * H;
        
        let clampedY = (tip.y - 0.15) / 0.70;
        clampedY = Math.max(0, Math.min(1, clampedY));
        const normalizedY = 1 - clampedY;
        
        let noteIndex = Math.floor(normalizedY * 8);
        if (noteIndex > 7) noteIndex = 7;
        
        const targetFreq = C_MAJOR_SCALE[noteIndex];
        osc.frequency.setTargetAtTime(targetFreq, audioCtx.currentTime, 0.05); // Micro-portamento
        
        // Highlight Active Lane
        const laneY = safeZoneTop + (7 - noteIndex) * laneHeight;
        ctx.fillStyle = "rgba(0, 200, 255, 0.1)";
        ctx.fillRect(0, laneY, W, laneHeight);
        
        dot(x, y, "#00c8ff", 12);
        
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        neon("#00c8ff", 2, 15);
        ctx.stroke();
      }
      
      if (expHand) {
        const tip = expHand[INDEX_TIP];
        const x = tip.x * W;
        const y = tip.y * H;
        
        let clampedY = (tip.y - 0.15) / 0.70;
        clampedY = Math.max(0, Math.min(1, clampedY));
        const normalizedY = 1 - clampedY; // Volume
        
        let clampedX = (tip.x - 0.15) / 0.70;
        clampedX = Math.max(0, Math.min(1, clampedX));
        // tip.x approaches 0 when physical hand moves visually right in mirror
        // We want visual right = open filter (5000Hz), visual left (tip.x=1) = closed filter (300Hz)
        const filterFreq = 5000 - (clampedX * 4700); 
        
        synthGain.gain.setTargetAtTime(normalizedY, audioCtx.currentTime, 0.05);
        synthFilter.frequency.setTargetAtTime(filterFreq, audioCtx.currentTime, 0.05);
        
        dot(x, y, "#ff00aa", 12);
        
        // Filter Guide Line (vertical)
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        neon("#ff00aa", 1, 10);
        ctx.stroke();
      } else {
        // Fallback Expression
        synthGain.gain.setTargetAtTime(0.5, audioCtx.currentTime, 0.05);
        synthFilter.frequency.setTargetAtTime(5000, audioCtx.currentTime, 0.05);
      }
    } else {
      // Mute smoothly
      synthGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05);
    }
  }
}

function renderReflex(landmarks, W, H) {
  if (targetX === 0 && targetY === 0) {
    targetX = W / 2;
    targetY = H / 2;
    targetRadius = 50;
  }
  
  // ── Draw HUD inside Canvas ──
  ctx.save();
  // Un-flip context to draw readable text since parent context is flipped
  ctx.scale(-1, 1);
  ctx.translate(-W, 0);
  
  ctx.font = "bold 24px 'Space Mono', monospace";
  ctx.fillStyle = "#00ff8c";
  ctx.textAlign = "left";
  
  if (gameState === 'waiting') {
    ctx.fillText("TOQUE NO ALVO PARA INICIAR", 40, 60);
  } else if (gameState === 'playing') {
    ctx.fillText(`TEMPO: ${timeLeft}s`, 40, 60);
    ctx.fillText(`SCORE: ${score}`, 40, 96);
  } else if (gameState === 'gameover') {
    ctx.fillStyle = "#ff00aa";
    ctx.font = "bold 38px 'Space Grotesk', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("FIM DE JOGO", W / 2, H / 2 - 50);
    
    ctx.fillStyle = "#00ff8c";
    ctx.font = "bold 24px 'Space Mono', monospace";
    ctx.fillText(`PONTUAÇÃO FINAL: ${score}`, W / 2, H / 2);
    ctx.fillText("TOQUE NO ALVO CENTRAL PARA REINICIAR", W / 2, H / 2 + 40);
  }
  ctx.restore();
  
  // Position Restart Target
  if (gameState === 'gameover') {
    targetX = W / 2;
    targetY = H / 2 + 120;
    targetRadius = 50;
  }
  
  // Draw target
  dot(targetX, targetY, gameState === 'gameover' ? "#00c8ff" : "#ff00aa", targetRadius);
  
  if (landmarks && landmarks.length > 0) {
    for (const hand of landmarks) {
      const tip = hand[INDEX_TIP];
      const x = tip.x * W;
      const y = tip.y * H;
      
      dot(x, y, C.indexTip, 8);
      
      // Collision check
      const dx = x - targetX;
      const dy = y - targetY;
      const dist = Math.sqrt(dx*dx + dy*dy);
      
      if (dist < targetRadius) {
        if (gameState === 'waiting' || gameState === 'gameover') {
          gameState = 'playing';
          score = 0;
          scoreEl.textContent = score;
          timeLeft = 30;
          targetRadius = 40;
          moveTarget(W, H);
          
          if (timerInterval) clearInterval(timerInterval);
          timerInterval = setInterval(() => {
            timeLeft--;
            if (timeLeft <= 0) {
              clearInterval(timerInterval);
              timerInterval = null;
              gameState = 'gameover';
            }
          }, 1000);
        } else if (gameState === 'playing') {
          score++;
          scoreEl.textContent = score;
          moveTarget(W, H);
        }
        break; // Only process one touch per frame to avoid multi-count
      }
    }
  }
}

function moveTarget(W, H) {
  const marginX = W * 0.15;
  const marginYTop = H * 0.15;
  const marginYBottom = H * 0.25;
  targetX = marginX + Math.random() * (W - marginX * 2);
  targetY = marginYTop + Math.random() * (H - marginYTop - marginYBottom);
}

function renderLockpick(landmarks, W, H) {
  if (lockTargets.length === 0) {
    lockTargets = generateLockpickTargets(H);
  }
  
  ctx.save();
  ctx.scale(-1, 1);
  ctx.translate(-W, 0);
  ctx.font = "bold 24px 'Space Mono', monospace";
  ctx.textAlign = "left";
  
  if (lockState === 'playing') {
    ctx.fillStyle = "#ff00aa";
    ctx.fillText("ALINHE OS 4 DEDOS (1 MÃO)", 40, 60);
    ctx.fillStyle = "#00ff8c";
    ctx.fillText(`SCORE: ${lockScore}`, 40, 96);
    
    ctx.font = "bold 14px 'Space Mono', monospace";
    const labels = ["IND", "MED", "ANE", "MIN"];
    for (let i = 0; i < 4; i++) {
       ctx.fillStyle = "rgba(0, 255, 140, 0.5)";
       ctx.fillText(labels[i], 20, lockTargets[i] - 10);
    }
  } else if (lockState === 'success') {
    ctx.fillStyle = "#ff00aa";
    ctx.font = "bold 38px 'Space Grotesk', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("ACESSO CONCEDIDO!", W/2, H/2);
  }
  ctx.restore();
  
  if (lockState === 'playing') {
    let alignedCount = 0;
    const tolerance = H * 0.05; // 5% da tela
    
    let hand = null;
    if (landmarks && landmarks.length > 0) {
      hand = landmarks[0]; // APENAS a 1ª mão
    }
    
    const fingerTips = [8, 12, 16, 20]; // Indicador, Médio, Anelar, Mindinho
    
    for(let i=0; i<4; i++) {
      const targetY = lockTargets[i];
      let isAligned = false;
      
      if (hand) {
         const tip = hand[fingerTips[i]];
         const y = tip.y * H;
         const x = tip.x * W;
         
         if (Math.abs(y - targetY) < tolerance) {
           isAligned = true;
           alignedCount++;
         }
         
         dot(x, y, isAligned ? "#00ff8c" : "#ff00aa", 8);
      }
      
      ctx.beginPath();
      ctx.moveTo(0, targetY);
      ctx.lineTo(W, targetY);
      
      if (isAligned) {
        neon("#00ff8c", 3, 15);
      } else {
        ctx.strokeStyle = "rgba(0, 255, 140, 0.2)";
        ctx.lineWidth = 1;
        ctx.shadowBlur = 0;
      }
      ctx.stroke();
    }
    
    if (alignedCount === 4) {
      lockHoldFrames++;
      // Barra de progresso circular
      const progress = lockHoldFrames / 120;
      const r = 80;
      ctx.beginPath();
      ctx.arc(W/2, H/2, r, -Math.PI/2, (-Math.PI/2) + (Math.PI * 2 * progress));
      neon("#ff00aa", 8, 20);
      ctx.stroke();
      
      if (lockHoldFrames >= 120) {
        lockState = 'success';
        lockSuccessTime = performance.now();
        lockScore++;
      }
    } else {
      lockHoldFrames = 0; // Punição implacável
    }
    
  } else if (lockState === 'success') {
    if (performance.now() - lockSuccessTime > 1500) {
      lockState = 'playing';
      lockHoldFrames = 0;
      lockTargets = generateLockpickTargets(H);
    }
  }
}

function renderLoop(timestamp) {
  requestAnimationFrame(renderLoop);

  if (lastFrameTs > 0) {
    fpsSamples.push(1000 / (timestamp - lastFrameTs));
    if (fpsSamples.length > 30) fpsSamples.shift();
    fpsEl.textContent = Math.round(
      fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length,
    ).toString();
  }
  lastFrameTs = timestamp;

  if (!handLandmarker || video.readyState < 2) return;

  const W = canvas.width;
  const H = canvas.height;
  const { dx, dy, dw, dh } = coverFit(video.videoWidth, video.videoHeight, W, H);

  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    lastResults   = handLandmarker.detectForVideo(video, timestamp);
  }

  ctx.save();
  ctx.translate(W, 0);
  ctx.scale(-1, 1);

  ctx.fillStyle = "#04060f";
  ctx.fillRect(0, 0, W, H);

  ctx.globalAlpha = 0.86;
  ctx.drawImage(video, dx, dy, dw, dh);
  ctx.globalAlpha = 1;

  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.8);
  vig.addColorStop(0, "transparent");
  vig.addColorStop(1, "rgba(4,6,15,0.55)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // Draw Hand Skeleton Wireframe (High-tech feedback)
  if (lastResults?.landmarks) {
    for (const hand of lastResults.landmarks) {
      // Connect joints
      ctx.beginPath();
      for (const [startIdx, endIdx] of HAND_CONNECTIONS) {
        const pt1 = hand[startIdx];
        const pt2 = hand[endIdx];
        ctx.moveTo(pt1.x * W, pt1.y * H);
        ctx.lineTo(pt2.x * W, pt2.y * H);
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(0, 255, 140, 0.25)"; // Subtle cyan-green wireframe
      ctx.stroke();

      // Draw all 21 joints
      for (const pt of hand) {
        ctx.beginPath();
        ctx.arc(pt.x * W, pt.y * H, 2, 0, 2 * Math.PI);
        ctx.fillStyle = "rgba(0, 255, 140, 0.4)";
        ctx.fill();
      }
    }
  }

  // Routing
  switch (activeTab) {
    case 'symmetry': renderSymmetry(lastResults.landmarks, W, H); break;
    case 'synth': renderSynth(lastResults.landmarks, lastResults.handednesses, W, H); break;
    case 'reflex': renderReflex(lastResults.landmarks, W, H); break;
    case 'lockpick': renderLockpick(lastResults.landmarks, W, H); break;
  }

  ctx.restore();
  
  handCountEl.textContent = (lastResults?.landmarks?.length ?? 0).toString();
}

async function init() {
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  try {
    setLoaderText("Carregando MediaPipe Tasks…");
    const vision = await FilesetResolver.forVisionTasks(WASM_CDN);

    setLoaderText("Baixando modelo de mãos…");
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 2,
    });

    setLoaderText("Solicitando acesso à câmera…");
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      audio: false,
    });
    video.srcObject = stream;
    await new Promise((r) => video.addEventListener("loadeddata", r, { once: true }));

    setStatus("Rastreando", "active");
    hideLoader();
    requestAnimationFrame(renderLoop);

  } catch (err) {
    console.error("[init] Falha:", err);
    setStatus("Erro: " + err.message, "error");
    setLoaderText("❌ " + err.message);
  }
}

init();

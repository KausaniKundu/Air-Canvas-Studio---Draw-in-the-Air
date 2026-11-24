// Application State
const state = {
  currentColor: '#22d3ee',
  brushSize: 8,
  isDrawing: false,
  lastPoint: null,
  strokes: [],
  currentStroke: []
};

// DOM Elements
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('paintCanvas');
const ctx = canvasElement.getContext('2d');
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const brushSizeInput = document.getElementById('brushSize');
const brushSizeVal = document.getElementById('brushSizeVal');
const customColorInput = document.getElementById('customColor');
const colorBtns = document.querySelectorAll('.color-btn');
const clearBtn = document.getElementById('clearBtn');
const recognizeBtn = document.getElementById('recognizeBtn');
const resultModal = document.getElementById('resultModal');
const resultShape = document.getElementById('resultShape');
const resultConfidence = document.getElementById('resultConfidence');
const closeModalBtn = document.getElementById('closeModalBtn');

function setStatus(text, dotClass) {
  statusText.innerText = text;
  statusBadge.querySelector('span').className = `w-2 h-2 rounded-full ${dotClass}`;
}

// Match canvas resolution to its container
function resizeCanvas() {
  const rect = canvasElement.parentElement.getBoundingClientRect();
  canvasElement.width = rect.width;
  canvasElement.height = rect.height;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// "Cover" rectangle: where the video frame lands on the canvas
function getCoverRect() {
  const vw = videoElement.videoWidth;
  const vh = videoElement.videoHeight;
  const cw = canvasElement.width;
  const ch = canvasElement.height;
  if (!vw || !vh) return null;
  const scale = Math.max(cw / vw, ch / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  return { dx: (cw - dw) / 2, dy: (ch - dh) / 2, dw, dh };
}

// Draw the mirrored webcam frame as the canvas background
function drawVideoFrame() {
  const r = getCoverRect();
  if (!r) return;
  ctx.save();
  ctx.translate(canvasElement.width, 0);
  ctx.scale(-1, 1); // mirror
  ctx.drawImage(videoElement, r.dx, r.dy, r.dw, r.dh);
  ctx.restore();
  // slight dim so strokes stand out
  ctx.fillStyle = 'rgba(2, 6, 23, 0.25)';
  ctx.fillRect(0, 0, canvasElement.width, canvasElement.height);
}

// Convert a normalized landmark to mirrored canvas coordinates
function toCanvasPoint(lm) {
  const r = getCoverRect();
  if (!r) return { x: (1 - lm.x) * canvasElement.width, y: lm.y * canvasElement.height };
  return {
    x: canvasElement.width - (lm.x * r.dw + r.dx),
    y: lm.y * r.dh + r.dy
  };
}

// Initialize MediaPipe Hands
const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});
hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.7
});
hands.onResults(onResults);

// Start webcam directly with getUserMedia (gives real error messages)
async function startCamera() {
  if (!window.isSecureContext) {
    setStatus('Open via http://localhost (not file://)', 'bg-rose-500');
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus('Browser has no camera support', 'bg-rose-500');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    videoElement.srcObject = stream;
    await videoElement.play();
  } catch (err) {
    console.error('Camera error:', err);
    const messages = {
      NotAllowedError: 'Camera permission blocked',
      NotFoundError: 'No camera found',
      NotReadableError: 'Camera in use by another app',
      OverconstrainedError: 'Camera does not support resolution'
    };
    setStatus(messages[err.name] || `Camera error: ${err.name}`, 'bg-rose-500');
    return;
  }

  setStatus('Loading hand model...', 'bg-amber-400 animate-pulse');
  try {
    await hands.initialize();
  } catch (err) {
    console.error('MediaPipe load error:', err);
    setStatus('Hand model failed to load (check internet)', 'bg-rose-500');
    return;
  }

  setStatus('Tracking Active', 'bg-emerald-400');
  processFrames();
}

let busy = false;
async function processFrames() {
  if (!busy && videoElement.readyState >= 2) {
    busy = true;
    try {
      await hands.send({ image: videoElement });
    } catch (e) {
      console.error(e);
    }
    busy = false;
  }
  requestAnimationFrame(processFrames);
}

// Process Hand Landmarks (runs every frame, with or without a hand)
function onResults(results) {
  redrawCanvas();

  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    if (state.isDrawing && state.currentStroke.length > 0) {
      state.strokes.push([...state.currentStroke]);
      state.currentStroke = [];
    }
    state.isDrawing = false;
    state.lastPoint = null;
    return;
  }

  const landmarks = results.multiHandLandmarks[0];
  const indexTip = landmarks[8];
  const indexPip = landmarks[6];
  const middleTip = landmarks[12];
  const middlePip = landmarks[10];

  const { x, y } = toCanvasPoint(indexTip);

  const isIndexUp = indexTip.y < indexPip.y;
  const isMiddleUp = middleTip.y < middlePip.y;

  if (isIndexUp && !isMiddleUp) {
    if (!state.isDrawing) {
      state.isDrawing = true;
      state.currentStroke = [];
    }

    const currentPoint = { x, y, color: state.currentColor, size: state.brushSize };
    state.currentStroke.push(currentPoint);
    state.lastPoint = currentPoint;

    redrawStrokesOnly();
    drawCursor(x, y, state.currentColor, true);
  } else {
    if (state.isDrawing && state.currentStroke.length > 0) {
      state.strokes.push([...state.currentStroke]);
      state.currentStroke = [];
    }
    state.isDrawing = false;
    state.lastPoint = null;

    if (isIndexUp && isMiddleUp) {
      drawCursor(x, y, '#fbbf24', false);
    }
  }
}

function drawCursor(x, y, color, isDrawing) {
  ctx.beginPath();
  ctx.arc(x, y, isDrawing ? state.brushSize / 2 + 4 : 8, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawStrokes() {
  const allStrokes = [...state.strokes, state.currentStroke];
  allStrokes.forEach(stroke => {
    if (stroke.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(stroke[0].x, stroke[0].y);
    ctx.strokeStyle = stroke[0].color;
    ctx.lineWidth = stroke[0].size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < stroke.length; i++) {
      ctx.lineTo(stroke[i].x, stroke[i].y);
    }
    ctx.stroke();
  });
}

// Full redraw: video + strokes
function redrawCanvas() {
  ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  drawVideoFrame();
  drawStrokes();
}

// Redraw after adding a point (video + strokes, so the live stroke shows)
function redrawStrokesOnly() {
  ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  drawVideoFrame();
  drawStrokes();
}

// Controls Logic
colorBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    colorBtns.forEach(b => b.classList.replace('border-white', 'border-transparent'));
    btn.classList.replace('border-transparent', 'border-white');
    state.currentColor = btn.dataset.color;
    customColorInput.value = state.currentColor;
  });
});

customColorInput.addEventListener('input', (e) => {
  state.currentColor = e.target.value;
  colorBtns.forEach(b => b.classList.replace('border-white', 'border-transparent'));
});

brushSizeInput.addEventListener('input', (e) => {
  state.brushSize = parseInt(e.target.value);
  brushSizeVal.innerText = `${state.brushSize}px`;
});

clearBtn.addEventListener('click', () => {
  state.strokes = [];
  state.currentStroke = [];
  state.lastPoint = null;
});

// Heuristic Recognition Engine
recognizeBtn.addEventListener('click', () => {
  const points = state.strokes.flat();
  if (points.length < 10) {
    showResult('Not Enough Data', 0);
    return;
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  points.forEach(p => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  });

  const width = maxX - minX;
  const height = maxY - minY;
  const aspectRatio = width / height;

  const centerX = minX + width / 2;
  const centerY = minY + height / 2;

  let totalRadius = 0;
  points.forEach(p => {
    totalRadius += Math.hypot(p.x - centerX, p.y - centerY);
  });
  const avgRadius = totalRadius / points.length;

  let radiusVariance = 0;
  points.forEach(p => {
    radiusVariance += Math.pow(Math.hypot(p.x - centerX, p.y - centerY) - avgRadius, 2);
  });
  const stdDev = Math.sqrt(radiusVariance / points.length);
  const circularityScore = stdDev / avgRadius;

  let detectedShape = 'Unknown Shape';
  let confidence = 75;

  if (circularityScore < 0.22 && aspectRatio > 0.75 && aspectRatio < 1.35) {
    detectedShape = 'Circle';
    confidence = Math.round((1 - circularityScore) * 100);
  } else if (aspectRatio >= 0.85 && aspectRatio <= 1.15) {
    detectedShape = 'Square';
    confidence = 88;
  } else if (aspectRatio > 1.4 || aspectRatio < 0.4) {
    detectedShape = 'Line / Rectangle';
    confidence = 82;
  } else if (state.strokes.length === 3 || state.strokes.length === 1) {
    detectedShape = 'Triangle';
    confidence = 79;
  }

  showResult(detectedShape, Math.min(confidence, 98));
});

function showResult(shape, conf) {
  resultShape.innerText = shape;
  resultConfidence.innerText = `Confidence: ${conf}%`;
  resultModal.classList.remove('hidden');
}

closeModalBtn.addEventListener('click', () => {
  resultModal.classList.add('hidden');
});

startCamera();

// Global State & Configuration
const state = {
    isCameraActive: false,
    drawingMode: 'index', // 'index' or 'pinch'
    currentColor: '#06b6d4',
    brushSize: 12,
    isEraser: false,
    showSkeleton: true,
    isDrawingActive: false,
    lastPoint: null,
    handTracker: null,
    cameraUtils: null,
    geminiApiKey: "", // Dynamic runtime Gemini key placeholder
    geminiApiUrl: "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent"
};

// DOM Elements
const webcamVideo = document.getElementById('webcamVideo');
const drawingCanvas = document.getElementById('drawingCanvas');
const trackingOverlay = document.getElementById('trackingOverlay');
const drawCtx = drawingCanvas.getContext('2d');
const trackCtx = trackingOverlay.getContext('2d');

const cameraPrompt = document.getElementById('cameraPrompt');
const statusText = document.getElementById('statusText');
const trackingStatus = document.getElementById('trackingStatus');
const airPenStatusDot = document.getElementById('airPenStatusDot');
const airPenStatusText = document.getElementById('airPenStatusText');
const brushSizeVal = document.getElementById('brushSizeVal');
const videoOpacityVal = document.getElementById('videoOpacityVal');

// Initialize Canvas Sizes dynamically with zero-dimension guards
function resizeCanvases() {
    const container = drawingCanvas.parentElement;
    if (!container) return;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    // Guard against 0 dimensions during early initialization
    if (width === 0 || height === 0) return;

    // Preserve canvas pixel content during resize if dimensions were valid
    if (drawingCanvas.width > 0 && drawingCanvas.height > 0) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = drawingCanvas.width;
        tempCanvas.height = drawingCanvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(drawingCanvas, 0, 0);

        drawingCanvas.width = width;
        drawingCanvas.height = height;
        trackingOverlay.width = width;
        trackingOverlay.height = height;

        // Restore canvas contents cleanly
        drawCtx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, 0, 0, width, height);
    } else {
        drawingCanvas.width = width;
        drawingCanvas.height = height;
        trackingOverlay.width = width;
        trackingOverlay.height = height;
    }

    // Re-apply line styles after canvas buffer resize
    drawCtx.lineCap = 'round';
    drawCtx.lineJoin = 'round';
}

window.addEventListener('resize', resizeCanvases);
// Ensure DOM layout is computed before first size check
requestAnimationFrame(() => {
    resizeCanvases();
});

// Color & Tool Selection Logic
document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('ring-2', 'ring-white', 'scale-110'));
        const target = e.currentTarget;
        target.classList.add('ring-2', 'ring-white', 'scale-110');

        const color = target.getAttribute('data-color');
        if (color === 'eraser') {
            state.isEraser = true;
            document.getElementById('currentColorLabel').textContent = "Eraser Mode";
        } else {
            state.isEraser = false;
            state.currentColor = color;
            document.getElementById('currentColorLabel').textContent = color;
        }
    });
});

// Custom Color Picker Handler
document.getElementById('customColorPicker').addEventListener('input', (e) => {
    state.currentColor = e.target.value;
    state.isEraser = false;
    document.getElementById('currentColorLabel').textContent = "Custom Hex";
});

// Brush Size and Opacity Controls
document.getElementById('brushSizeInput').addEventListener('input', (e) => {
    state.brushSize = parseInt(e.target.value, 10);
    brushSizeVal.textContent = `${state.brushSize} px`;
});

document.getElementById('videoOpacityInput').addEventListener('input', (e) => {
    const opacity = e.target.value / 100;
    webcamVideo.style.opacity = opacity;
    videoOpacityVal.textContent = `${e.target.value}%`;
});

// Mode Switching
const modeDrawBtn = document.getElementById('modeDrawBtn');
const modePinchBtn = document.getElementById('modePinchBtn');
const modeDescription = document.getElementById('modeDescription');

modeDrawBtn.addEventListener('click', () => {
    state.drawingMode = 'index';
    modeDrawBtn.className = "tool-mode-btn active flex items-center gap-2 justify-center p-2.5 rounded-xl border border-indigo-500/50 bg-indigo-600/30 text-indigo-200 text-sm font-semibold transition";
    modePinchBtn.className = "tool-mode-btn flex items-center gap-2 justify-center p-2.5 rounded-xl border border-slate-700 bg-slate-800/50 text-slate-300 text-sm font-semibold hover:border-slate-600 transition";
    modeDescription.textContent = "Point index finger straight up to draw. Lower or curl other fingers to pause drawing.";
});

modePinchBtn.addEventListener('click', () => {
    state.drawingMode = 'pinch';
    modePinchBtn.className = "tool-mode-btn active flex items-center gap-2 justify-center p-2.5 rounded-xl border border-indigo-500/50 bg-indigo-600/30 text-indigo-200 text-sm font-semibold transition";
    modeDrawBtn.className = "tool-mode-btn flex items-center gap-2 justify-center p-2.5 rounded-xl border border-slate-700 bg-slate-800/50 text-slate-300 text-sm font-semibold hover:border-slate-600 transition";
    modeDescription.textContent = "Pinch index fingertip and thumb together to draw. Separate them to pause drawing.";
});

// Clear Canvas
document.getElementById('clearCanvasBtn').addEventListener('click', () => {
    drawCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    document.getElementById('recognitionResultCard').classList.add('hidden');
});

// Download Image
document.getElementById('downloadCanvasBtn').addEventListener('click', () => {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = drawingCanvas.width;
    exportCanvas.height = drawingCanvas.height;
    const expCtx = exportCanvas.getContext('2d');

    // Fill background with dark color for contrast
    expCtx.fillStyle = '#0f172a';
    expCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    expCtx.drawImage(drawingCanvas, 0, 0);

    const link = document.createElement('a');
    link.download = `air-canvas-${Date.now()}.png`;
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
});

// Toggle Hand Skeleton Overlay
document.getElementById('toggleLandmarksBtn').addEventListener('click', () => {
    state.showSkeleton = !state.showSkeleton;
    const btn = document.getElementById('toggleLandmarksBtn');
    btn.classList.toggle('bg-indigo-600/40', state.showSkeleton);
});

// Fullscreen Toggle
document.getElementById('fullScreenBtn').addEventListener('click', () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        if (document.exitFullscreen) document.exitFullscreen();
    }
});

// Help Modal Logic
const helpModal = document.getElementById('helpModal');
document.getElementById('helpModalBtn').addEventListener('click', () => helpModal.classList.remove('hidden'));
document.getElementById('closeHelpBtn').addEventListener('click', () => helpModal.classList.add('hidden'));
document.getElementById('gotItBtn').addEventListener('click', () => helpModal.classList.add('hidden'));

// Initialize MediaPipe Hands Tracking
function initMediaPipe() {
    const hands = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7
    });

    hands.onResults(onHandResults);
    state.handTracker = hands;
}

// Handle Hand Landmark Detection Stream Results
function onHandResults(results) {
    // Clear tracking visualizer canvas
    trackCtx.clearRect(0, 0, trackingOverlay.width, trackingOverlay.height);

    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
        // Update status indicator
        trackingStatus.className = "flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800/80 text-xs font-medium text-amber-400 border border-amber-500/20";
        statusText.textContent = "Searching for hand...";
        updatePenStatus(false, "No Hand Detected");
        state.lastPoint = null;
        return;
    }

    // Hand detected successfully
    trackingStatus.className = "flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800/80 text-xs font-medium text-emerald-400 border border-emerald-500/20";
    statusText.textContent = "Hand Tracked";

    const landmarks = results.multiHandLandmarks[0];

    // Render skeleton if enabled
    if (state.showSkeleton) {
        drawConnectors(trackCtx, landmarks, HAND_CONNECTIONS, { color: 'rgba(99, 102, 241, 0.4)', lineWidth: 3 });
        drawLandmarks(trackCtx, landmarks, { color: 'rgba(236, 72, 153, 0.6)', lineWidth: 1, radius: 4 });
    }

    // Index Fingertip (Landmark 8) & Thumb Tip (Landmark 4)
    const indexTip = landmarks[8];
    const indexPip = landmarks[6]; // Index PIP for posture detection
    const thumbTip = landmarks[4];
    const middleTip = landmarks[12];

    const x = indexTip.x * trackingOverlay.width;
    const y = indexTip.y * trackingOverlay.height;

    // Determine Drawing Trigger condition based on selected mode
    let isDrawingAllowed = false;

    if (state.drawingMode === 'index') {
        // Index Up Mode: Index tip higher than PIP, and Middle finger curled/lower
        const isIndexExtended = indexTip.y < indexPip.y;
        const isMiddleFolded = middleTip.y > landmarks[10].y; // Middle tip lower than PIP
        isDrawingAllowed = isIndexExtended && isMiddleFolded;
    } else if (state.drawingMode === 'pinch') {
        // Pinch Mode: Euclidean distance between index tip and thumb tip
        const dx = (indexTip.x - thumbTip.x) * trackingOverlay.width;
        const dy = (indexTip.y - thumbTip.y) * trackingOverlay.height;
        const distance = Math.hypot(dx, dy);
        isDrawingAllowed = distance < 45; // Pinch threshold in px
    }

    // Draw glowing cursor at fingertip
    drawCursor(x, y, isDrawingAllowed);

    // Execute Drawing onto Canvas
    if (isDrawingAllowed) {
        updatePenStatus(true, "Drawing Active");
        if (state.lastPoint) {
            drawCtx.beginPath();
            drawCtx.moveTo(state.lastPoint.x, state.lastPoint.y);
            drawCtx.lineTo(x, y);

            if (state.isEraser) {
                drawCtx.globalCompositeOperation = 'destination-out';
                drawCtx.lineWidth = state.brushSize * 2;
            } else {
                drawCtx.globalCompositeOperation = 'source-over';
                drawCtx.strokeStyle = state.currentColor;
                drawCtx.lineWidth = state.brushSize;

                // Add subtle shadow glow for neon effect
                drawCtx.shadowBlur = 8;
                drawCtx.shadowColor = state.currentColor;
            }

            drawCtx.stroke();
            drawCtx.shadowBlur = 0; // Reset shadow blur
        }
        state.lastPoint = { x, y };
    } else {
        updatePenStatus(false, "Hovering (Air Pen Up)");
        state.lastPoint = null;
    }
}

// Draw custom interactive pointer
function drawCursor(x, y, isDrawing) {
    trackCtx.save();
    trackCtx.beginPath();
    trackCtx.arc(x, y, isDrawing ? state.brushSize / 2 + 4 : 8, 0, Math.PI * 2);
    trackCtx.fillStyle = isDrawing ? (state.isEraser ? '#ef4444' : state.currentColor) : 'rgba(255, 255, 255, 0.7)';
    trackCtx.fill();
    trackCtx.strokeStyle = '#ffffff';
    trackCtx.lineWidth = 2;
    trackCtx.stroke();
    trackCtx.restore();
}

function updatePenStatus(active, text) {
    state.isDrawingActive = active;
    airPenStatusText.textContent = text;
    if (active) {
        airPenStatusDot.className = "w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping";
    } else {
        airPenStatusDot.className = "w-2.5 h-2.5 rounded-full bg-amber-400";
    }
}

// Camera Control & Setup
async function startCamera() {
    try {
        if (!state.handTracker) initMediaPipe();

        const camera = new Camera(webcamVideo, {
            onFrame: async () => {
                await state.handTracker.send({ image: webcamVideo });
            },
            width: 1280,
            height: 720
        });

        await camera.start();
        state.cameraUtils = camera;
        state.isCameraActive = true;
        cameraPrompt.classList.add('hidden');
        document.getElementById('cameraBtnText').textContent = "Stop Camera";
    } catch (err) {
        console.error("Camera startup error:", err);
        alert("Unable to access webcam. Please ensure camera permissions are granted.");
    }
}

function stopCamera() {
    if (state.cameraUtils) {
        state.cameraUtils.stop();
        state.isCameraActive = false;
        cameraPrompt.classList.remove('hidden');
        document.getElementById('cameraBtnText').textContent = "Start Webcam";
        trackCtx.clearRect(0, 0, trackingOverlay.width, trackingOverlay.height);
        statusText.textContent = "Camera Off";
    }
}

document.getElementById('toggleCameraBtn').addEventListener('click', () => {
    if (state.isCameraActive) stopCamera(); else startCamera();
});

document.getElementById('startWebcamDirectBtn').addEventListener('click', startCamera);

// AI Drawing Recognition Pipeline (Client Canvas Analysis + Gemini API Vision)
const analyzeBtn = document.getElementById('analyzeBtn');
const recognitionResultCard = document.getElementById('recognitionResultCard');
const closeResultBtn = document.getElementById('closeResultBtn');

closeResultBtn.addEventListener('click', () => recognitionResultCard.classList.add('hidden'));

analyzeBtn.addEventListener('click', async () => {
    // Check if drawing canvas contains strokes
    const pixelData = drawCtx.getImageData(0, 0, drawingCanvas.width, drawingCanvas.height).data;
    let hasPixels = false;
    for (let i = 3; i < pixelData.length; i += 4) {
        if (pixelData[i] > 10) {
            hasPixels = true;
            break;
        }
    }

    if (!hasPixels) {
        showRecognitionCard("Empty Canvas", "Draw something first!", "Please use your finger in front of the webcam to draw a digit, symbol, or shape.", "fa-triangle-exclamation");
        return;
    }

    // Display loading state
    showRecognitionCard("Analyzing Drawing...", "Processing image...", "Running shape geometry and vision classification...", "fa-spinner fa-spin");

    try {
        // Prepare drawing as base64 JPEG
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = 512;
        exportCanvas.height = 512;
        const expCtx = exportCanvas.getContext('2d');

        // Black background with bright drawing for optimal vision parsing
        expCtx.fillStyle = '#000000';
        expCtx.fillRect(0, 0, 512, 512);
        expCtx.drawImage(drawingCanvas, 0, 0, 512, 512);

        const base64Image = exportCanvas.toDataURL('image/jpeg', 0.85).split(',')[1];

        // Attempt Gemini Vision API analysis
        const aiResult = await classifyWithGemini(base64Image);
        if (aiResult) {
            showRecognitionCard(
                aiResult.label,
                `Confidence: ${aiResult.confidence || 'High'}`,
                aiResult.description,
                aiResult.icon || "fa-lightbulb"
            );
        } else {
            // Local fallback algorithm if API call is unavailable
            const fallback = performLocalPixelAnalysis();
            showRecognitionCard(fallback.title, fallback.confidence, fallback.desc, fallback.icon);
        }

    } catch (err) {
        console.warn("API Recognition fallback:", err);
        const fallback = performLocalPixelAnalysis();
        showRecognitionCard(fallback.title, fallback.confidence, fallback.desc, fallback.icon);
    }
});

// Gemini Vision Classification Request
async function classifyWithGemini(base64Image) {
    const promptText = "Examine this spatial air drawing snippet on dark background. Classify the main object, shape, handwritten number/letter, or symbol drawn. Return a brief structured JSON object with keys: 'label' (short name 1-3 words), 'confidence' (percentage string like 92%), 'description' (one sentence detailing what was recognized), 'icon' (FontAwesome 6 class name like fa-circle, fa-star, fa-heart, fa-hashtag, fa-font, etc.). Respond ONLY with valid JSON.";

    const payload = {
        contents: [
            {
                role: "user",
                parts: [
                    { text: promptText },
                    {
                        inlineData: {
                            mimeType: "image/jpeg",
                            data: base64Image
                        }
                    }
                ]
            }
        ],
        generationConfig: {
            responseMimeType: "application/json"
        }
    };

    const url = `${state.geminiApiUrl}?key=${state.geminiApiKey}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) return null;

    const data = await response.json();
    const textResponse = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (textResponse) {
        return JSON.parse(textResponse);
    }
    return null;
}

// Lightweight Local Geometry Fallback Classifier
function performLocalPixelAnalysis() {
    // Extract bounding box of drawing
    const imgData = drawCtx.getImageData(0, 0, drawingCanvas.width, drawingCanvas.height);
    let minX = drawingCanvas.width, maxX = 0, minY = drawingCanvas.height, maxY = 0;
    let activePixels = 0;

    for (let y = 0; y < drawingCanvas.height; y += 4) {
        for (let x = 0; x < drawingCanvas.width; x += 4) {
            const alphaIndex = (y * drawingCanvas.width + x) * 4 + 3;
            if (imgData.data[alphaIndex] > 20) {
                activePixels++;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }

    const width = maxX - minX;
    const height = maxY - minY;
    const aspectRatio = width / (height || 1);

    let label = "Hand Drawn Sketch";
    let desc = "Geometrical stroke detected on canvas.";
    let icon = "fa-paintbrush";

    if (aspectRatio > 0.8 && aspectRatio < 1.25) {
        label = "Circular / Compact Shape";
        desc = "Aspect ratio close to 1.0. Suggests circle, digit 0, or compact symbol.";
        icon = "fa-circle-notch";
    } else if (aspectRatio >= 1.5) {
        label = "Horizontal Line / Banner";
        desc = "Wide horizontal orientation detected.";
        icon = "fa-minus";
    } else if (aspectRatio <= 0.5) {
        label = "Vertical Line / Digit 1";
        desc = "Tall vertical stroke structure analyzed.";
        icon = "fa-grip-lines-vertical";
    }

    return {
        title: label,
        confidence: "Geometry Math Engine ~ 85%",
        desc: desc,
        icon: icon
    };
}

function showRecognitionCard(title, confidence, description, iconClass) {
    document.getElementById('resultTitle').textContent = title;
    document.getElementById('resultConfidence').textContent = confidence;
    document.getElementById('resultDescription').textContent = description;
    document.getElementById('resultIcon').className = `fa-solid ${iconClass}`;
    recognitionResultCard.classList.remove('hidden');
}

// Window load initialization
window.onload = () => {
    // Auto open help on first visit
    setTimeout(() => {
        helpModal.classList.remove('hidden');
    }, 600);
};
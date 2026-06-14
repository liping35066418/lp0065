const VOICE_WS_URL = 'ws://localhost:8755';
const VOICE_HTTP_URL = 'http://localhost:8755';

const AppState = {
  isRecording: false,
  audioContext: null,
  mediaStream: null,
  analyser: null,
  sourceNode: null,
  scriptProcessor: null,
  webSocket: null,
  waveformView: 'waveform',
  startTime: 0,
  elapsedTime: 0,
  timeAnimationId: null,
  canvasCtx: null,
  canvasWidth: 0,
  canvasHeight: 0,
  animationId: null,
  frequencyData: null,
  timeData: null,
  detections: [],
  segments: [],
  totalDuration: 0,
  confidenceSum: 0,
  langCounts: { zh: 0, en: 0, ja: 0, ko: 0, fr: 0, de: 0 },
  currentMode: 'auto',
  chunkCounter: 0
};

const LangLabels = {
  zh: '中文',
  en: 'EN',
  ja: '日本語',
  ko: '한국어',
  fr: 'FR',
  de: 'DE'
};

const LangColors = {
  zh: ['#ef4444', '#f59e0b'],
  en: ['#3b82f6', '#06b6d4'],
  ja: ['#ec4899', '#8b5cf6'],
  ko: ['#8b5cf6', '#3b82f6'],
  fr: ['#10b981', '#3b82f6'],
  de: ['#f59e0b', '#10b981']
};

const elements = {
  statusDot: null,
  statusText: null,
  micButton: null,
  micLabel: null,
  micState: null,
  ringWave: null,
  modeSelect: null,
  volumeLevel: null,
  volumeValue: null,
  volumePeak: null,
  languageValue: null,
  accentValue: null,
  confidenceFill: null,
  confidenceValue: null,
  detectionId: null,
  updateBadge: null,
  totalDetections: null,
  totalDuration: null,
  totalSegments: null,
  avgConfidence: null,
  langBars: null,
  tabWaveform: null,
  tabSpectrum: null,
  tabCircular: null,
  waveformCanvas: null,
  overlayFreq: null,
  overlayTime: null,
  segmentsList: null,
  segmentCount: null,
  clearSegments: null
};

function init() {
  cacheElements();
  bindEvents();
  initCanvas();
  initLangBars();
  connectWebSocket();
}

function cacheElements() {
  elements.statusDot = document.getElementById('statusDot');
  elements.statusText = document.getElementById('statusText');
  elements.micButton = document.getElementById('micButton');
  elements.micLabel = document.getElementById('micLabel');
  elements.micState = document.getElementById('micState');
  elements.ringWave = document.getElementById('ringWave');
  elements.modeSelect = document.getElementById('modeSelect');
  elements.volumeLevel = document.getElementById('volumeLevel');
  elements.volumeValue = document.getElementById('volumeValue');
  elements.volumePeak = document.getElementById('volumePeak');
  elements.languageValue = document.getElementById('languageValue');
  elements.accentValue = document.getElementById('accentValue');
  elements.confidenceFill = document.getElementById('confidenceFill');
  elements.confidenceValue = document.getElementById('confidenceValue');
  elements.detectionId = document.getElementById('detectionId');
  elements.updateBadge = document.getElementById('updateBadge');
  elements.totalDetections = document.getElementById('totalDetections');
  elements.totalDuration = document.getElementById('totalDuration');
  elements.totalSegments = document.getElementById('totalSegments');
  elements.avgConfidence = document.getElementById('avgConfidence');
  elements.langBars = document.getElementById('langBars');
  elements.tabWaveform = document.getElementById('tabWaveform');
  elements.tabSpectrum = document.getElementById('tabSpectrum');
  elements.tabCircular = document.getElementById('tabCircular');
  elements.waveformCanvas = document.getElementById('waveformCanvas');
  elements.overlayFreq = document.getElementById('overlayFreq');
  elements.overlayTime = document.getElementById('overlayTime');
  elements.segmentsList = document.getElementById('segmentsList');
  elements.segmentCount = document.getElementById('segmentCount');
  elements.clearSegments = document.getElementById('clearSegments');
}

function bindEvents() {
  elements.micButton.addEventListener('click', toggleMicrophone);
  elements.modeSelect.addEventListener('change', handleModeChange);
  elements.clearSegments.addEventListener('click', clearSegments);

  [elements.tabWaveform, elements.tabSpectrum, elements.tabCircular].forEach(tab => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('.wave-tab').forEach(t => t.classList.remove('active'));
      e.target.classList.add('active');
      AppState.waveformView = e.target.dataset.view;
    });
  });

  window.addEventListener('resize', initCanvas);
}

function initCanvas() {
  const canvas = elements.waveformCanvas;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;

  AppState.canvasCtx = canvas.getContext('2d');
  AppState.canvasCtx.scale(dpr, dpr);

  AppState.canvasWidth = rect.width;
  AppState.canvasHeight = rect.height;
}

function initLangBars() {
  const langs = ['zh', 'en', 'ja', 'ko', 'fr', 'de'];
  elements.langBars.innerHTML = langs.map(code => `
    <div class="lang-bar-item">
      <span class="lang-bar-label">${LangLabels[code]}</span>
      <div class="lang-bar-track">
        <div class="lang-bar-fill ${code}" id="langFill-${code}" style="width: 0%"></div>
      </div>
      <span class="lang-bar-count" id="langCount-${code}">0</span>
    </div>
  `).join('');
}

function connectWebSocket() {
  updateConnectionStatus(false, '连接中...');

  try {
    AppState.webSocket = new WebSocket(VOICE_WS_URL);

    AppState.webSocket.onopen = () => {
      updateConnectionStatus(true, '已连接');
      if (AppState.currentMode !== 'auto') {
        sendModeChange(AppState.currentMode);
      }
    };

    AppState.webSocket.onmessage = (event) => {
      handleWSMessage(JSON.parse(event.data));
    };

    AppState.webSocket.onclose = () => {
      updateConnectionStatus(false, '已断开');
      setTimeout(connectWebSocket, 3000);
    };

    AppState.webSocket.onerror = () => {
      updateConnectionStatus(false, '连接错误');
    };
  } catch (e) {
    updateConnectionStatus(false, '连接失败');
    setTimeout(connectWebSocket, 3000);
  }
}

function handleWSMessage(data) {
  switch (data.type) {
    case 'connected':
      break;
    case 'detection':
      handleDetection(data);
      break;
    case 'segment':
      handleSegment(data);
      break;
    case 'audio_ack':
      handleAudioAck(data);
      break;
    case 'mode_changed':
      break;
  }
}

function updateConnectionStatus(connected, text) {
  const badge = document.getElementById('connectionStatus');
  badge.classList.toggle('connected', connected);
  elements.statusText.textContent = text;
}

async function toggleMicrophone() {
  if (AppState.isRecording) {
    stopMicrophone();
  } else {
    await startMicrophone();
  }
}

async function startMicrophone() {
  try {
    AppState.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 44100
      }
    });

    AppState.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
    AppState.sourceNode = AppState.audioContext.createMediaStreamSource(AppState.mediaStream);
    AppState.analyser = AppState.audioContext.createAnalyser();
    AppState.analyser.fftSize = 2048;
    AppState.analyser.smoothingTimeConstant = 0.8;

    AppState.sourceNode.connect(AppState.analyser);

    AppState.frequencyData = new Uint8Array(AppState.analyser.frequencyBinCount);
    AppState.timeData = new Uint8Array(AppState.analyser.fftSize);

    const bufferSize = 4096;
    AppState.scriptProcessor = AppState.audioContext.createScriptProcessor(bufferSize, 1, 1);
    AppState.analyser.connect(AppState.scriptProcessor);
    AppState.scriptProcessor.connect(AppState.audioContext.destination);

    AppState.scriptProcessor.onaudioprocess = (e) => {
      if (!AppState.isRecording) return;
      const inputData = e.inputBuffer.getChannelData(0);
      processAudioChunk(inputData);
    };

    AppState.isRecording = true;
    AppState.startTime = Date.now();

    updateMicUI(true);
    startElapsedTimer();
    startVisualization();

  } catch (err) {
    console.error('麦克风启动失败:', err);
    alert('无法访问麦克风，请检查权限设置。\n错误: ' + err.message);
  }
}

function stopMicrophone() {
  AppState.isRecording = false;

  if (AppState.mediaStream) {
    AppState.mediaStream.getTracks().forEach(track => track.stop());
    AppState.mediaStream = null;
  }

  if (AppState.scriptProcessor) {
    AppState.scriptProcessor.disconnect();
    AppState.scriptProcessor = null;
  }

  if (AppState.analyser) {
    AppState.analyser.disconnect();
    AppState.analyser = null;
  }

  if (AppState.sourceNode) {
    AppState.sourceNode.disconnect();
    AppState.sourceNode = null;
  }

  if (AppState.audioContext) {
    AppState.audioContext.close();
    AppState.audioContext = null;
  }

  if (AppState.animationId) {
    cancelAnimationFrame(AppState.animationId);
    AppState.animationId = null;
  }

  stopElapsedTimer();
  updateMicUI(false);
  resetVolumeDisplay();
  clearCanvas();
}

function updateMicUI(recording) {
  elements.micButton.classList.toggle('recording', recording);
  elements.ringWave.classList.toggle('active', recording);
  elements.micLabel.textContent = recording ? '停止采集' : '启动麦克风';
  elements.micState.textContent = recording ? 'ON' : 'OFF';
  elements.updateBadge.textContent = recording ? 'LIVE' : 'IDLE';
  elements.updateBadge.classList.toggle('active', recording);
}

function processAudioChunk(rawData) {
  AppState.chunkCounter++;

  const audioArray = Array.from(rawData);

  let sum = 0, peak = 0;
  for (let i = 0; i < rawData.length; i++) {
    sum += rawData[i] * rawData[i];
    if (Math.abs(rawData[i]) > peak) peak = Math.abs(rawData[i]);
  }
  const rms = Math.sqrt(sum / rawData.length);
  const volumePct = Math.min(100, Math.round(rms * 300));
  updateVolumeDisplay(volumePct, peak);

  if (AppState.webSocket && AppState.webSocket.readyState === WebSocket.OPEN) {
    try {
      const downsampled = downsampleAudio(audioArray, 200);
      AppState.webSocket.send(JSON.stringify({
        type: 'audio_chunk',
        chunkId: AppState.chunkCounter,
        audioData: downsampled
      }));
    } catch (e) {}
  }
}

function downsampleAudio(data, targetSize) {
  if (data.length <= targetSize) return data;
  const step = data.length / targetSize;
  const result = [];
  for (let i = 0; i < targetSize; i++) {
    result.push(data[Math.floor(i * step)]);
  }
  return result;
}

function updateVolumeDisplay(volume, peak) {
  elements.volumeLevel.style.width = volume + '%';
  elements.volumeValue.textContent = volume + '%';
  elements.volumePeak.textContent = 'Peak: ' + peak.toFixed(2);
}

function resetVolumeDisplay() {
  elements.volumeLevel.style.width = '0%';
  elements.volumeValue.textContent = '0%';
  elements.volumePeak.textContent = 'Peak: 0';
}

function startElapsedTimer() {
  const update = () => {
    if (!AppState.isRecording) return;
    AppState.elapsedTime = Date.now() - AppState.startTime;
    elements.overlayTime.textContent = formatTime(AppState.elapsedTime);
    AppState.timeAnimationId = requestAnimationFrame(update);
  };
  update();
}

function stopElapsedTimer() {
  if (AppState.timeAnimationId) {
    cancelAnimationFrame(AppState.timeAnimationId);
  }
}

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function handleModeChange(e) {
  AppState.currentMode = e.target.value;
  sendModeChange(AppState.currentMode);
}

function sendModeChange(mode) {
  if (AppState.webSocket && AppState.webSocket.readyState === WebSocket.OPEN) {
    AppState.webSocket.send(JSON.stringify({
      type: 'set_mode',
      mode: mode
    }));
  }
}

function handleDetection(data) {
  AppState.detections.push(data);
  AppState.confidenceSum += data.confidence;

  if (LangCounts[data.language] !== undefined) {
    AppState.langCounts[data.language]++;
  }

  elements.languageValue.textContent = data.languageName;
  elements.accentValue.textContent = data.accent;
  elements.detectionId.textContent = '#' + data.detectionId;

  const pct = Math.round(data.confidence * 100);
  elements.confidenceFill.style.width = pct + '%';
  elements.confidenceValue.textContent = pct + '%';
  elements.confidenceFill.classList.remove('high', 'medium', 'low');
  if (pct >= 75) elements.confidenceFill.classList.add('high');
  else if (pct >= 50) elements.confidenceFill.classList.add('medium');
  else elements.confidenceFill.classList.add('low');
  elements.confidenceValue.style.color = pct >= 75 ? 'var(--accent-green)' : pct >= 50 ? 'var(--accent-orange)' : 'var(--accent-red)';

  elements.updateBadge.textContent = 'UPDATED';
  setTimeout(() => {
    if (AppState.isRecording) elements.updateBadge.textContent = 'LIVE';
  }, 500);

  updateStats();
  updateLangDistribution();
}

function handleSegment(data) {
  AppState.segments.unshift(data);
  AppState.totalDuration += data.duration;
  renderSegment(data);
  elements.segmentCount.textContent = AppState.segments.length;
  updateStats();
}

function handleAudioAck(data) {
  if (data.features) {
    const freq = Math.round(800 + data.features.centroid * 8000);
    elements.overlayFreq.textContent = freq.toLocaleString() + ' Hz';
  }
}

function renderSegment(segment) {
  if (AppState.segments.length === 1) {
    elements.segmentsList.innerHTML = '';
  }

  const confPct = Math.round(segment.confidence * 100);
  const timeStr = new Date(segment.timestamp).toLocaleTimeString('zh-CN', { hour12: false });

  const item = document.createElement('div');
  item.className = 'segment-item';
  item.dataset.lang = segment.language;
  item.innerHTML = `
    <div class="segment-header">
      <div class="segment-tags">
        <span class="segment-tag lang">${segment.languageName}</span>
        <span class="segment-tag accent">${segment.accent}</span>
        <span class="segment-tag confidence">${confPct}%</span>
      </div>
      <span class="segment-time">${timeStr}</span>
    </div>
    <div class="segment-text">${escapeHtml(segment.text)}</div>
    <div class="segment-meta">
      <span>⏱ 时长 ${segment.duration.toFixed(1)}s</span>
      <span>📊 置信度 ${confPct}%</span>
      <span>#${segment.id.toString().slice(-6)}</span>
    </div>
  `;

  if (elements.segmentsList.firstChild) {
    elements.segmentsList.insertBefore(item, elements.segmentsList.firstChild);
  } else {
    elements.segmentsList.appendChild(item);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function clearSegments() {
  if (AppState.segments.length === 0) return;
  if (!confirm('确定要清空所有识别记录吗？')) return;

  AppState.segments = [];
  elements.segmentCount.textContent = '0';
  elements.segmentsList.innerHTML = `
    <div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
        <line x1="12" y1="19" x2="12" y2="23"></line>
        <line x1="8" y1="23" x2="16" y2="23"></line>
      </svg>
      <p>暂无识别记录</p>
      <p class="empty-hint">启动麦克风开始语音采集</p>
    </div>
  `;

  AppState.detections = [];
  AppState.confidenceSum = 0;
  AppState.totalDuration = 0;
  AppState.langCounts = { zh: 0, en: 0, ja: 0, ko: 0, fr: 0, de: 0 };
  updateStats();
  updateLangDistribution();
}

function updateStats() {
  elements.totalDetections.textContent = AppState.detections.length;
  elements.totalDuration.textContent = AppState.totalDuration.toFixed(1) + 's';
  elements.totalSegments.textContent = AppState.segments.length;

  const avg = AppState.detections.length > 0
    ? Math.round((AppState.confidenceSum / AppState.detections.length) * 100)
    : 0;
  elements.avgConfidence.textContent = avg + '%';
}

function updateLangDistribution() {
  const total = Object.values(AppState.langCounts).reduce((a, b) => a + b, 0);
  Object.keys(AppState.langCounts).forEach(code => {
    const count = AppState.langCounts[code];
    const pct = total > 0 ? (count / total) * 100 : 0;
    const fillEl = document.getElementById('langFill-' + code);
    const countEl = document.getElementById('langCount-' + code);
    if (fillEl) fillEl.style.width = pct.toFixed(1) + '%';
    if (countEl) countEl.textContent = count;
  });
}

function startVisualization() {
  const render = () => {
    if (!AppState.isRecording || !AppState.analyser) return;

    AppState.analyser.getByteTimeDomainData(AppState.timeData);
    AppState.analyser.getByteFrequencyData(AppState.frequencyData);

    const ctx = AppState.canvasCtx;
    const W = AppState.canvasWidth;
    const H = AppState.canvasHeight;

    ctx.clearRect(0, 0, W, H);
    drawGrid(ctx, W, H);

    switch (AppState.waveformView) {
      case 'waveform':
        drawWaveform(ctx, W, H);
        break;
      case 'spectrum':
        drawSpectrum(ctx, W, H);
        break;
      case 'circular':
        drawCircular(ctx, W, H);
        break;
    }

    AppState.animationId = requestAnimationFrame(render);
  };
  render();
}

function clearCanvas() {
  const ctx = AppState.canvasCtx;
  if (!ctx) return;
  ctx.clearRect(0, 0, AppState.canvasWidth, AppState.canvasHeight);
  drawGrid(ctx, AppState.canvasWidth, AppState.canvasHeight);
}

function drawGrid(ctx, W, H) {
  ctx.strokeStyle = 'rgba(59, 130, 246, 0.06)';
  ctx.lineWidth = 1;

  const rows = 6;
  const cols = 10;

  for (let i = 1; i < rows; i++) {
    const y = (H / rows) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  for (let i = 1; i < cols; i++) {
    const x = (W / cols) * i;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(59, 130, 246, 0.12)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, H / 2);
  ctx.lineTo(W, H / 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawWaveform(ctx, W, H) {
  const data = AppState.timeData;
  const len = data.length;

  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, '#3b82f6');
  grad.addColorStop(0.5, '#06b6d4');
  grad.addColorStop(1, '#10b981');

  ctx.beginPath();
  ctx.moveTo(0, H / 2);
  for (let i = 0; i < len; i++) {
    const x = (i / len) * W;
    const v = (data[i] - 128) / 128;
    const y = (H / 2) + (v * H * 0.4);
    if (i === 0) ctx.lineTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineTo(W, H / 2);

  ctx.fillStyle = 'rgba(59, 130, 246, 0.12)';
  ctx.fill();

  ctx.beginPath();
  for (let i = 0; i < len; i++) {
    const x = (i / len) * W;
    const v = (data[i] - 128) / 128;
    const y = (H / 2) + (v * H * 0.4);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2;
  ctx.stroke();

  let maxAmplitude = 0;
  for (let i = 0; i < len; i++) {
    const v = Math.abs((data[i] - 128) / 128);
    if (v > maxAmplitude) maxAmplitude = v;
  }

  const centerGlow = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, 40);
  centerGlow.addColorStop(0, `rgba(6, 182, 212, ${0.3 * maxAmplitude})`);
  centerGlow.addColorStop(1, 'transparent');
  ctx.fillStyle = centerGlow;
  ctx.fillRect(0, 0, W, H);
}

function drawSpectrum(ctx, W, H) {
  const data = AppState.frequencyData;
  const bins = 128;
  const step = Math.floor(data.length / bins);
  const barWidth = (W / bins) - 2;

  for (let i = 0; i < bins; i++) {
    const value = data[i * step] / 255;
    const barHeight = value * H * 0.9;
    const x = (i * (barWidth + 2)) + 1;
    const y = H - barHeight;

    const ratio = i / bins;
    const grad = ctx.createLinearGradient(0, y, 0, H);

    if (ratio < 0.33) {
      grad.addColorStop(0, '#10b981');
      grad.addColorStop(1, '#06b6d4');
    } else if (ratio < 0.66) {
      grad.addColorStop(0, '#06b6d4');
      grad.addColorStop(1, '#3b82f6');
    } else {
      grad.addColorStop(0, '#8b5cf6');
      grad.addColorStop(1, '#ec4899');
    }

    const radius = Math.min(barWidth / 2, 4);
    roundRect(ctx, x, y, barWidth, barHeight, radius);
    ctx.fillStyle = grad;
    ctx.fill();

    const glow = ctx.createRadialGradient(x + barWidth / 2, y + 5, 0, x + barWidth / 2, y + 5, 15);
    glow.addColorStop(0, `rgba(6, 182, 212, ${value * 0.5})`);
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.fillRect(x - 10, y - 10, barWidth + 20, 30);
  }
}

function drawCircular(ctx, W, H) {
  const cx = W / 2;
  const cy = H / 2;
  const baseRadius = Math.min(W, H) * 0.25;
  const data = AppState.frequencyData;
  const bars = 180;
  const step = Math.floor(data.length / bars);

  for (let i = 0; i < bars; i++) {
    const value = data[i * step] / 255;
    const barLen = value * baseRadius * 1.5;
    const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;

    const x1 = cx + Math.cos(angle) * baseRadius;
    const y1 = cy + Math.sin(angle) * baseRadius;
    const x2 = cx + Math.cos(angle) * (baseRadius + barLen);
    const y2 = cy + Math.sin(angle) * (baseRadius + barLen);

    const ratio = i / bars;
    const hue = ratio * 360;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = `hsla(${hue}, 80%, 60%, ${0.3 + value * 0.7})`;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  const innerGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseRadius * 0.8);
  innerGrad.addColorStop(0, 'rgba(59, 130, 246, 0.25)');
  innerGrad.addColorStop(0.5, 'rgba(6, 182, 212, 0.1)');
  innerGrad.addColorStop(1, 'transparent');
  ctx.beginPath();
  ctx.arc(cx, cy, baseRadius * 0.9, 0, Math.PI * 2);
  ctx.fillStyle = innerGrad;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, baseRadius - 2, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(59, 130, 246, 0.4)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  let avgVol = 0;
  for (let i = 0; i < data.length; i++) avgVol += data[i];
  avgVol /= data.length * 255;

  const pulseRadius = baseRadius * 0.3 + avgVol * baseRadius * 0.4;
  const pulseGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulseRadius);
  pulseGrad.addColorStop(0, `rgba(6, 182, 212, ${0.4 + avgVol * 0.4})`);
  pulseGrad.addColorStop(1, 'transparent');
  ctx.beginPath();
  ctx.arc(cx, cy, pulseRadius, 0, Math.PI * 2);
  ctx.fillStyle = pulseGrad;
  ctx.fill();
}

function roundRect(ctx, x, y, w, h, r) {
  if (h < 0) { h = 0; y = y + h; }
  if (h < r * 2) r = h / 2;
  if (w < r * 2) r = w / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

document.addEventListener('DOMContentLoaded', init);

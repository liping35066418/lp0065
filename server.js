const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');

const VOICE_SERVICE_PORT = 8755;
const FRONTEND_PORT = 3755;

const LANGUAGES = {
  zh: { name: '中文', code: 'zh', accents: ['普通话', '粤语', '川普', '东北话', '上海话'] },
  en: { name: 'English', code: 'en', accents: ['美式', '英式', '澳式', '印度式', '日式'] },
  ja: { name: '日本語', code: 'ja', accents: ['标准语', '关西腔', '九州腔', '北海道腔'] },
  ko: { name: '한국어', code: 'ko', accents: ['标准语', '庆尚道', '全罗道', '济州岛'] },
  fr: { name: 'Français', code: 'fr', accents: ['巴黎音', '魁北克', '比利时', '瑞士'] },
  de: { name: 'Deutsch', code: 'de', accents: ['高地德语', '低地德语', '巴伐利亚', '奥地利'] }
};

const LANGUAGE_POOL = Object.keys(LANGUAGES);

function stableHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return (hash >>> 0) / 0xffffffff;
}

function featureSeed(features) {
  const key = `${features.rms.toFixed(6)}|${features.zcr.toFixed(6)}|${features.energy.toFixed(6)}|${features.peak.toFixed(6)}|${features.centroid.toFixed(6)}`;
  return stableHash(key);
}

function pickIndex(seed, length) {
  return Math.floor(seed * length) % length;
}

function generateConfidence(features, base = 0.7) {
  const clarity = Math.min(1, (features.rms * 5 + features.peak * 2) / 3);
  const variation = features.zcr * 0.15;
  return Math.min(0.99, Math.max(0.3, base + clarity * 0.2 - variation));
}

function detectLanguage(audioFeatures, currentMode) {
  const seed = featureSeed(audioFeatures);

  if (currentMode && currentMode !== 'auto') {
    const lang = LANGUAGES[currentMode];
    if (lang) {
      const accentIdx = pickIndex(seed * 7.3, lang.accents.length);
      return {
        language: lang.code,
        languageName: lang.name,
        accent: lang.accents[accentIdx],
        confidence: generateConfidence(audioFeatures, 0.85)
      };
    }
  }

  const zcrScore = audioFeatures.zcr;
  const rmsScore = audioFeatures.rms;
  const centroidScore = audioFeatures.centroid;

  const langScores = {
    zh: 0.5 + zcrScore * 1.5 + (centroidScore > 0.4 ? 0.15 : 0),
    en: 0.45 + rmsScore * 1.2 + (centroidScore > 0.35 && centroidScore < 0.55 ? 0.15 : 0),
    ja: 0.55 + zcrScore * 1.2 + (centroidScore > 0.45 ? 0.1 : 0),
    ko: 0.48 + zcrScore * 1.3 + (centroidScore > 0.38 ? 0.12 : 0),
    fr: 0.42 + rmsScore * 0.9 + (centroidScore < 0.45 ? 0.15 : 0),
    de: 0.4 + rmsScore * 1.0 + (centroidScore < 0.4 ? 0.18 : 0)
  };

  const hashBoost = seed * 0.1;
  Object.keys(langScores).forEach(k => { langScores[k] += hashBoost * stableHash(k); });

  const sorted = Object.entries(langScores).sort((a, b) => b[1] - a[1]);
  const langCode = sorted[0][0];
  const lang = LANGUAGES[langCode];
  const accentIdx = pickIndex(seed * 3.7 + langScores[langCode], lang.accents.length);

  return {
    language: langCode,
    languageName: lang.name,
    accent: lang.accents[accentIdx],
    confidence: generateConfidence(audioFeatures, 0.6 + sorted[0][1] * 0.15)
  };
}

function generateSegmentText(language, features) {
  const samples = {
    zh: ['你好，很高兴认识你', '今天天气真不错', '语音识别技术很有趣', '人工智能正在改变世界', '学习是一种终身习惯'],
    en: ['Hello, nice to meet you', 'The weather is lovely today', 'Speech recognition is amazing', 'AI is changing the world', 'Learning is a lifelong habit'],
    ja: ['こんにちは、はじめまして', '今日はいい天気ですね', '音声認識は面白い', 'AIは世界を変える', '学ぶことは一生の習慣'],
    ko: ['안녕하세요, 반갑습니다', '오늘 날씨가 참 좋아요', '음성인식은 정말 흥미로워요', 'AI가 세상을 바꾸고 있어요', '배움은 평생의 습관입니다'],
    fr: ['Bonjour, enchanté', 'Il fait beau aujourdhui', 'La reconnaissance vocale est fascinante', 'IA change le monde', 'Apprendre est une habitude'],
    de: ['Hallo, freut mich', 'Das Wetter ist heute schön', 'Spracherkennung ist faszinierend', 'KI verändert die Welt', 'Lernen ist eine lebenslange Gewohnheit']
  };
  const pool = samples[language] || samples.en;
  const seed = featureSeed(features);
  const idx = pickIndex(seed * 11.3 + stableHash(language), pool.length);
  return pool[idx];
}

const voiceApp = express();
voiceApp.use(cors());
voiceApp.use(express.json());

voiceApp.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'voice-analysis', port: VOICE_SERVICE_PORT });
});

voiceApp.get('/languages', (req, res) => {
  res.json(LANGUAGES);
});

const voiceServer = http.createServer(voiceApp);
const wss = new WebSocket.Server({ server: voiceServer });

const clients = new Map();

wss.on('connection', (ws, req) => {
  const clientId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  console.log(`[VoiceWS] Client connected: ${clientId}`);

  clients.set(clientId, {
    ws,
    audioBuffer: [],
    lastDetection: null,
    detectionCount: 0,
    segmentBuffer: [],
    currentMode: 'auto'
  });

  ws.send(JSON.stringify({
    type: 'connected',
    clientId,
    timestamp: Date.now(),
    languages: LANGUAGES
  }));

  ws.on('message', (message) => {
    const client = clients.get(clientId);
    if (!client) return;

    try {
      const data = JSON.parse(message.toString());

      if (data.type === 'set_mode') {
        client.currentMode = data.mode || 'auto';
        client.detectionCount = 0;
        client.segmentBuffer = [];
        client.lastDetection = null;
        client.lastDetectAt = 0;
        client.lastSegmentAt = 0;
        ws.send(JSON.stringify({
          type: 'mode_changed',
          mode: client.currentMode,
          timestamp: Date.now()
        }));
        return;
      }

      if (data.type === 'audio_chunk') {
        const audioData = data.audioData || [];
        const features = extractAudioFeatures(audioData);

        client.audioBuffer.push({
          data: audioData,
          features,
          timestamp: Date.now()
        });

        if (client.audioBuffer.length > 100) {
          client.audioBuffer.shift();
        }

        const hasVoice = features.rms > 0.02 && features.peak > 0.1;
        const detectionCooldown = 300;
        const now = Date.now();
        const lastDetectAt = client.lastDetectAt || 0;
        const canDetect = now - lastDetectAt > detectionCooldown;

        if (hasVoice && canDetect) {
          const result = detectLanguage(features, client.currentMode);
          client.lastDetection = result;
          client.lastDetectAt = now;
          client.detectionCount++;

          ws.send(JSON.stringify({
            type: 'detection',
            ...result,
            timestamp: Date.now(),
            detectionId: client.detectionCount
          }));

          const segmentCooldown = 1500;
          const lastSegmentAt = client.lastSegmentAt || 0;
          const canSegment = now - lastSegmentAt > segmentCooldown;
          const strongVoice = features.rms > 0.06 && features.energy > 0.04;

          if (canSegment && strongVoice) {
            const segmentText = generateSegmentText(result.language, features);
            const durationBase = Math.min(5, Math.max(0.8, features.rms * 20 + features.energy * 10));
            const segment = {
              id: Date.now(),
              text: segmentText,
              language: result.language,
              languageName: result.languageName,
              accent: result.accent,
              confidence: result.confidence,
              duration: durationBase,
              timestamp: Date.now()
            };
            client.segmentBuffer.push(segment);
            client.lastSegmentAt = now;

            ws.send(JSON.stringify({
              type: 'segment',
              ...segment
            }));
          }
        }

        ws.send(JSON.stringify({
          type: 'audio_ack',
          chunkId: data.chunkId,
          features,
          timestamp: Date.now()
        }));
      }
    } catch (err) {
      console.error('[VoiceWS] Parse error:', err.message);
    }
  });

  ws.on('close', () => {
    console.log(`[VoiceWS] Client disconnected: ${clientId}`);
    clients.delete(clientId);
  });

  ws.on('error', (err) => {
    console.error(`[VoiceWS] Client error ${clientId}:`, err.message);
    clients.delete(clientId);
  });
});

function extractAudioFeatures(audioData) {
  if (!audioData || audioData.length === 0) {
    return { rms: 0, peak: 0, energy: 0, zcr: 0, centroid: 0 };
  }
  let sum = 0;
  let peak = 0;
  let energy = 0;
  let zcr = 0;
  let prevSample = 0;
  let weightedSum = 0;
  let freqWeight = 0;

  for (let i = 0; i < audioData.length; i++) {
    const sample = audioData[i];
    sum += sample * sample;
    energy += Math.abs(sample);
    if (Math.abs(sample) > peak) peak = Math.abs(sample);
    if ((prevSample >= 0 && sample < 0) || (prevSample < 0 && sample >= 0)) {
      zcr++;
    }
    const normalizedIdx = i / audioData.length;
    weightedSum += Math.abs(sample) * normalizedIdx;
    freqWeight += Math.abs(sample);
    prevSample = sample;
  }

  const rms = Math.sqrt(sum / audioData.length);
  const rawCentroid = freqWeight > 0 ? weightedSum / freqWeight : 0.3;
  const zcrFactor = Math.min(1, zcr / audioData.length * 4);
  const centroid = Math.min(0.95, Math.max(0.05, rawCentroid * 0.6 + zcrFactor * 0.4));

  return {
    rms: rms,
    peak: peak,
    energy: energy / audioData.length,
    zcr: zcr / audioData.length,
    centroid: centroid
  };
}

voiceServer.listen(VOICE_SERVICE_PORT, () => {
  console.log(`✓ 语音解析服务运行中: http://localhost:${VOICE_SERVICE_PORT}`);
  console.log(`  WebSocket: ws://localhost:${VOICE_SERVICE_PORT}`);
});

// ===== 前端可视化服务 (3755端口) =====
const frontendApp = express();
frontendApp.use(cors());
frontendApp.use(express.static(path.join(__dirname, 'public')));

frontendApp.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'frontend', port: FRONTEND_PORT });
});

frontendApp.get('/config', (req, res) => {
  res.json({
    voiceServiceUrl: `ws://localhost:${VOICE_SERVICE_PORT}`,
    voiceServiceHttp: `http://localhost:${VOICE_SERVICE_PORT}`,
    languages: LANGUAGES
  });
});

frontendApp.listen(FRONTEND_PORT, () => {
  console.log(`✓ 可视化界面运行中: http://localhost:${FRONTEND_PORT}`);
  console.log(`═══════════════════════════════════════════════════════`);
  console.log(`  请打开浏览器访问: http://localhost:${FRONTEND_PORT}`);
  console.log(`═══════════════════════════════════════════════════════`);
});

process.on('SIGINT', () => {
  console.log('\n正在关闭服务...');
  voiceServer.close(() => process.exit(0));
});

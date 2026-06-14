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

function generateConfidence(base = 0.7) {
  return Math.min(0.99, Math.max(0.3, base + (Math.random() - 0.5) * 0.4));
}

function detectLanguage(audioFeatures, currentMode) {
  if (currentMode && currentMode !== 'auto') {
    const lang = LANGUAGES[currentMode];
    if (lang) {
      const accent = lang.accents[Math.floor(Math.random() * lang.accents.length)];
      return {
        language: lang.code,
        languageName: lang.name,
        accent: accent,
        confidence: generateConfidence(0.85)
      };
    }
  }
  const langCode = LANGUAGE_POOL[Math.floor(Math.random() * LANGUAGE_POOL.length)];
  const lang = LANGUAGES[langCode];
  const accent = lang.accents[Math.floor(Math.random() * lang.accents.length)];
  return {
    language: langCode,
    languageName: lang.name,
    accent: accent,
    confidence: generateConfidence(0.65)
  };
}

function generateSegmentText(language) {
  const samples = {
    zh: ['你好，很高兴认识你', '今天天气真不错', '语音识别技术很有趣', '人工智能正在改变世界', '学习是一种终身习惯'],
    en: ['Hello, nice to meet you', 'The weather is lovely today', 'Speech recognition is amazing', 'AI is changing the world', 'Learning is a lifelong habit'],
    ja: ['こんにちは、はじめまして', '今日はいい天気ですね', '音声認識は面白い', 'AIは世界を変える', '学ぶことは一生の習慣'],
    ko: ['안녕하세요, 반갑습니다', '오늘 날씨가 참 좋아요', '음성인식은 정말 흥미로워요', 'AI가 세상을 바꾸고 있어요', '배움은 평생의 습관입니다'],
    fr: ['Bonjour, enchanté', 'Il fait beau aujourdhui', 'La reconnaissance vocale est fascinante', 'IA change le monde', 'Apprendre est une habitude'],
    de: ['Hallo, freut mich', 'Das Wetter ist heute schön', 'Spracherkennung ist faszinierend', 'KI verändert die Welt', 'Lernen ist eine lebenslange Gewohnheit']
  };
  const pool = samples[language] || samples.en;
  return pool[Math.floor(Math.random() * pool.length)];
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

        if (Math.random() < 0.15) {
          const result = detectLanguage(features, client.currentMode);
          client.lastDetection = result;
          client.detectionCount++;

          ws.send(JSON.stringify({
            type: 'detection',
            ...result,
            timestamp: Date.now(),
            detectionId: client.detectionCount
          }));

          if (Math.random() < 0.08) {
            const segmentText = generateSegmentText(result.language);
            const segment = {
              id: Date.now(),
              text: segmentText,
              language: result.language,
              languageName: result.languageName,
              accent: result.accent,
              confidence: result.confidence,
              duration: 1 + Math.random() * 3,
              timestamp: Date.now()
            };
            client.segmentBuffer.push(segment);

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

  for (let i = 0; i < audioData.length; i++) {
    const sample = audioData[i];
    sum += sample * sample;
    energy += Math.abs(sample);
    if (Math.abs(sample) > peak) peak = Math.abs(sample);
    if ((prevSample >= 0 && sample < 0) || (prevSample < 0 && sample >= 0)) {
      zcr++;
    }
    prevSample = sample;
  }

  const rms = Math.sqrt(sum / audioData.length);
  return {
    rms: rms,
    peak: peak,
    energy: energy / audioData.length,
    zcr: zcr / audioData.length,
    centroid: Math.random() * 0.5 + 0.2
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

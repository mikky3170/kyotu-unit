// [稼働Ver 1.0.0 作業版 Rev.28] ミタマ設定整理・プリセットID一本化・独立性と高精度ロジック完全維持

/**
 * VOICEVOX 標準プリセット定義（10種・ミタマも他キャラと同等に統一）
 */
const VOICEVOX_DEFAULT_PRESETS = [
  { id: '3', name: 'ずんだもん（ノーマル）', speaker: 3, gender: 'female' },
  { id: '8', name: '春日部つむぎ（ノーマル）', speaker: 8, gender: 'female' },
  { id: '11', name: '玄野武宏（ノーマル）', speaker: 11, gender: 'male_low' },
  { id: '13', name: '青山龍星（ノーマル）', speaker: 13, gender: 'male_low' },
  { id: '12', name: '白上虎太郎（ノーマル）', speaker: 12, gender: 'male_low' },
  { id: '14', name: '冥鳴ひまり（ノーマル）', speaker: 14, gender: 'female' },
  { id: '29', name: 'No.7（ノーマル）', speaker: 29, gender: 'female' },
  { id: '23', name: 'WhiteCUL（ノーマル）', speaker: 23, gender: 'female' },
  { id: '46', name: 'SAYO（ノーマル）', speaker: 46, gender: 'female' },
  { id: '1000', name: '暁記ミタマ（ノーマル）', speaker: 1000, gender: 'female' }
];

/**
 * 内蔵英略語辞書（英語略語の読み仮名基本変換・大文字小文字自動判別）
 */
const BUILTIN_WORD_DICT = {
  'AI': 'エーアイ',
  'ChatGPT': 'チャットジーピーティー',
  'YouTube': 'ユーチューブ',
  'Twitter': 'ツイッター',
  'SNS': 'エスエヌエス',
  'URL': 'ユーアールエル',
  'PC': 'ピーシー',
  'API': 'エーピーアイ',
  'Web': 'ウェブ'
};

/**
 * 設定管理クラス（LocalStorage 永続化 ＆ 過去キー救済マージ）
 */
class VoiceSuiteConfig {
  constructor() {
    this.STORAGE_KEY = 'voice_suite_system_config_v1';
    this.data = {
      geminiApiKey: '',
      voicevoxUrl: 'http://127.0.0.1:50021',
      voicevoxApiKey: '',
      voicevoxTimeout: 10000,
      customDict: {}
    };
    this.load();
  }

  load() {
    try {
      let saved = localStorage.getItem(this.STORAGE_KEY);
      if (!saved) {
        saved = localStorage.getItem('voice_suite_system_config_v100');
      }

      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.voicevoxUrl && parsed.voicevoxUrl.includes('localhost')) {
          parsed.voicevoxUrl = parsed.voicevoxUrl.replace('localhost', '127.0.0.1');
        }
        if (parsed.voicevoxTimeout && parsed.voicevoxTimeout < 5000) {
          parsed.voicevoxTimeout = 10000;
        }
        delete parsed.mitamaSpeakerId; // プリセット統合により不要キーを安全に除去
        this.data = { ...this.data, ...parsed };
        this.save(this.data);
      }
    } catch (e) {
      console.warn('[VoiceSuiteConfig] 設定ロード失敗:', e);
    }
  }

  save(newData) {
    this.data = { ...this.data, ...newData };
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.data));
    } catch (e) {
      console.error('[VoiceSuiteConfig] 設定保存失敗:', e);
    }
  }

  get(key) {
    return this.data[key];
  }
}

/**
 * トースト通知マネージャー
 */
class VoiceSuiteToast {
  static show(message, type = 'info', duration = 4000) {
    let container = document.getElementById('vsToastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'vsToastContainer';
      container.className = 'vs-toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `vs-toast vs-toast-${type}`;

    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'warning') icon = '⚠️';
    if (type === 'error') icon = '❌';

    const iconSpan = document.createElement('span');
    iconSpan.textContent = icon;
    const msgSpan = document.createElement('span');
    msgSpan.textContent = message;
    toast.appendChild(iconSpan);
    toast.appendChild(msgSpan);
    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, duration);
  }
}

/**
 * ========================================================
 * 音声入力＆AI自動整形モジュール（完全独立・自己完結クラス）
 * ========================================================
 */
class VoiceInputModule {
  constructor(config, options = {}) {
    this.config = config;
    this.isRecording = false;
    this.isRecognizing = false;
    this.currentMode = 'A'; // 'A': 原文忠実, 'B': AI Studioスマート
    this.sessionId = 0;

    this.recognition = null;
    this.audioContext = null;
    this.analyser = null;
    this.mediaStream = null;
    this.animFrameId = null;

    this.smoothedVolume = 0.0;
    this.barsContainer = options.barsContainer || null;
    this.neonBars = [];

    if (this.barsContainer) {
      this.neonBars = Array.from(this.barsContainer.querySelectorAll('.vs-input-dot-bar'));
    }

    this.onStateChange = options.onStateChange || (() => {});
    this.onInterimResult = options.onInterimResult || (() => {});
    this.onResult = options.onResult || (() => {});
    this.onError = options.onError || (() => {});
    this.onTick = options.onTick || (() => {});
    this.onAiStatusChange = options.onAiStatusChange || (() => {});
    this.getTextAreaElement = options.getTextAreaElement || (() => null);

    this.finalTranscript = '';
    this.interimTranscript = '';
    this.watchdogTimer = null;

    this.recordingStartTime = 0;
    this.recordingTimer = null;

    this.prefixText = '';
    this.suffixText = '';

    this.initSpeechRecognition();
    this.startBarAnimationLoop();
  }

  notifyToast(message, type = 'info', duration = 4000) {
    if (typeof VoiceSuiteToast !== 'undefined') {
      VoiceSuiteToast.show(message, type, duration);
    } else {
      console.log(`[VoiceInputModule:${type}] ${message}`);
    }
  }

  invalidatePendingFormatting() {
    this.sessionId++;
  }

  setMode(mode) {
    this.currentMode = mode === 'B' ? 'B' : 'A';
    const modeLabel = this.currentMode === 'A'
      ? '【A】原文忠実モード（発言・口調・ニュアンス完全保持）'
      : '【B】AI Studioスマート（複文分割・重複排除・知的ドキュメント風）';
    this.onAiStatusChange({
      type: 'info',
      message: `🎯 モード切替: ${modeLabel}`
    });
  }

  initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('[VoiceInputModule] SpeechRecognition 非対応');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.lang = 'ja-JP';
    this.recognition.interimResults = true;
    this.recognition.continuous = true;

    this.recognition.onstart = () => {
      this.isRecognizing = true;
    };

    this.recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          this.finalTranscript += transcript;
        } else {
          interim += transcript;
        }
      }
      this.interimTranscript = interim;

      const currentSpeech = this.finalTranscript + (interim ? ' ' + interim : '');
      this.onInterimResult(currentSpeech, this.prefixText, this.suffixText);
    };

    this.recognition.onerror = (event) => {
      console.warn('[VoiceInputModule] 音声認識イベント:', event.error);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.isRecognizing = false;
        this.onError('マイクへのアクセスが拒否されました。ブラウザの設定をご確認ください。');
        this.stop();
      } else if (event.error === 'aborted' || event.error === 'audio-capture' || event.error === 'network') {
        this.isRecognizing = false;
      }
    };

    this.recognition.onend = () => {
      this.isRecognizing = false;
      if (this.isRecording) {
        try {
          this.recognition.start();
        } catch (e) {}
      }
    };
  }

  startWatchdog() {
    this.stopWatchdog();
    this.watchdogTimer = setInterval(() => {
      if (this.isRecording && !this.isRecognizing && this.recognition) {
        try {
          this.recognition.start();
        } catch (e) {}
      }
    }, 1500);
  }

  stopWatchdog() {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  startTimer() {
    this.stopTimer();
    this.recordingStartTime = Date.now();
    this.recordingTimer = setInterval(() => {
      if (this.isRecording) {
        const elapsedSec = Math.floor((Date.now() - this.recordingStartTime) / 1000);
        const mins = Math.floor(elapsedSec / 60);
        const secs = elapsedSec % 60;
        const timeStr = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
        this.onTick(timeStr);
      }
    }, 1000);
    this.onTick('0:00');
  }

  stopTimer() {
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = null;
    }
  }

  async start() {
    if (this.isRecording) return;

    if (!this.recognition) {
      this.onError('お使いのブラウザは音声認識（Web Speech API）に対応していません。Chrome / Edge 等をご利用ください。');
      return;
    }

    this.sessionId++;
    this.finalTranscript = '';
    this.interimTranscript = '';

    const textArea = this.getTextAreaElement();
    if (textArea) {
      const val = textArea.value || '';
      const start = textArea.selectionStart !== null ? textArea.selectionStart : val.length;
      const end = textArea.selectionEnd !== null ? textArea.selectionEnd : val.length;
      this.prefixText = val.substring(0, start);
      this.suffixText = val.substring(end);
    } else {
      this.prefixText = '';
      this.suffixText = '';
    }

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await this.connectMicrophoneStream(this.mediaStream);

      this.isRecording = true;
      try {
        this.recognition.start();
      } catch (e) {}
      this.startWatchdog();
      this.startTimer();
      this.onStateChange(true);
    } catch (err) {
      console.error('[VoiceInputModule] マイク起動エラー:', err);
      this.onError('マイクへのアクセスが拒否されたか、デバイスが存在しません。');
      this.stop();
    }
  }

  async stop() {
    if (!this.isRecording) return;
    this.isRecording = false;
    this.isRecognizing = false;
    this.stopWatchdog();
    this.stopTimer();
    this.onStateChange(false);

    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {}
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        await this.audioContext.close();
      } catch (e) {}
      this.audioContext = null;
      this.analyser = null;
    }

    const rawPiece = (this.finalTranscript + (this.interimTranscript ? ' ' + this.interimTranscript : '')).trim();
    this.interimTranscript = '';

    if (!rawPiece) return;

    const currentSession = this.sessionId;
    const savedPrefix = this.prefixText;
    const savedSuffix = this.suffixText;

    this.onResult(rawPiece, false, savedPrefix, savedSuffix);
    await this.formatWithGemini(rawPiece, this.currentMode, currentSession, savedPrefix, savedSuffix);
  }

  async connectMicrophoneStream(stream) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioCtx();
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.25;
      source.connect(this.analyser);
    } catch (e) {
      console.warn('[VoiceInputModule] マイクストリーム接続エラー:', e);
    }
  }

  startBarAnimationLoop() {
    if (this.neonBars.length === 0) return;
    const barWeights = [0.45, 0.85, 1.0, 0.95, 0.8, 0.42];

    const updateBars = () => {
      this.animFrameId = requestAnimationFrame(updateBars);

      let instantVolume = 0;
      if (this.isRecording && this.analyser) {
        const timeData = new Uint8Array(this.analyser.fftSize);
        this.analyser.getByteTimeDomainData(timeData);

        let sumSquares = 0;
        for (let i = 0; i < timeData.length; i++) {
          const norm = (timeData[i] - 128) / 128.0;
          sumSquares += norm * norm;
        }
        const rms = Math.sqrt(sumSquares / timeData.length);
        instantVolume = Math.min(1.0, rms * 8.0);
      }

      this.smoothedVolume += (instantVolume - this.smoothedVolume) * 0.32;

      for (let i = 0; i < this.neonBars.length; i++) {
        const bar = this.neonBars[i];
        const weight = barWeights[i] || 0.6;
        const minH = 6;
        const maxH = 24;
        const currentH = minH + (maxH - minH) * this.smoothedVolume * weight;
        bar.style.height = `${currentH.toFixed(1)}px`;
        bar.style.borderRadius = currentH <= 7 ? '50%' : '9999px';
      }
    };

    updateBars();
  }

  destroy() {
    this.invalidatePendingFormatting();
    this.stop();
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  async formatWithGemini(rawPiece, mode = 'A', expectedSessionId = this.sessionId, savedPrefix = this.prefixText, savedSuffix = this.suffixText) {
    const apiKey = this.config.get('geminiApiKey');
    const modeLabel = mode === 'A' ? 'パターンA (原文忠実)' : 'パターンB (AI Studioスマート)';

    if (!apiKey) {
      if (this.sessionId !== expectedSessionId) return;
      this.onAiStatusChange({
        type: 'warning',
        message: '⚠️ Gemini APIキーが未設定です。右上の⚙️設定から登録してください（生テキストを維持）'
      });
      this.notifyToast('⚠️ Gemini APIキーが未設定です。右上の⚙️設定から登録してください。', 'warning', 6000);
      this.onResult(rawPiece, false, savedPrefix, savedSuffix);
      return;
    }

    this.onAiStatusChange({
      type: 'processing',
      message: `✨ AIが文章の体裁・接続詞改行を整えています...（${modeLabel}）`
    });

    let systemPrompt = '';

    if (mode === 'A') {
      systemPrompt = `あなたは音声認識テキストの整形を行う専門アシスタントです。
ユーザーが話したテキストを【パターンA：原文忠実モード】として整形してください。

【パターンAの最重要ポリシー（語り口・口調の100%保持）】
・話者の選んだ語彙、語尾（「〜だと思う」「〜なんですけどね」等）、話し言葉のニュアンス、熱量を【一切書き換えてはなりません】。
・文を勝手に分割したり、ビジネス敬語へ言い換えたり、重複表現を要約して削ったりすることは【厳禁】です。
・行う作業は「言い淀みフィラーの除去」「句読点（、。）の補正」「接続詞での単一改行」の3点のみです。

【整形ルール】
1. 言い淀み（「えーと」「あのー」「まあ」「その」など単なる発話のつっかえ）のみを削除してください。
   ※ただし「『えーと』という言葉」「あの、というフィラー」のように単語自体に言及している場合は絶対に保持してください。
2. 句読点（、。）を文脈に合わせて自然に補ってください。
3. 「まず」「次に」「また」「そして」「さらに」「一方で」「それから」「最後に」などの接続詞や、話題の大きな切り替わりごとに改行を入れてください。
   ※空行（2連続改行）は絶対に作らず、改行1回（単一改行）としてください。
4. 話し言葉の語尾や長い文構造はそのまま維持してください。

【変換例（パターンA）】
入力: えーとですね明日の午後からのミーティングなんですけれどもちょっと資料の準備が間に合わない可能性がありましてそれで時間を1時間ほど遅らせていただくことは可能でしょうかよろしくお願いいたします
出力:
明日の午後からのミーティングなんですけれども、ちょっと資料の準備が間に合わない可能性がありまして、
それで時間を1時間ほど遅らせていただくことは可能でしょうか。
よろしくお願いいたします。

出力は整形後の本文のみを返してください。解説や挨拶は一切含めないでください。`;
    } else {
      systemPrompt = `あなたは音声認識テキストを最高品質の知的な日本語ドキュメントへ昇華させる専門エディターです。
ユーザーが話したテキストを【パターンB：AI Studio / Typeless風スマートモード】として整形してください。

【パターンBの最重要ポリシー（複文分割・重複排除・知的ドキュメント化）】
・話者の「意図・意味・伝達情報」は100%完全に保持したまま、口語特有のダラダラと続く長い文を、意味のまとまりごとに適切な「。」でスパッと【複数の引き締まった文に分割】してください。
・同じ意味の堂々巡りや重複表現（「〜かなと思っててそれで〜と思ったり」等）を削ぎ落とし、すっきりとした知的な表現に統合してください。
・ビジネスチャット、Slack、メール、議事録、報告書にそのままコピー＆ペーストして使えるスマートな文体に仕立て上げてください。

【整形ルール】
1. 複文の分割: 「〜ですが、〜だったので、〜ですけど」と数珠繋ぎになっている文は、意味の切れ目で「。」を打ち、独立した読みやすい短文に分割してください。
2. 重複表現の完全整理: 無駄な言い回しの重複を排除し、的確な述語にまとめてください。
3. フィラー（えーと、あの等）の完全除去。
4. 話題の区切りや接続詞で単一改行（改行1回）を入れて視認性を高めてください。空行（2連続改行）は禁止です。
5. 必要な情報や具体的な条件・ニュアンスは勝手に削減（過度な箇条書き要約）せず、文章として美しく整えてください。

【変換例（パターンB）】
入力: えーとですね明日の午後からのミーティングなんですけれどもちょっと資料の準備が間に合わない可能性がありましてそれで時間を1時間ほど遅らせていただくことは可能でしょうかよろしくお願いいたします
出力:
明日の午後からのミーティングについてご相談です。
資料の準備に遅れが生じる可能性があるため、開始時間を1時間遅らせていただくことは可能でしょうか。
ご検討のほど、よろしくお願いいたします。

出力は整形後の本文のみを返してください。解説や挨拶は一切含めないでください。`;
    }

    const models = ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest'];
    let formattedResult = null;

    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [{ text: `${systemPrompt}\n\n対象テキスト:\n${rawPiece}` }]
              }
            ],
            generationConfig: {
              temperature: 0.15
            }
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP Error ${response.status}`);
        }

        const data = await response.json();
        const candidate = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (candidate) {
          formattedResult = candidate.trim();
          break;
        }
      } catch (err) {
        console.warn(`[VoiceInputModule] ${model} 整形失敗:`, err);
      }
    }

    if (this.sessionId !== expectedSessionId) {
      return;
    }

    if (formattedResult) {
      this.onAiStatusChange({
        type: 'success',
        message: `✅ AI整形が完了しました（${modeLabel}）`
      });
      this.onResult(formattedResult, true, savedPrefix, savedSuffix);
    } else {
      this.onAiStatusChange({
        type: 'error',
        message: '❌ AI整形エラー（通信失敗のため聞き取り生テキストを維持）'
      });
      this.notifyToast('AI整形に失敗したため、聞き取り生テキストを維持します。', 'warning');
      this.onResult(rawPiece, false, savedPrefix, savedSuffix);
    }
  }
}

/**
 * ========================================================
 * 音声合成＆先読み逐次再生モジュール（完全独立・自己完結クラス）
 * ========================================================
 */
class VoiceSynthModule {
  constructor(config, options = {}) {
    this.config = config;

    this.isPlaying = false;
    this.isPaused = false;
    this.abortController = null;
    this.currentAudio = null;
    this.currentAudioUrl = null;
    this.currentUtterance = null;
    this.speedRate = 1.0;

    this.activeHighlightTimers = [];

    this.activeSentencePhrases = [];
    this.activeTotalChars = 0;
    this.activeTotalDurationMs = 0;
    this.activeCurrentPhraseIdx = 0;
    this.totalSynthPhrases = 0;

    // Web Speech 一時停止/再開用タイマー状態
    this.webSpeechStartTime = 0;
    this.webSpeechElapsedMs = 0;

    this.onPlayStateChange = options.onPlayStateChange || (() => {});
    this.onProgress = options.onProgress || (() => {});
    this.onPhraseSpeaking = options.onPhraseSpeaking || (() => {});
  }

  notifyToast(message, type = 'info', duration = 4000) {
    if (typeof VoiceSuiteToast !== 'undefined') {
      VoiceSuiteToast.show(message, type, duration);
    } else {
      console.log(`[VoiceSynthModule:${type}] ${message}`);
    }
  }

  setSpeed(speed) {
    this.speedRate = Math.max(0.5, Math.min(2.0, parseFloat(speed) || 1.0));
  }

  clearHighlightTimers() {
    this.activeHighlightTimers.forEach((timer) => clearTimeout(timer));
    this.activeHighlightTimers = [];
  }

  revokeCurrentAudioUrl() {
    if (this.currentAudioUrl) {
      try {
        URL.revokeObjectURL(this.currentAudioUrl);
      } catch (e) {}
      this.currentAudioUrl = null;
    }
  }

  isDialogue(text) {
    if (!text) return false;
    return text.includes('「') || text.includes('」') || text.includes('『') || text.includes('』');
  }

  cleanAozoraRubyKeepKanji(rawText) {
    if (!rawText) return '';
    let text = rawText;
    text = text.replace(/［＃[^］]+］/g, '');
    text = text.replace(/〔[^〕]+〕/g, '');
    text = text.replace(/[｜|]?([^《\n\r]+)《[^》\n\r]+》/g, '$1');
    text = text.replace(/([一-龠々]+)[（\(][ぁ-んァ-ヶー]+[）\)]/g, '$1');
    return text;
  }

  splitTextIntoSentences(text) {
    if (!text) return [];
    const pattern = /[^。！？!?\n]+[。！？!?\n]*/g;
    const matches = text.match(pattern);
    if (!matches) {
      return [text.trim()];
    }
    return matches.map((s) => s.trim()).filter((s) => s.length > 0);
  }

  splitTextIntoPhrases(text) {
    if (!text) return [];
    const pattern = /[^、。，．！？!?\n]+[、。，．！？!?\n]*/g;
    const matches = text.match(pattern);
    if (!matches) {
      const trimmed = text.trim();
      return trimmed ? [trimmed] : [];
    }
    return matches.filter((s) => s.trim().length > 0);
  }

  getSpeakerPreset(voiceType) {
    const presets = (typeof VOICEVOX_DEFAULT_PRESETS !== 'undefined') ? VOICEVOX_DEFAULT_PRESETS : [];
    return presets.find((p) => p.id === voiceType) || null;
  }

  escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  replaceDictTerm(text, key, val, caseInsensitive = false) {
    if (!key) return text;
    const escaped = this.escapeRegExp(key);
    const flags = caseInsensitive ? 'gi' : 'g';
    if (/^[A-Za-z0-9]+$/.test(key)) {
      const regex = new RegExp(`(^|[^A-Za-z0-9])${escaped}(?=[^A-Za-z0-9]|$)`, flags);
      return text.replace(regex, `$1${val}`);
    }
    const regex = new RegExp(escaped, flags);
    return text.replace(regex, val);
  }

  buildVoicevoxHeaders() {
    const apiKey = this.config.get('voicevoxApiKey');
    const headers = {};
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
      headers['x-api-key'] = apiKey;
    }
    return headers;
  }

  /**
   * 5大文法カテゴリーに基づく網羅的・自律型文脈読み分けプレプロセッサ
   */
  async resolveContextualReadings(rawText) {
    const apiKey = this.config.get('geminiApiKey');
    let text = this.cleanAozoraRubyKeepKanji(rawText);

    const builtinDict = (typeof BUILTIN_WORD_DICT !== 'undefined') ? BUILTIN_WORD_DICT : {};
    for (const [key, val] of Object.entries(builtinDict)) {
      text = this.replaceDictTerm(text, key, val, true);
    }

    const customDict = this.config.get('customDict') || {};
    for (const [key, val] of Object.entries(customDict)) {
      if (key && val) {
        text = this.replaceDictTerm(text, key, val, false);
      }
    }

    if (!apiKey) {
      this.notifyToast('⚠️ Gemini APIキー未設定のため、文脈読み分けをスキップします。右上の⚙️設定から登録してください。', 'warning', 6000);
      return text;
    }

    const prompt = `あなたは極めて優秀な音声合成（VOICEVOX/OpenJTalk）専門の日本語言語学エンジンです。
入力された文章全体の文法構造、品詞、係り受け、文脈を解析し、VOICEVOXが一切誤読せず、自然で完璧な発音を行えるように、以下の【5大文法カテゴリー】に該当する箇所を適切な平仮名・正規化表記に補正したテキストを出力してください。

【5大文法カテゴリーによる網羅的補正ルール】

① 形式名詞・比況・様態（実質名詞との混同防止）
・直前に用言（動詞や形容詞の連体形など）を伴い、形式名詞・比況・様態として機能している漢字は、本来の実質名詞の読み（音読みや敬称）に引きずられないよう、例外なく【平仮名】に補正してください。
  ・「様」：比況・様態（「〜様になった」「〜様な」「〜様に」「来る様」「怖がっている様」等）➔ 必ず「よう」
  ・「方」：傾向・属性・比較（「見える方で」「若い方」「〜した方がいい」等）➔ 必ず「ほう」
  ・「所」「事」「時」「訳」「通り」：形式名詞（「思う所」「知る事」「困った時」「そんな訳」「指示の通り」等）➔ 必ず「ところ」「こと」「とき」「わけ」「とおり」

② 暦（カレンダー） vs 期間・数量（漢数字の正規化）
・「今年」「去年」「来年」「先月」「翌月」など、時期や暦月・暦日を表す文脈の漢数字は、期間（ふたつき、いちにち等）への誤読を防ぐため、【アラビア数字＋月日】または【確定した平仮名】に正規化してください。
  （例：「今年の二月頃」➔「今年の2月ごろ」、「三月一日」➔「3月1日」または「3月ついたち」）

③ 接尾辞・複合語の連濁（清音・濁音の自動補正）
・名詞や動詞連用形の後ろに付き、自然な朗読において濁音化（連濁）する接尾辞・副助詞は、辞書の見出し語（清音）での誤読を防ぐため、必ず濁音の【平仮名】に補正してください。
  （例：「〜頃」➔「ごろ」、「〜勝ち」➔「がち」、「〜振り」➔「ぶり」、「〜丈け」➔「だけ」、「〜気味」➔「ぎみ」）

④ 多音字・文脈依存語（日常語・訓読み優先）
・文脈により読みが分岐する多音字は、文脈に適した読み（平仮名）に補正してください。
  ・「金」：貨幣、給与、盗難金、金銭を指す文脈 ➔ 必ず「かね」（「きん」と読ませない。「大金」は「たいきん」）
  ・「次」：順序、次回来訪、次の日などを指す文脈 ➔ 必ず「つぎ」（「じ」と音読みさせない）
  ・「奴」：存在・人間を指す文脈（「無作法な奴」「あんな奴」等）➔ 必ず「やつ」

⑤ 近代文学・昭和文学の慣用漢字・当て字
・近代文学作品で多用される難訓・当て字は、現代日本語の自然な発音（平仮名）に統一してください。
  （例：「その儘」➔「そのまま」、「〜位で」➔「〜くらいで」、「〜と云う」➔「〜という」、「抛り出す」➔「ほうりだす」、「忍入る」➔「しのびいる」）

【制約事項（追従ハイライト同期のため絶対厳守）】
・句読点（、。，．！？）および改行の位置と数は原文から一切変更しないでください（新たに増やしたり削除したりしない）。
・通常の平易な漢字、文の構造、セリフ括弧「」はそのまま維持してください。
・要約や言い換えは一切禁止です。原文の表現・語順は変えずに発音のみを最適化してください。
・出力は、補正後のテキスト本文のみを出力してください。挨拶や解説は一切含めないでください。

対象テキスト:
${text}`;

    const models = ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest'];
    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1 }
          })
        });
        if (res.ok) {
          const data = await res.json();
          const candidate = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (candidate) {
            return candidate.trim();
          }
        }
      } catch (e) {
        console.warn(`[VoiceSynthModule] ${model} 汎用文脈読み分け解析スキップ:`, e);
      }
    }

    return text;
  }

  async speak(text, voiceType = '3') {
    this.stop();

    this.isPlaying = true;
    this.isPaused = false;
    this.abortController = new AbortController();
    this.onPlayStateChange(true, false);

    this.onProgress('文脈と発音を最適化中...');
    const speechReadyText = await this.resolveContextualReadings(text);
    if (this.abortController.signal.aborted) return;

    const sentences = this.splitTextIntoSentences(speechReadyText);
    if (sentences.length === 0) {
      this.stop();
      return;
    }

    this.totalSynthPhrases = sentences.reduce((sum, s) => sum + this.splitTextIntoPhrases(s).length, 0);

    if (voiceType === 'webspeech') {
      await this.speakWithWebSpeech(sentences);
    } else {
      const speakerPreset = this.getSpeakerPreset(voiceType);
      await this.speakWithVoicevoxSequentialPipeline(sentences, voiceType, speakerPreset);
    }
  }

  async speakWithVoicevoxSequentialPipeline(sentences, voiceType, speakerPreset) {
    const total = sentences.length;
    let completedSentences = 0;
    let fallbackTriggered = false;

    // 全話者共通のID解釈（ミタマも他キャラと同等に処理）
    const speakerId = parseInt(voiceType, 10);
    const speakerName = speakerPreset ? speakerPreset.name : `ID: ${speakerId}`;
    const isMaleLowVoice = speakerPreset && speakerPreset.gender === 'male_low';

    let currentPhraseIdx = 0;

    const fetchSingleSentence = async (rawSentence, index) => {
      if (fallbackTriggered || this.abortController.signal.aborted) return null;

      const sentence = rawSentence.replace(/[\r\n]+/g, '').trim();
      const phrases = this.splitTextIntoPhrases(rawSentence);
      if (!sentence) {
        return { index, blob: null, sentence: '', phrases };
      }

      const baseUrl = (this.config.get('voicevoxUrl') || 'http://127.0.0.1:50021').replace(/\/+$/, '');
      const timeoutMs = parseInt(this.config.get('voicevoxTimeout') || 10000, 10);
      const headers = this.buildVoicevoxHeaders();

      const controller = new AbortController();
      let isTimedOut = false;
      const timer = setTimeout(() => {
        isTimedOut = true;
        controller.abort();
      }, timeoutMs);

      try {
        const queryUrl = `${baseUrl}/audio_query?text=${encodeURIComponent(sentence)}&speaker=${speakerId}`;
        const queryRes = await fetch(queryUrl, {
          method: 'POST',
          headers,
          mode: 'cors',
          signal: controller.signal
        }).catch((err) => {
          if (isTimedOut) throw new Error(`VOICEVOX応答タイムアウト (${timeoutMs / 1000}秒超過)`);
          throw new Error(`VOICEVOX接続失敗 (${err.message})`);
        });

        if (!queryRes.ok) {
          throw new Error(`audio_query エラー: HTTP ${queryRes.status}`);
        }
        const queryJson = await queryRes.json();

        queryJson.speedScale = this.speedRate;
        queryJson.postPhonemeLength = 0.08;
        queryJson.prePhonemeLength = 0.0;

        const isDialogueSentence = this.isDialogue(sentence);
        if (isDialogueSentence) {
          queryJson.intonationScale = 1.18;
          queryJson.pitchScale = 0.0;
          queryJson.volumeScale = 1.05;
        } else {
          queryJson.intonationScale = 1.0;
          queryJson.pitchScale = 0.0;
        }

        if (isMaleLowVoice) {
          queryJson.volumeScale = (queryJson.volumeScale || 1.0) * 0.88;
        }

        const synthUrl = `${baseUrl}/synthesis?speaker=${speakerId}`;
        const synthRes = await fetch(synthUrl, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(queryJson),
          mode: 'cors',
          signal: controller.signal
        }).catch((err) => {
          if (isTimedOut) throw new Error(`VOICEVOX音声生成タイムアウト (${timeoutMs / 1000}秒超過)`);
          throw new Error(`synthesis接続失敗: ${err.message}`);
        });

        if (!synthRes.ok) {
          throw new Error(`synthesis エラー: HTTP ${synthRes.status}`);
        }

        const blob = await synthRes.blob();
        clearTimeout(timer);
        return { index, blob, sentence, phrases: phrases.length > 0 ? phrases : [sentence] };
      } catch (err) {
        clearTimeout(timer);
        throw err;
      }
    };

    const fetchPromises = new Array(total).fill(null);
    const ensureFetch = (idx) => {
      if (idx < total && !fetchPromises[idx] && !fallbackTriggered && !this.abortController.signal.aborted) {
        fetchPromises[idx] = fetchSingleSentence(sentences[idx], idx);
      }
    };

    try {
      this.onProgress(`[1/${total}] 音声を準備中...`);
      ensureFetch(0);
      if (total > 1) {
        ensureFetch(1);
      }

      for (let i = 0; i < total; i++) {
        if (this.abortController.signal.aborted) break;

        const currentResult = await fetchPromises[i];
        fetchPromises[i] = null;

        if (this.abortController.signal.aborted) break;

        if (i + 1 < total) ensureFetch(i + 1);
        if (i + 2 < total) ensureFetch(i + 2);

        if (!currentResult || !currentResult.blob) {
          if (currentResult && currentResult.phrases) {
            currentPhraseIdx += currentResult.phrases.length;
          }
          completedSentences = i + 1;
          continue;
        }

        const sentencePhrases = currentResult.phrases || [sentences[i]];
        const audioBlob = currentResult.blob;

        this.revokeCurrentAudioUrl();
        const audioUrl = URL.createObjectURL(audioBlob);
        this.currentAudioUrl = audioUrl;

        const audio = new Audio(audioUrl);
        audio.preload = 'auto';
        this.currentAudio = audio;

        await new Promise((resolveLoaded) => {
          audio.onloadedmetadata = () => resolveLoaded();
          audio.onerror = () => resolveLoaded();
          setTimeout(resolveLoaded, 200);
        });

        if (this.abortController.signal.aborted) {
          this.revokeCurrentAudioUrl();
          break;
        }

        const totalDurationSec = (audio.duration && !isNaN(audio.duration)) ? audio.duration : (audioBlob.size / 48000);
        const totalDurationMs = totalDurationSec * 1000;
        const totalChars = sentencePhrases.reduce((acc, p) => acc + Math.max(1, p.length), 0);

        this.activeSentencePhrases = sentencePhrases;
        this.activeTotalChars = totalChars;
        this.activeTotalDurationMs = totalDurationMs;
        this.activeCurrentPhraseIdx = currentPhraseIdx;

        this.schedulePhrasesHighlight(sentencePhrases, totalChars, totalDurationMs, currentPhraseIdx, 0);

        currentPhraseIdx += sentencePhrases.length;
        completedSentences = i + 1;
        this.onProgress(`[${completedSentences}/${total}] 再生中: ${speakerName}`);

        try {
          await audio.play();
        } catch (playErr) {
          if (this.abortController.signal.aborted) break;
          console.warn('[VoiceSynthModule] audio.play エラー:', playErr);
        }

        await this.waitForCurrentAudioEnd();
        this.revokeCurrentAudioUrl();

        if (this.abortController.signal.aborted) break;
      }

      this.stop();
    } catch (err) {
      console.warn('[VoiceSynthModule] VOICEVOX 失敗。Web Speech API にフォールバックします:', err);
      fallbackTriggered = true;
      this.revokeCurrentAudioUrl();

      const reasonMsg = err.message || '接続エラー';
      this.notifyToast(`VOICEVOXエラー: ${reasonMsg} → 標準音声で発話します`, 'warning', 6000);

      const remainingSentences = sentences.slice(completedSentences);
      if (remainingSentences.length > 0 && !this.abortController.signal.aborted) {
        await this.speakWithWebSpeech(remainingSentences, currentPhraseIdx);
      } else {
        this.stop();
      }
    }
  }

  schedulePhrasesHighlight(sentencePhrases, totalChars, totalDurationMs, basePhraseIdx, offsetMs = 0) {
    this.clearHighlightTimers();
    let cumulativeDelayMs = 0;

    sentencePhrases.forEach((phrase, pIdx) => {
      const phraseWeight = Math.max(1, phrase.length) / totalChars;
      const phraseDurationMs = totalDurationMs * phraseWeight;
      const phraseStartMs = cumulativeDelayMs;
      const phraseEndMs = phraseStartMs + phraseDurationMs;

      if (phraseEndMs > offsetMs) {
        const delayFromNow = Math.max(0, phraseStartMs - offsetMs);
        const targetGlobalIdx = basePhraseIdx + pIdx;

        const timer = setTimeout(() => {
          if (this.isPlaying && !this.isPaused && !this.abortController?.signal.aborted) {
            this.onPhraseSpeaking(targetGlobalIdx, this.totalSynthPhrases);
          }
        }, delayFromNow);

        this.activeHighlightTimers.push(timer);
      }

      cumulativeDelayMs += phraseDurationMs;
    });
  }

  waitForCurrentAudioEnd() {
    return new Promise((resolve) => {
      if (!this.currentAudio || this.currentAudio.ended) {
        return resolve();
      }
      if (this.currentAudio.paused && !this.isPaused) {
        return resolve();
      }
      this.currentAudio.onended = () => resolve();
      this.currentAudio.onerror = () => resolve();
    });
  }

  speakWithWebSpeech(sentences, startPhraseIdx = 0) {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) {
        this.notifyToast('このブラウザは Web Speech API に対応していません。', 'error');
        this.stop();
        return resolve();
      }

      window.speechSynthesis.cancel();
      let index = 0;
      const total = sentences.length;
      let phraseIdx = startPhraseIdx;

      const speakNext = () => {
        if (index >= total || this.abortController.signal.aborted) {
          this.stop();
          return resolve();
        }

        const sentence = sentences[index];
        const sentencePhrases = this.splitTextIntoPhrases(sentence);

        this.onProgress(`[${index + 1}/${total}] 標準音声 再生中`);

        this.currentUtterance = new SpeechSynthesisUtterance(sentence);
        this.currentUtterance.lang = 'ja-JP';
        this.currentUtterance.rate = this.speedRate;

        if (this.isDialogue(sentence)) {
          this.currentUtterance.pitch = 1.05;
        } else {
          this.currentUtterance.pitch = 1.0;
        }

        const voices = window.speechSynthesis.getVoices();
        const preferredVoice = voices.find(
          (v) => v.lang.includes('ja') && (v.name.includes('Natural') || v.name.includes('Nanami') || v.name.includes('Google'))
        ) || voices.find((v) => v.lang.includes('ja'));

        if (preferredVoice) {
          this.currentUtterance.voice = preferredVoice;
        }

        const totalSentenceChars = sentencePhrases.reduce((acc, p) => acc + Math.max(1, p.length), 0);
        const estimatedSentenceDurationMs = (totalSentenceChars * 210) / this.speedRate;

        this.activeSentencePhrases = sentencePhrases;
        this.activeTotalChars = totalSentenceChars;
        this.activeTotalDurationMs = estimatedSentenceDurationMs;
        this.activeCurrentPhraseIdx = phraseIdx;
        this.webSpeechElapsedMs = 0;
        this.webSpeechStartTime = Date.now();

        this.schedulePhrasesHighlight(sentencePhrases, totalSentenceChars, estimatedSentenceDurationMs, phraseIdx, 0);

        phraseIdx += sentencePhrases.length;

        this.currentUtterance.onend = () => {
          index++;
          speakNext();
        };

        this.currentUtterance.onerror = () => {
          index++;
          speakNext();
        };

        window.speechSynthesis.speak(this.currentUtterance);
      };

      speakNext();
    });
  }

  pause() {
    if (!this.isPlaying || this.isPaused) return;
    this.isPaused = true;
    this.clearHighlightTimers();

    if (this.currentAudio) {
      this.currentAudio.pause();
    }
    if ('speechSynthesis' in window && window.speechSynthesis.speaking) {
      this.webSpeechElapsedMs += Math.max(0, Date.now() - this.webSpeechStartTime);
      window.speechSynthesis.pause();
    }
    this.onPlayStateChange(false, true);
  }

  resume() {
    if (!this.isPlaying || !this.isPaused) return;
    this.isPaused = false;

    if (this.currentAudio) {
      const currentOffsetMs = (this.currentAudio.currentTime || 0) * 1000;
      if (this.activeSentencePhrases.length > 0) {
        this.schedulePhrasesHighlight(
          this.activeSentencePhrases,
          this.activeTotalChars,
          this.activeTotalDurationMs,
          this.activeCurrentPhraseIdx,
          currentOffsetMs
        );
      }
      this.currentAudio.play().catch(() => {});
    } else if ('speechSynthesis' in window && window.speechSynthesis.paused) {
      this.webSpeechStartTime = Date.now();
      if (this.activeSentencePhrases.length > 0) {
        this.schedulePhrasesHighlight(
          this.activeSentencePhrases,
          this.activeTotalChars,
          this.activeTotalDurationMs,
          this.activeCurrentPhraseIdx,
          this.webSpeechElapsedMs
        );
      }
      window.speechSynthesis.resume();
    }
    this.onPlayStateChange(true, false);
  }

  stop() {
    this.isPlaying = false;
    this.isPaused = false;
    this.clearHighlightTimers();

    this.activeSentencePhrases = [];
    this.activeTotalChars = 0;
    this.activeTotalDurationMs = 0;
    this.activeCurrentPhraseIdx = 0;
    this.totalSynthPhrases = 0;
    this.webSpeechStartTime = 0;
    this.webSpeechElapsedMs = 0;

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
      } catch (e) {}
      this.currentAudio = null;
    }
    this.revokeCurrentAudioUrl();

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.currentUtterance = null;

    this.onPlayStateChange(false, false);
    this.onPhraseSpeaking(-1, 0);
    this.onProgress('');
  }

  async testVoicevoxConnection() {
    const baseUrl = (this.config.get('voicevoxUrl') || 'http://127.0.0.1:50021').replace(/\/+$/, '');
    const headers = this.buildVoicevoxHeaders();

    try {
      const verRes = await fetch(`${baseUrl}/version`, {
        method: 'GET',
        headers,
        mode: 'cors'
      });
      if (!verRes.ok) throw new Error(`HTTP ${verRes.status}`);
      const ver = await verRes.json();

      const spkRes = await fetch(`${baseUrl}/speakers`, {
        method: 'GET',
        headers,
        mode: 'cors'
      });
      const spkList = spkRes.ok ? await spkRes.json() : [];

      return {
        success: true,
        version: ver,
        speakerCount: spkList.length,
        message: `接続成功！(VOICEVOX v${ver} / 利用可能キャラクター数: ${spkList.length})`
      };
    } catch (err) {
      return {
        success: false,
        message: `接続失敗: ${err.message}`
      };
    }
  }
}

/**
 * ========================================================
 * 統合ファサードクラス VoiceSuite（各独立モジュールの窓口）
 * ========================================================
 */
class VoiceSuite {
  constructor(options = {}) {
    this.config = new VoiceSuiteConfig();
    this.trackPhraseCount = 0;

    this.ui = {
      recordBtn: options.recordBtn || null,
      recordStatus: options.recordStatus || null,
      inputTextArea: options.inputTextArea || null,
      inputCharCounter: options.inputCharCounter || null,
      inputAiStatus: options.inputAiStatus || null,
      synthTextArea: options.synthTextArea || null,
      readTrackContainer: options.readTrackContainer || null,
      voiceSelect: options.voiceSelect || null,
      speedSlider: options.speedSlider || null,
      speedValText: options.speedValText || null,
      playBtn: options.playBtn || null,
      pauseBtn: options.pauseBtn || null,
      stopBtn: options.stopBtn || null,
      copyToSynthBtn: options.copyToSynthBtn || null,
      ttsStatusBadge: options.ttsStatusBadge || null,
      ttsStatusText: options.ttsStatusText || null,
      charCounter: options.charCounter || null,
      modeBtnA: options.modeBtnA || null,
      modeBtnB: options.modeBtnB || null
    };

    this.inputModule = new VoiceInputModule(this.config, {
      barsContainer: options.inputBarsContainer || null,
      getTextAreaElement: () => this.ui.inputTextArea,
      onStateChange: (active) => this.handleInputStateChange(active),
      onTick: (timeStr) => this.handleInputTick(timeStr),
      onAiStatusChange: (status) => this.handleInputAiStatusChange(status),
      onInterimResult: (piece, prefix, suffix) => this.handleInputInterim(piece, prefix, suffix),
      onResult: (piece, formatted, prefix, suffix) => this.handleInputResult(piece, formatted, prefix, suffix),
      onError: (msg) => VoiceSuiteToast.show(msg, 'error')
    });

    this.synthModule = new VoiceSynthModule(this.config, {
      onPlayStateChange: (playing, paused) => this.handleSynthStateChange(playing, paused),
      onProgress: (status) => this.handleSynthProgress(status),
      onPhraseSpeaking: (idx, totalPhrases) => this.handlePhraseSpeaking(idx, totalPhrases)
    });

    this.initVoiceSelectOptions();
    this.bindEvents();
    this.updateCharCounters();
    this.checkInitialApiKeys();
  }

  checkInitialApiKeys() {
    const geminiKey = this.config.get('geminiApiKey');
    if (this.ui.inputAiStatus) {
      if (!geminiKey) {
        this.ui.inputAiStatus.className = 'vs-input-ai-status warning';
        this.ui.inputAiStatus.textContent = '⚙️ Gemini APIキーが未設定です。右上の設定から登録してください。';
      } else if (this.ui.inputAiStatus.classList.contains('warning')) {
        this.ui.inputAiStatus.className = 'vs-input-ai-status';
        this.ui.inputAiStatus.textContent = '';
      }
    }
  }

  initVoiceSelectOptions() {
    if (!this.ui.voiceSelect) return;
    this.ui.voiceSelect.innerHTML = '';

    VOICEVOX_DEFAULT_PRESETS.forEach((preset) => {
      const opt = document.createElement('option');
      opt.value = preset.id;
      opt.textContent = `VOICEVOX: ${preset.name}`;
      this.ui.voiceSelect.appendChild(opt);
    });

    const standardOpt = document.createElement('option');
    standardOpt.value = 'webspeech';
    standardOpt.textContent = '⚡ ブラウザ標準音声（超高速バックアップ）';
    this.ui.voiceSelect.appendChild(standardOpt);
  }

  bindEvents() {
    if (this.ui.modeBtnA && this.ui.modeBtnB) {
      this.ui.modeBtnA.addEventListener('click', () => {
        this.inputModule.setMode('A');
        this.ui.modeBtnA.classList.add('active');
        this.ui.modeBtnB.classList.remove('active');
      });

      this.ui.modeBtnB.addEventListener('click', () => {
        this.inputModule.setMode('B');
        this.ui.modeBtnB.classList.add('active');
        this.ui.modeBtnA.classList.remove('active');
      });
    }

    if (this.ui.recordBtn) {
      this.ui.recordBtn.addEventListener('click', () => {
        if (this.inputModule.isRecording) {
          this.inputModule.stop();
        } else {
          this.inputModule.start();
        }
      });
    }

    if (this.ui.copyToSynthBtn && this.ui.inputTextArea && this.ui.synthTextArea) {
      this.ui.copyToSynthBtn.addEventListener('click', () => {
        const text = this.ui.inputTextArea.value;
        if (!text) {
          VoiceSuiteToast.show('転送するテキストがありません。', 'warning');
          return;
        }
        this.synthModule.stop();
        this.ui.synthTextArea.value = text;
        this.updateCharCounters();
        this.prepareTrackContainer(text);
        VoiceSuiteToast.show('読み上げエリアにテキストをコピーしました。', 'success');
      });
    }

    if (this.ui.speedSlider) {
      this.ui.speedSlider.addEventListener('input', (e) => {
        const speed = parseFloat(e.target.value);
        this.synthModule.setSpeed(speed);
        if (this.ui.speedValText) {
          let label = `${speed.toFixed(1)}x`;
          if (speed === 1.0) label += ' (標準)';
          else if (speed < 1.0) label += ' (ゆっくり)';
          else if (speed > 1.3) label += ' (高速)';
          else label += ' (速め)';
          this.ui.speedValText.textContent = label;
        }
      });
    }

    if (this.ui.playBtn) {
      this.ui.playBtn.addEventListener('click', () => {
        if (this.synthModule.isPlaying && this.synthModule.isPaused) {
          this.synthModule.resume();
          return;
        }
        const text = this.ui.synthTextArea ? this.ui.synthTextArea.value : '';
        const voiceType = this.ui.voiceSelect ? this.ui.voiceSelect.value : '3';
        if (!text.trim()) {
          VoiceSuiteToast.show('読み上げるテキストを入力してください。', 'warning');
          return;
        }
        this.prepareTrackContainer(text);
        this.synthModule.speak(text, voiceType);
      });
    }

    if (this.ui.pauseBtn) {
      this.ui.pauseBtn.addEventListener('click', () => {
        if (this.synthModule.isPaused) {
          this.synthModule.resume();
        } else {
          this.synthModule.pause();
        }
      });
    }

    if (this.ui.stopBtn) {
      this.ui.stopBtn.addEventListener('click', () => {
        this.synthModule.stop();
      });
    }

    if (this.ui.inputTextArea) {
      this.ui.inputTextArea.addEventListener('input', () => {
        this.updateCharCounters();
      });
    }

    if (this.ui.synthTextArea) {
      this.ui.synthTextArea.addEventListener('input', () => {
        if (this.synthModule.isPlaying) {
          this.synthModule.stop();
        }
        this.updateCharCounters();
        this.prepareTrackContainer(this.ui.synthTextArea.value);
      });
    }
  }

  prepareTrackContainer(rawText) {
    if (!this.ui.readTrackContainer) return;
    this.ui.readTrackContainer.innerHTML = '';
    this.trackPhraseCount = 0;
    if (!rawText.trim()) return;

    const cleanDisplay = this.synthModule.cleanAozoraRubyKeepKanji(rawText);
    const phrases = this.synthModule.splitTextIntoPhrases(cleanDisplay);
    this.trackPhraseCount = phrases.length;

    phrases.forEach((phrase, idx) => {
      const span = document.createElement('span');
      span.className = 'vs-track-phrase';
      span.id = `vsTrackPhrase_${idx}`;
      const endsWithNewline = /\n$/.test(phrase);
      span.textContent = endsWithNewline ? phrase : `${phrase} `;
      this.ui.readTrackContainer.appendChild(span);
    });
  }

  handlePhraseSpeaking(idx, totalSynthPhrases = 0) {
    if (!this.ui.readTrackContainer) return;

    const allSpans = this.ui.readTrackContainer.querySelectorAll('.vs-track-phrase');
    allSpans.forEach((span) => span.classList.remove('is-speaking'));

    if (idx >= 0 && this.trackPhraseCount > 0) {
      let targetIdx = idx;
      if (totalSynthPhrases > 1 && totalSynthPhrases !== this.trackPhraseCount) {
        const ratio = idx / (totalSynthPhrases - 1);
        targetIdx = Math.min(this.trackPhraseCount - 1, Math.round(ratio * (this.trackPhraseCount - 1)));
      } else if (targetIdx >= this.trackPhraseCount) {
        targetIdx = this.trackPhraseCount - 1;
      }

      const activeSpan = document.getElementById(`vsTrackPhrase_${targetIdx}`);
      if (activeSpan) {
        activeSpan.classList.add('is-speaking');

        const container = this.ui.readTrackContainer;
        const spanRect = activeSpan.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        const currentPosInContainer = spanRect.bottom - containerRect.top;
        const triggerThreshold = container.clientHeight - 60;

        if (currentPosInContainer > triggerThreshold) {
          const targetScrollTop = container.scrollTop + (currentPosInContainer - 50);
          container.scrollTo({
            top: targetScrollTop,
            behavior: 'smooth'
          });
        }
      }
    }
  }

  updateCharCounters() {
    if (this.ui.inputCharCounter && this.ui.inputTextArea) {
      const inLen = this.ui.inputTextArea.value.length;
      this.ui.inputCharCounter.textContent = `${inLen} 文字`;
    }
    if (this.ui.charCounter && this.ui.synthTextArea) {
      const synthLen = this.ui.synthTextArea.value.length;
      this.ui.charCounter.textContent = `${synthLen} 文字`;
    }
  }

  handleInputStateChange(isRecording) {
    if (this.ui.recordBtn) {
      if (isRecording) {
        this.ui.recordBtn.classList.add('is-recording');
      } else {
        this.ui.recordBtn.classList.remove('is-recording');
      }
    }
    if (this.ui.recordStatus && !isRecording) {
      this.ui.recordStatus.classList.remove('active');
      this.ui.recordStatus.innerHTML = '<span class="vs-status-dot"></span> 待機中（マイクを押して発話）';
    }
  }

  handleInputTick(timeStr) {
    if (this.ui.recordStatus && this.inputModule.isRecording) {
      this.ui.recordStatus.classList.add('active');
      this.ui.recordStatus.innerHTML = `<span class="vs-status-dot"></span> 録音中 [${timeStr}] ...（赤丸が音圧で伸縮します）`;
    }
  }

  handleInputAiStatusChange(status) {
    if (this.ui.inputAiStatus) {
      this.ui.inputAiStatus.className = `vs-input-ai-status ${status.type}`;
      this.ui.inputAiStatus.textContent = status.message;
    }
  }

  handleInputInterim(piece, prefix, suffix) {
    if (this.ui.inputTextArea) {
      const separator = (prefix && !prefix.endsWith('\n') && !prefix.endsWith(' ')) ? ' ' : '';
      this.ui.inputTextArea.value = prefix + separator + piece + suffix;
      this.updateCharCounters();
    }
  }

  handleInputResult(piece, formatted, prefix, suffix) {
    if (this.ui.inputTextArea) {
      const separator = (prefix && !prefix.endsWith('\n') && !prefix.endsWith(' ') && !piece.startsWith('\n')) ? ' ' : '';
      const insertedText = separator + piece;
      const fullText = prefix + insertedText + suffix;
      this.ui.inputTextArea.value = fullText;
      this.updateCharCounters();

      const nextCaretPos = prefix.length + insertedText.length;
      try {
        this.ui.inputTextArea.setSelectionRange(nextCaretPos, nextCaretPos);
        this.ui.inputTextArea.focus();
      } catch (e) {}
    }
  }

  updateTtsBadgeState() {
    if (!this.ui.ttsStatusBadge) return;
    const isActive = this.synthModule.isPlaying && !this.synthModule.isPaused;
    if (isActive) {
      this.ui.ttsStatusBadge.classList.add('is-playing');
    } else {
      this.ui.ttsStatusBadge.classList.remove('is-playing');
    }
  }

  handleSynthStateChange(isPlaying, isPaused) {
    if (this.ui.pauseBtn) {
      this.ui.pauseBtn.textContent = isPaused ? '▶️ 再開' : '⏸️ 一時停止';
    }
    this.updateTtsBadgeState();
  }

  handleSynthProgress(status) {
    if (this.ui.ttsStatusText) {
      this.ui.ttsStatusText.textContent = status || '待機中';
    }
    this.updateTtsBadgeState();
  }
}
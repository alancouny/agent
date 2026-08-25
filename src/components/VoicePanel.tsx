import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Volume2, Loader2, Play, X } from 'lucide-react';
import { voiceApi } from '../api/client';
import { useTranslation } from 'react-i18next';

// ── Voice panel: TTS + STT via OpenAI-compatible endpoints ──
export function VoicePanel() {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [voice, setVoice] = useState('alloy');
  const [ttsBusy, setTtsBusy] = useState(false);
  const [sttBusy, setSttBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // Play TTS result
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const doTts = async () => {
    if (!text.trim() || ttsBusy) return;
    setTtsBusy(true);
    setError('');
    try {
      const { audioBase64, format } = await voiceApi.tts(text, voice);
      const blob = base64ToBlob(audioBase64, format === 'mp3' ? 'audio/mpeg' : 'audio/wav');
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.play().catch(() => {});
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setError(err?.response?.data?.error || err?.message || 'TTS failed');
    } finally {
      setTtsBusy(false);
    }
  };

  const startRecording = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mime || 'audio/webm' });
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        await sendToStt(blob);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError('无法访问麦克风: ' + (msg || 'permission denied'));
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  const sendToStt = async (blob: Blob) => {
    setSttBusy(true);
    setError('');
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(new Error('audio read failed'));
        reader.readAsDataURL(blob);
      });
      const { text: recognized } = await voiceApi.stt(base64);
      setTranscript(recognized);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setError(err?.response?.data?.error || err?.message || t('voice.sttFailed'));
    } finally {
      setSttBusy(false);
    }
  };

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h2 className="text-xl font-bold text-text-primary mb-1">{t('voice.title')}</h2>
          <p className="text-sm text-text-secondary">{t('voice.ttsDesc')}</p>
        </div>

        {/* TTS */}
        <div className="p-5 rounded-xl bg-bg-card border border-border space-y-3">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <Volume2 className="w-4 h-4 text-primary" /> {t('voice.ttsSection')}
          </h3>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('voice.ttsPlaceholder')}
            rows={4}
            className="w-full px-3 py-2.5 rounded-lg bg-bg-input border border-border text-text-primary placeholder-text-muted focus:outline-none focus:border-primary text-sm"
          />
          <div className="flex items-center gap-3">
            <select
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              className="px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-text-primary focus:outline-none focus:border-primary"
            >
              <option value="alloy">alloy</option>
              <option value="echo">echo</option>
              <option value="fable">fable</option>
              <option value="onyx">onyx</option>
              <option value="nova">nova</option>
              <option value="shimmer">shimmer</option>
            </select>
            <button
              onClick={doTts}
              disabled={!text.trim() || ttsBusy}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary-hover disabled:opacity-50 text-sm"
            >
              {ttsBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {t('voice.synthesize')}
            </button>
            {audioUrl && (
              <audio ref={audioRef} controls className="h-9 w-56" />
            )}
          </div>
        </div>

        {/* STT */}
        <div className="p-5 rounded-xl bg-bg-card border border-border space-y-3">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <Mic className="w-4 h-4 text-primary" /> {t('voice.sttSection')}
          </h3>
          <div className="flex items-center gap-3">
            {!recording ? (
              <button
                onClick={startRecording}
                disabled={sttBusy}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-50 text-sm"
              >
                <Mic className="w-4 h-4" /> {t('voice.startRecording')}
              </button>
            ) : (
              <button
                onClick={stopRecording}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 text-sm"
              >
                <Square className="w-4 h-4" /> {t('voice.stopRecording')}
              </button>
            )}
            {sttBusy && <Loader2 className="w-4 h-4 animate-spin text-text-secondary" />}
            {recording && <span className="text-xs text-red-400 animate-pulse">{t('voice.recording')}</span>}
          </div>
          {transcript && (
            <div className="p-3 rounded-lg bg-bg-input/60 border border-border">
              <div className="text-xs text-text-muted mb-1">{t('voice.resultLabel')}</div>
              <p className="text-sm text-text-primary">{transcript}</p>
            </div>
          )}
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-500">
            <div className="flex items-center gap-2">
              <X className="w-4 h-4" /> {error}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function base64ToBlob(base64: string, mime: string): Blob {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

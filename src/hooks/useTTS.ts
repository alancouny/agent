/**
 * useTTS — Text-to-speech playback hook.
 *
 * Supports two modes:
 *   - 'browser-native'  → Web Speech API (window.speechSynthesis)
 *   - 'tts-api'         → backend /voice/tts (OpenAI-compatible), plays via <audio>
 *
 * Per-message playback state is tracked so multiple messages can be
 * queued; only one message plays at a time (starting a new one stops
 * any currently-playing message).
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { voiceApi } from '../api/client';
import type { TtsVoice } from '../api/client';

// ── Types ────────────────────────────────────────────────────────────────────
export type TtsMode = 'browser-native' | 'tts-api';

export interface TTSSettings {
  mode: TtsMode;
  /** browser-native: voice URI; tts-api: voice name (alloy/shimmer/fable/onyx/nova/ash) */
  voice: string;
  /** Whether to also read thinking content when it arrives */
  readThinking: boolean;
}

const DEFAULT_SETTINGS: TTSSettings = {
  mode: 'browser-native',
  voice: '',
  readThinking: false,
};

const SETTINGS_KEY = 'tts_settings';

function loadSettings(): TTSSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* localStorage unavailable */ }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(s: TTSSettings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* localStorage unavailable */ }
}

// ── Browser-native voices (cached on first load) ─────────────────────────────
let cachedBrowserVoices: SpeechSynthesisVoice[] | null = null;

export function getBrowserVoices(): SpeechSynthesisVoice[] {
  if (!cachedBrowserVoices && typeof window !== 'undefined' && window.speechSynthesis) {
    cachedBrowserVoices = window.speechSynthesis.getVoices();
  }
  return cachedBrowserVoices ?? [];
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useTTS() {
  const [settings, setSettings] = useState<TTSSettings>(loadSettings);
  // Currently playing message id (null = nothing playing)
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [apiVoices, setApiVoices] = useState<TtsVoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Detect whether the browser supports the Web Speech API at all
  const speechSynthesisAvailable = typeof window !== 'undefined' && !!window.speechSynthesis;

  // Refs for clean cancellation without stale closures
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentIdRef = useRef<string | null>(null);
  const speechRef = useRef<SpeechSynthesisUtterance | null>(null);

  // ── Persist settings ──────────────────────────────────────────────────────
  useEffect(() => { saveSettings(settings); }, [settings]);

  // ── Re-read settings from localStorage on focus change ───────────────────
  // Ensures settings updated by Settings panel (or other tab) are picked up.
  useEffect(() => {
    const sync = () => {
      try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (raw) setSettings(prev => {
          const next = { ...prev, ...JSON.parse(raw) };
          return next.mode === prev.mode && next.voice === prev.voice && next.readThinking === prev.readThinking ? prev : next;
        });
      } catch { /* localStorage unavailable */ }
    };
    window.addEventListener('focus', sync);
    return () => window.removeEventListener('focus', sync);
  }, []);

  // ── Load browser voices on mount + when they become available ─────────────
  useEffect(() => {
    const load = () => {
      const v = getBrowserVoices();
      setVoices(v);
      // Restore previously-selected voice; fall back to first if missing
      if (v.length > 0 && settings.mode === 'browser-native' && !v.find(ve => ve.voiceURI === settings.voice)) {
        setSettings(prev => ({ ...prev, voice: v[0].voiceURI }));
      }
    };
    load();
    window.speechSynthesis?.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', load);
  }, [settings.mode, settings.voice]);

  // ── Load TTS API voices when in tts-api mode ──────────────────────────────
  useEffect(() => {
    if (settings.mode !== 'tts-api') {
      setApiVoices([]);
      return;
    }
    voiceApi.getVoices().then(({ voices: vs }) => setApiVoices(vs)).catch(() => setApiVoices([]));
  }, [settings.mode]);

  // ── Stop any active playback ──────────────────────────────────────────────
  const stop = useCallback(() => {
    // Browser-native
    window.speechSynthesis?.cancel();
    // TTS API
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    currentIdRef.current = null;
    setPlayingId(null);
    setIsPaused(false);
    setError(null);
  }, []);

  // ── Pause / Resume (browser-native) ───────────────────────────────────────
  const pause = useCallback(() => {
    window.speechSynthesis?.pause();
    setIsPaused(true);
  }, []);

  const resume = useCallback(() => {
    window.speechSynthesis?.resume();
    setIsPaused(false);
  }, []);

  // ── Speak a message (browser-native path) ─────────────────────────────────
  const speakNative = useCallback((msgId: string, text: string) => {
    if (!text.trim()) return;
    stop();
    currentIdRef.current = msgId;
    setPlayingId(msgId);
    setIsPaused(false);
    setError(null);

    const utter = new SpeechSynthesisUtterance(text);
    const voice = voices.find(v => v.voiceURI === settings.voice);
    if (voice) utter.voice = voice;
    utter.onend = () => {
      if (currentIdRef.current === msgId) {
        currentIdRef.current = null;
        setPlayingId(null);
        setIsPaused(false);
      }
    };
    utter.onerror = (e) => {
      if (currentIdRef.current !== msgId) return; // already stopped
      currentIdRef.current = null;
      setPlayingId(null);
      setIsPaused(false);
      setError(e.error === 'interrupted' ? '' : `TTS error: ${e.error}`);
    };
    speechRef.current = utter;
    window.speechSynthesis?.speak(utter);
  }, [settings.voice, voices, stop]);

  // ── Speak a message (TTS API path) ────────────────────────────────────────
  const speakApi = useCallback(async (msgId: string, text: string) => {
    if (!text.trim()) return;
    stop();
    currentIdRef.current = msgId;
    setPlayingId(msgId);
    setIsPaused(false);
    setError(null);

    try {
      const { audioBase64 } = await voiceApi.tts(text, settings.voice);
      if (currentIdRef.current !== msgId) return; // user moved on

      const audio = new Audio(`data:audio/mpeg;base64,${audioBase64}`);
      audioRef.current = audio;
      audio.onended = () => {
        if (currentIdRef.current === msgId) {
          currentIdRef.current = null;
          setPlayingId(null);
          setIsPaused(false);
        }
      };
      audio.onerror = () => {
        if (currentIdRef.current !== msgId) return;
        currentIdRef.current = null;
        setPlayingId(null);
        setIsPaused(false);
        setError('Audio playback failed');
      };
      await audio.play();
    } catch (e: unknown) {
      if (currentIdRef.current !== msgId) return;
      currentIdRef.current = null;
      setPlayingId(null);
      setIsPaused(false);
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || 'TTS request failed');
    }
  }, [settings.voice, stop]);

  const speak = useCallback((msgId: string, text: string) => {
    if (settings.mode === 'browser-native') {
      speakNative(msgId, text);
    } else {
      speakApi(msgId, text);
    }
  }, [settings.mode, speakNative, speakApi]);

  // ── Pause / Resume (TTS API path) ─────────────────────────────────────────
  const pauseApi = useCallback(() => {
    audioRef.current?.pause();
    setIsPaused(true);
  }, []);

  const resumeApi = useCallback(() => {
    audioRef.current?.play();
    setIsPaused(false);
  }, []);

  const pauseAny = useCallback(() => {
    if (settings.mode === 'browser-native') pause(); else pauseApi();
  }, [settings.mode, pause, pauseApi]);

  const resumeAny = useCallback(() => {
    if (settings.mode === 'browser-native') resume(); else resumeApi();
  }, [settings.mode, resume, resumeApi]);

  // ── Settings updaters ─────────────────────────────────────────────────────
  const updateSetting = useCallback(<K extends keyof TTSSettings>(key: K, value: TTSSettings[K]) => {
    setSettings(prev => {
      if (prev[key] === value) return prev;
      // Changing mode or voice mid-playback → stop current
      if ((key === 'mode' || key === 'voice') && playingId !== null) stop();
      return { ...prev, [key]: value };
    });
  }, [playingId, stop]);

  return {
    settings,
    voices,            // browser-native SpeechSynthesisVoice[]
    apiVoices,         // TTS API voices (loaded when mode === 'tts-api')
    speechSynthesisAvailable,
    playingId,
    isPaused,
    error,
    speak,
    stop,
    pause: pauseAny,
    resume: resumeAny,
    updateSetting,
  };
}

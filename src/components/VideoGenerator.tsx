import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Video, Play, Download, RefreshCw, Clock, Film } from 'lucide-react';
import { videoApi } from '../api/client';

export function VideoGenerator() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [duration, setDuration] = useState(5);
  const [style, setStyle] = useState('realistic');
  const [isLoading, setIsLoading] = useState(false);
  const [generatedVideo, setGeneratedVideo] = useState<{
    video_url: string;
    thumbnail: string;
    prompt: string;
    duration: number;
    style: string;
  } | null>(null);
  const [progress, setProgress] = useState(0);
  const [history, setHistory] = useState<{
    video_url: string;
    thumbnail: string;
    prompt: string;
    duration: number;
    style: string;
  }[]>([]);

  const handleGenerate = async () => {
    if (!prompt.trim() || isLoading) return;

    setIsLoading(true);
    setProgress(0);

    const progressInterval = setInterval(() => {
      setProgress((prev) => (prev >= 100 ? 100 : prev + 10));
    }, 500);

    try {
      const response = await videoApi.generate({
        prompt,
        duration,
        style,
        negative_prompt: negativePrompt || undefined,
      });

      if (response.thumbnail) {
        setGeneratedVideo(response);
        setHistory((prev) => [
          response,
          ...prev.slice(0, 4),
        ]);
      }
    } catch {
      // generation failed — status is already reset by finally
    } finally {
      clearInterval(progressInterval);
      setProgress(100);
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-auto p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent to-primary flex items-center justify-center">
          <Video className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-text-primary">{t('video.title')}</h2>
          <p className="text-sm text-text-secondary">{t('video.subtitle')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              {t('video.promptLabel')}
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t('video.promptPlaceholder')}
              className="w-full px-4 py-3 bg-bg-card border border-border rounded-xl text-text-primary placeholder-text-secondary resize-none focus:outline-none focus:border-primary transition-colors"
              rows={4}
              disabled={isLoading}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              {t('video.negativePromptLabel')}
            </label>
            <textarea
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              placeholder={t('video.negativePromptPlaceholder')}
              className="w-full px-4 py-3 bg-bg-card border border-border rounded-xl text-text-primary placeholder-text-secondary resize-none focus:outline-none focus:border-accent transition-colors"
              rows={3}
              disabled={isLoading}
            />
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-text-secondary mb-2">
                <Film className="w-4 h-4" />
                {t('image.optionalStyle')}
              </label>
              <input
                type="text"
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                placeholder={t('video.stylePlaceholder')}
                className="w-full px-4 py-2 bg-bg-card border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-primary transition-colors"
                disabled={isLoading}
              />
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-text-secondary mb-2">
                <Clock className="w-4 h-4" />
                {t('video.duration')}
              </label>
              <input
                type="number"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                min={1}
                max={60}
                className="w-full px-4 py-2 bg-bg-card border border-border rounded-lg text-text-primary focus:outline-none focus:border-primary transition-colors"
                disabled={isLoading}
              />
            </div>
          </div>

          {isLoading && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-secondary">{t('video.progress')}</span>
                <span className="text-primary">{progress}%</span>
              </div>
              <div className="h-2 bg-bg-card rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-accent to-primary transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={isLoading || !prompt.trim()}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-accent to-primary text-white rounded-xl font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-accent/25"
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-5 h-5 animate-spin" />
                {t('video.generating')}
              </>
            ) : (
              <>
                <Video className="w-5 h-5" />
                {t('video.generate')}
              </>
            )}
          </button>
        </div>

        <div className="space-y-4">
          <div className="bg-bg-card rounded-xl overflow-hidden border border-border">
            <div className="aspect-video bg-bg-darker flex items-center justify-center relative">
              {generatedVideo ? (
                <div className="relative w-full h-full">
                  <img
                    src={generatedVideo.thumbnail}
                    alt="Video thumbnail"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                    <div className="w-16 h-16 rounded-full bg-white/90 flex items-center justify-center hover:scale-110 transition-transform cursor-pointer">
                      <Play className="w-8 h-8 text-primary ml-1" />
                    </div>
                  </div>
                  <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 bg-black/60 backdrop-blur px-3 py-1 rounded-full">
                      <Clock className="w-4 h-4 text-white" />
                      <span className="text-white text-sm">{generatedVideo.duration}s</span>
                    </div>
                    <button className="p-2 bg-black/60 backdrop-blur rounded-lg text-white hover:bg-black/80 transition-colors">
                      <Download className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center text-text-secondary">
                  <Video className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p className="text-sm">{t('video.placeholder')}</p>
                  <p className="text-xs mt-1">{t('video.hint')}</p>
                </div>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-text-secondary mb-3">{t('video.recent')}</h3>
            <div className="grid grid-cols-1 gap-2">
              {history.map((item, index) => (
                <button
                  key={index}
                  onClick={() => setGeneratedVideo(item)}
                  className="flex items-center gap-3 p-3 bg-bg-card rounded-lg border border-border hover:border-primary transition-colors"
                >
                  <img
                    src={item.thumbnail}
                    alt={`Video ${index + 1}`}
                    className="w-20 h-12 object-cover rounded"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text-primary truncate">{item.prompt}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-text-secondary">{item.style}</span>
                      <span className="text-xs text-text-secondary">|</span>
                      <span className="text-xs text-text-secondary">{item.duration}s</span>
                    </div>
                  </div>
                  <Play className="w-5 h-5 text-text-secondary" />
                </button>
              ))}
              {history.length === 0 && (
                <div className="text-center text-text-secondary py-8">
                  <p className="text-sm">{t('video.noRecent')}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

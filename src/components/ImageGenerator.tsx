import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Sparkles, Download, RefreshCw, Palette, Maximize2 } from 'lucide-react';
import { imageApi } from '../api/client';
import { logger } from '../utils/logger';

export function ImageGenerator() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [style, setStyle] = useState('photorealistic');
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(1024);
  const [isLoading, setIsLoading] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [history, setHistory] = useState<{ image: string; prompt: string; style: string }[]>([]);

  const handleGenerate = async () => {
    if (!prompt.trim() || isLoading) return;

    setIsLoading(true);

    try {
      const response = await imageApi.generate({
        prompt,
        width,
        height,
        style,
        negative_prompt: negativePrompt || undefined,
      });

      if (response.image_url) {
        setGeneratedImage(response.image_url);
        setHistory((prev) => [
          { image: response.image_url, prompt, style },
          ...prev.slice(0, 9),
        ]);
      }
    } catch (error) {
      logger.error('Image generation error', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = () => {
    if (!generatedImage) return;

    const link = document.createElement('a');
    link.href = generatedImage;
    link.download = `generated-image-${Date.now()}.png`;
    link.click();
  };

  return (
    <div className="flex flex-col h-full overflow-auto p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-secondary to-accent flex items-center justify-center">
          <Image className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-text-primary">{t('image.title')}</h2>
          <p className="text-sm text-text-secondary">{t('image.hint')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              {t('image.promptLabel')}
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t('image.promptPlaceholder')}
              className="w-full px-4 py-3 bg-bg-card border border-border rounded-xl text-text-primary placeholder-text-secondary resize-none focus:outline-none focus:border-primary transition-colors"
              rows={4}
              disabled={isLoading}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              {t('image.negativePromptLabel')}
            </label>
            <textarea
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              placeholder={t('image.negativePromptPlaceholder')}
              className="w-full px-4 py-3 bg-bg-card border border-border rounded-xl text-text-primary placeholder-text-secondary resize-none focus:outline-none focus:border-accent transition-colors"
              rows={3}
              disabled={isLoading}
            />
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-text-secondary mb-2">
                <Palette className="w-4 h-4" />
                {t('image.optionalStyle')}
              </label>
              <input
                type="text"
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                placeholder={t('image.stylePlaceholder')}
                className="w-full px-4 py-2 bg-bg-card border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-primary transition-colors"
                disabled={isLoading}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-text-secondary mb-2">
                  <Maximize2 className="w-4 h-4" />
                  {t('image.width')}
                </label>
                <input
                  type="number"
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value))}
                  className="w-full px-4 py-2 bg-bg-card border border-border rounded-lg text-text-primary focus:outline-none focus:border-primary transition-colors"
                  disabled={isLoading}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-text-secondary mb-2">
                  {t('image.height')}
                </label>
                <input
                  type="number"
                  value={height}
                  onChange={(e) => setHeight(Number(e.target.value))}
                  className="w-full px-4 py-2 bg-bg-card border border-border rounded-lg text-text-primary focus:outline-none focus:border-primary transition-colors"
                  disabled={isLoading}
                />
              </div>
            </div>
          </div>

          <button
            onClick={handleGenerate}
            disabled={isLoading || !prompt.trim()}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-secondary to-accent text-white rounded-xl font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-secondary/25"
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-5 h-5 animate-spin" />
                {t('image.generating')}
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5" />
                {t('image.generate')}
              </>
            )}
          </button>
        </div>

        <div className="space-y-4">
          <div className="bg-bg-card rounded-xl overflow-hidden border border-border">
            <div className="aspect-square bg-bg-darker flex items-center justify-center relative">
              {generatedImage ? (
                <>
                  <img
                    src={generatedImage}
                    alt="Generated"
                    className="max-w-full max-h-full object-contain"
                  />
                  <button
                    onClick={handleDownload}
                    className="absolute bottom-4 right-4 p-2 bg-bg-card/90 backdrop-blur rounded-lg text-text-primary hover:bg-bg-hover transition-colors"
                  >
                    <Download className="w-5 h-5" />
                  </button>
                </>
              ) : (
                <div className="text-center text-text-secondary">
                  <Image className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p className="text-sm">{t('image.placeholder')}</p>
                  <p className="text-xs mt-1">{t('image.hint')}</p>
                </div>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-text-secondary mb-3">{t('image.recent')}</h3>
            <div className="grid grid-cols-4 gap-2">
              {history.map((item, index) => (
                <button
                  key={index}
                  onClick={() => setGeneratedImage(item.image)}
                  className="aspect-square rounded-lg overflow-hidden border border-border hover:border-primary transition-colors relative group"
                >
                  <img
                    src={item.image}
                    alt={`Generation ${index + 1}`}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="text-white text-xs truncate px-2">
                      {item.prompt.substring(0, 15)}...
                    </span>
                  </div>
                </button>
              ))}
              {history.length === 0 && (
                <div className="col-span-4 text-center text-text-secondary py-8">
                  <p className="text-sm">{t('image.noRecent')}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

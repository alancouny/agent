import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Settings } from '../Settings';

const mockDocs = vi.fn();
const mockGetConfig = vi.fn();
const mockIndexStatus = vi.fn();
const mockPrompts = vi.fn();

vi.mock('../../api/client', () => ({
  knowledgeApi: {
    docs: (...a: unknown[]) => mockDocs(...a),
    getConfig: (...a: unknown[]) => mockGetConfig(...a),
    indexStatus: (...a: unknown[]) => mockIndexStatus(...a),
    updateConfig: vi.fn(),
    rebuild: vi.fn(),
    ingest: vi.fn(),
    deleteDoc: vi.fn(),
    indexSync: vi.fn(),
  },
  promptsApi: {
    list: (...a: unknown[]) => mockPrompts(...a),
    add: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

describe('Settings (section switching)', () => {
  beforeEach(() => {
    mockDocs.mockResolvedValue({ docs: [], chunkTotal: 0 });
    mockGetConfig.mockResolvedValue({
      config: { embeddingModel: 'text-embedding-3-small', chunkSize: 900, chunkOverlap: 120, chunkStrategy: 'paragraph', retrievalMode: 'dense', rerankEnabled: false, topK: 5, scoreThreshold: 0.2, indexBackend: 'bruteforce' },
    });
    mockIndexStatus.mockResolvedValue({ configured: 'bruteforce', effective: 'bruteforce' });
    mockPrompts.mockResolvedValue({ prompts: [] });
  });

  it('switches between sections without crashing (regression: hooks in render fns)', () => {
    render(<Settings onBack={vi.fn()} />);

    // → Knowledge Base
    fireEvent.click(screen.getByText('Knowledge Base'));
    expect(screen.getByText('Knowledge Base (RAG)')).toBeInTheDocument();

    // → Prompt Library
    fireEvent.click(screen.getByText('Prompt Library'));
    expect(screen.getAllByText('Prompt Library').length).toBeGreaterThanOrEqual(2);

    // → Language
    fireEvent.click(screen.getByText('Language'));
    expect(screen.getByText('English')).toBeInTheDocument();

    // back to Knowledge Base again (hooks order must stay stable across round-trips)
    fireEvent.click(screen.getByText('Knowledge Base'));
    expect(screen.getByText('Knowledge Base (RAG)')).toBeInTheDocument();

    // and again to Prompts
    fireEvent.click(screen.getByText('Prompt Library'));
    expect(screen.getAllByText('Prompt Library').length).toBeGreaterThanOrEqual(2);
  });

  it('shows the back button and calls onBack', () => {
    const onBack = vi.fn();
    render(<Settings onBack={onBack} />);
    fireEvent.click(screen.getByText('返回'));
    expect(onBack).toHaveBeenCalled();
  });
});

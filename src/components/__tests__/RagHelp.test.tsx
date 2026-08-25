import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { RagHelp } from '../RagHelp';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => {
        const map: Record<string, string> = {
          'ragHelp.tooltip': 'RAG 使用说明',
          'ragHelp.title': '知识库 (RAG) 使用说明',
          'ragHelp.subtitle': 'Settings → Knowledge Base 的完整帮助 · 精简版',
          'ragHelp.tabIntro': '功能介绍',
          'ragHelp.tabNotes': '操作注意事项',
          'ragHelp.tabQa': '常见问题 (QA)',
          'ragHelp.fullDoc': '完整文档：docs/RAG_GUIDE.md（含全部 API 说明）。',
          'ragHelp.introText': '知识库让 Agent 在回答前先检索你自己的资料，把最相关的片段拼进系统提示再交给模型。整条链路',
          'ragHelp.localFirstLabel': ' 本地优先',
          'ragHelp.localFirstBody': '：文档正文、分块和向量都存在本地 SQLite（backend/data/agent.db），只有"把文本转成向量"这一步需要调用 embedding 服务。',
          'ragHelp.pipeline1': '文档 → 切分(chunk) → 向量化(embed) → 存入 SQLite',
          'ragHelp.pipeline2': '提问 → 向量化 → 检索(dense / hybrid) → 可选重排 → TopK 注入系统提示 → LLM',
          'ragHelp.kvEmbedding': 'Embedding model',
          'ragHelp.descEmbedding': '文本转向量的模型；支持 OpenAI 兼容端点（Ollama / Azure / 硅基流动等）',
          'ragHelp.kvChunk': 'Chunk size / overlap',
          'ragHelp.descChunk': '单分块字符上限 / 相邻分块重叠量',
          'ragHelp.kvStrategy': 'Chunk strategy',
          'ragHelp.descStrategy': 'paragraph / sentence / recursive / token 四种切分方式',
          'ragHelp.kvRetrieval': 'Retrieval mode',
          'ragHelp.descRetrieval': 'dense（纯向量）或 hybrid（向量 + BM25 关键词）',
          'ragHelp.kvRerank': 'Rerank',
          'ragHelp.descRerank': '对候选做二次词面重合度加权，压掉泛相似噪声',
          'ragHelp.kvTopK': 'Top K / threshold',
          'ragHelp.descTopK': '注入几条 / 低于该分数直接丢弃',
          'ragHelp.kvBackend': 'Index backend',
          'ragHelp.descBackend': 'bruteforce（JS 逐条算）或 sqlite-vec（原生 SQL KNN）',
          'ragHelp.note0': JSON.stringify({ title: '换 embedding 模型必须重建索引', body: '不同模型向量维度不同（1536 / 3072 / 768 / 1024）。换模型后旧向量与新查询对不上，检索会乱或全空。改模型、base URL、chunk size/overlap/strategy 后都要点 Rebuild index（会从原文重新切分 + 重向量化）。' }),
          'ragHelp.note1': JSON.stringify({ title: '重建是全量重跑，会产生 API 费用', body: 'Rebuild index 对每个分块都重新请求 embedding。库大时耗时长、按量计费 provider 会产生费用、可能触发 rate limit。建议先在小库验证配置，再灌大批量数据。' }),
          'ragHelp.note2': JSON.stringify({ title: '配置错误是静默降级的', body: '没有 embedding key / 端点不可达 / 模型名写错时，检索直接当作"没检索到"，Agent 照常回答。所以配错了不会报错，只是知识库像不存在一样。自查：库里有文档但回答不引用 → 先确认 embedding 配置能通。' }),
          'ragHelp.note3': JSON.stringify({ title: 'Score threshold 要跟着模式调', body: 'dense 模式阈值 0.2 是合理起点；hybrid 分数分布更宽；开了 rerank 整体分数被压低，0.2 可能把该召回的滤掉。一条都召不回就降阈值（先试 0.05 或 0）。' }),
          'ragHelp.note4': JSON.stringify({ title: 'Top K 直接吃上下文预算', body: '每条命中片段都拼进系统提示。topK=5 + chunkSize=900 ≈ 4500 字符额外输入，每轮都要付。上下文窗口小的模型上，Top K 调太大会挤掉对话历史。' }),
          'ragHelp.note5': JSON.stringify({ title: 'URL 抓取能力有限', body: '只做"取 HTML → 剥标签 → 压空白"，没有正文提取也不执行 JS。SPA / 登录页 / 反爬页面抓不到有用内容。重要资料建议手动粘贴正文。' }),
          'ragHelp.note6': JSON.stringify({ title: '删除文档是级联且不可撤销的', body: '删一份文档连带删掉所有分块、向量和原文，没有回收站。原文只存在库里，删了就要重新粘。' }),
          'ragHelp.qa0': JSON.stringify({ q: '灌了文档，Agent 回答时完全不引用？', a: '按顺序排查：① embedding 配置是否可用（错误是静默的）；② Documents 里 chunks 是否 > 0；③ Score threshold 是否过高（先降到 0）；④ 是否换过模型却没重建索引。' }),
          'ragHelp.qa1': JSON.stringify({ q: '换了模型后检索结果变奇怪 / 全空？', a: '向量维度不匹配。点 Rebuild index 重新向量化整个知识库。' }),
          'ragHelp.qa2': JSON.stringify({ q: '能用本地模型、不给 OpenAI 付费吗？', a: '可以。任何 OpenAI 兼容 /embeddings 的服务都行，如 Ollama（http://localhost:11434/v1 + nomic-embed-text）、Azure OpenAI、硅基流动、Together 等。本地服务 API key 填任意非空字符串即可。' }),
          'ragHelp.qa3': JSON.stringify({ q: 'sqlite-vec 要不要开？', a: '分块数上万、或检索有明显延迟时再开。装扩展方式见 docs/RAG_GUIDE.md；装不上会自动回退，不会坏。' }),
          'ragHelp.qa4': JSON.stringify({ q: '怎么确认 sqlite-vec 真的生效了？', a: '看面板右上角徽标：index: sqlitevec 即生效；bruteforce (ext missing → fallback) 表示选了但没加载成功。也可请求 GET /api/knowledge/index 查看 effective / dim / indexedVectors。' }),
          'ragHelp.qa5': JSON.stringify({ q: 'hybrid 和 dense 到底用哪个？', a: '文档里术语 / 编号 / 代码标识符多 → hybrid（BM25 补关键词命中）；纯自然语言叙述、更看重语义 → dense 就够。改这一项不需要重建索引。' }),
          'ragHelp.qa6': JSON.stringify({ q: '哪些配置改动需要重建索引？', a: '需要重建：embedding 模型 / base URL / chunk size / overlap / strategy。不需要重建：retrieval mode / rerank / Top K / score threshold / index backend（切 sqlite-vec 会自动同步虚表，不调 embedding API）。' }),
          'ragHelp.qa7': JSON.stringify({ q: '中文检索效果差怎么办？', a: '① 确认模型支持中文（bge-m3、text-embedding-3-* 均可）；② 切 hybrid —— 内置分词对中文按字切分，BM25 能补上关键词命中；③ chunkSize 可适当调小（400~600）。' }),
          'ragHelp.qa8': JSON.stringify({ q: '重建索引会丢数据吗？', a: '不会。重建只重算分块和向量，原文 raw_text 一直保留。重建期间检索到的可能是不完整中间状态，建议避开使用高峰。' }),
          'ragHelp.qa9': JSON.stringify({ q: '数据存在哪？能备份吗？', a: 'backend/data/agent.db（SQLite, WAL）。停掉服务后拷贝整个 data/ 目录即可。相关表：knowledge_docs、knowledge_chunks、knowledge_vec（虚表）、rag_config。' }),
          'ragHelp.qa10': JSON.stringify({ q: '支持 PDF / Word 吗？', a: '目前只接受纯文本和 URL。PDF / docx 需先自行转成文本再粘贴。' }),
        };
        return map[key] ?? key;
      },
      i18n: { language: 'zh-CN', changeLanguage: vi.fn(), on: vi.fn(), isInitialized: true },
    }),
  };
});

describe('RagHelp', () => {
  it('renders the floating ? button and opens the panel on click', () => {
    render(<RagHelp />);
    const button = screen.getByTitle('RAG 使用说明');
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.getByText('知识库 (RAG) 使用说明')).toBeInTheDocument();
  });

  it('shows the three tabs and switches content', () => {
    render(<RagHelp />);
    fireEvent.click(screen.getByTitle('RAG 使用说明'));
    expect(screen.getByText('功能介绍')).toBeInTheDocument();
    expect(screen.getByText('操作注意事项')).toBeInTheDocument();
    expect(screen.getByText('常见问题 (QA)')).toBeInTheDocument();

    // 默认在功能介绍 tab
    expect(screen.getByText(/本地优先/)).toBeInTheDocument();
    // 切到操作注意事项
    fireEvent.click(screen.getByText('操作注意事项'));
    expect(screen.getByText(/换 embedding 模型必须重建索引/)).toBeInTheDocument();
    // 切到 QA
    fireEvent.click(screen.getByText('常见问题 (QA)'));
    expect(screen.getByText(/灌了文档，Agent 回答时完全不引用/)).toBeInTheDocument();
  });

  it('closes the panel via the X button', () => {
    render(<RagHelp />);
    // Get the floating ? button by title and click to open
    const openBtn = screen.getByTitle('RAG 使用说明');
    expect(openBtn).toBeInTheDocument();
    fireEvent.click(openBtn);

    // Wait for the modal to appear
    expect(screen.getByText('知识库 (RAG) 使用说明')).toBeInTheDocument();

    // Click the X button — it's the button with no accessible name inside the modal header
    const allButtons = screen.getAllByRole('button');
    // Filter to buttons that have no text content (the X icon button)
    const xButtons = allButtons.filter(b => !b.textContent?.trim());
    expect(xButtons.length).toBeGreaterThan(0);
    fireEvent.click(xButtons[xButtons.length - 1]);

    // Panel should be closed
    expect(screen.queryByText('知识库 (RAG) 使用说明')).not.toBeInTheDocument();
  });

  it('closes on Escape', () => {
    render(<RagHelp />);
    fireEvent.click(screen.getByTitle('RAG 使用说明'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('知识库 (RAG) 使用说明')).not.toBeInTheDocument();
  });
});

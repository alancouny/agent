# 知识库（RAG）使用说明

> 位置：**Settings → Knowledge Base**
> 界面右下角有一个 **?** 悬浮按钮，点开即是本文的精简版（功能介绍 / 操作注意事项 / 常见问题）。

---

## 0. 更新记录（2026-08-13）

- **异步灌入**：`POST /api/knowledge/ingest` 支持 `async: true`，返回 `jobId`，后台排队
  处理，不再阻塞请求；用 `GET /api/knowledge/ingest/jobs` 查进度。
- **Embedding 版本化**：换 embedding 模型 / provider 后，系统自动把 `embedding_version`
  +1，旧分块在重建前会被检索**自动忽略**（不会再用错维度的向量算相似度）。
- **sqlite-vec 真正接入**：`sqlite-vec` 原生扩展加载成功时，检索走 SQL KNN
  （`knowledge_vec` 虚表，cosine 度量），`GET /api/knowledge/index` 会报告
  `effective: sqlitevec` 与维度/条数；`POST /api/knowledge/index/sync` 可从现有向量
  重建虚表（不调 embedding API）。
- **两阶段检索**：检索先做候选生成（dense 或 hybrid），再在**有界候选集**上做可选的
  重排，避免对全库做重排计算。

---

## 1. 功能介绍

知识库让 Agent 在回答前先检索你自己的资料，把最相关的片段拼进系统提示里再交给模型。整条链路是**本地优先**的：文档正文、切分后的分块和向量都存在本地 SQLite（`backend/data/agent.db`），只有"把文本转成向量"这一步需要调用 embedding 服务。

### 1.1 数据流

```
文档 → 切分(chunk) → 向量化(embed) → 存入 SQLite
                                          ↓
用户提问 → 向量化 → 检索(dense / hybrid) → 可选重排 → TopK 片段注入系统提示 → LLM
```

### 1.2 七层可配置项

| 配置项 | 作用 | 默认值 |
|---|---|---|
| **Embedding model** | 文本转向量用的模型 | `text-embedding-3-small` |
| **Embedding base URL** | OpenAI 兼容的 `/embeddings` 端点 | `https://api.openai.com/v1` |
| **Embedding API key** | 该端点的密钥；留空则回退服务端环境变量 | 空 |
| **Chunk size / overlap** | 单个分块的字符上限 / 相邻分块重叠量 | `900` / `120` |
| **Chunk strategy** | 切分方式：`paragraph` / `sentence` / `recursive` / `token` | `paragraph` |
| **Retrieval mode** | `dense`（纯向量）或 `hybrid`（向量 0.7 + BM25 0.3） | `dense` |
| **Rerank** | 二次重排开关（对候选做词面重合度加权） | 关 |
| **Top K / Score threshold** | 注入几条 / 低于该分数直接丢弃 | `5` / `0.2` |
| **Index backend** | `bruteforce`（JS 逐条算余弦）或 `sqlite-vec`（原生 SQL KNN） | `bruteforce` |

### 1.3 切分策略怎么选

| 策略 | 行为 | 适合 |
|---|---|---|
| `paragraph` | 按空行切，短段落会合并到接近 size | Markdown、结构化文档（**推荐默认**） |
| `sentence` | 按句末标点切（中英文标点都识别） | FAQ、条款、逐句独立的内容 |
| `recursive` | 依次尝试 标题 → 空行 → 换行 → 句号 → 空格 分隔符 | 结构混乱、长短不一的混合文本 |
| `token` | 定长滑窗（按 ≈4 字符/token 估算，**size 单位是 token**） | 需要严格控制 token 预算时 |

> ⚠️ `token` 策略的 size 是 token 数，实际字符上限约为 `size × 4`。填 `900` 会得到约 3600 字符的分块，通常你想填的是 `200`~`400`。

### 1.4 检索模式怎么选

- **dense**：语义相近就能召回，但对**专有名词、编号、代码标识符**不敏感（"ERR_4021" 这种词向量帮不上忙）。
- **hybrid**：在 dense 之上叠加 BM25 关键词得分（权重 0.7 / 0.3），能把精确词命中的分块拉上来。**文档里有大量术语、型号、错误码时优先选 hybrid。**
- **Rerank**：只对 Top(`2×topK`) 候选做二次打分（原分 0.6 + 词面 Jaccard 重合度 0.4），能压掉"语义泛相似但没提到关键词"的噪声。代价是分数分布会变化，**开启后阈值通常要下调**。

### 1.5 索引后端

- **bruteforce**（默认）：把所有向量读进内存逐条算余弦。零依赖、永远可用；几千个分块无感知，上万后每次检索的延迟会线性增长。
- **sqlite-vec**（原生加速）：向量额外写进 `vec0` 虚表，检索走 SQL 的 `MATCH ... AND k = ?` KNN，用 cosine 距离度量。需要能加载原生扩展。

装好扩展的方式（任一）：

```bash
# 方式 A（推荐）：装 npm 包，自动定位 .dylib / .so / .dll
cd backend && npm install sqlite-vec

# 方式 B：手动指定扩展文件路径
export SQLITE_VEC_PATH=/absolute/path/to/vec0.dylib
```

选了 `sqlite-vec` 但扩展加载不了时，**会静默回退到 bruteforce**，检索功能不受影响；面板右上角的徽标会显示 `index: bruteforce (ext missing → fallback)`。

---

## 2. 操作流程

1. **配好 embedding**：填 model / base URL / API key。用本地 Ollama 就填 `http://localhost:11434/v1` + `nomic-embed-text`，key 随便填非空值。
2. **点 Save configuration**。配置存在 SQLite 的 `rag_config` 表，重启不丢。
3. **灌文档**：`Add Document` 里粘文本，或填一个 URL（服务端会抓取并剥掉 HTML 标签）。
4. **验证**：`Documents` 列表出现条目且 `chunks` 数量 > 0，说明切分和向量化都成功了。
5. **正常提问**：在 Chat 里提问，命中的片段会自动注入，无需任何前缀或指令。

---

## 3. 操作注意事项

### 3.1 换 embedding 模型必须重建索引 ⚠️

**这是最容易踩的坑。** 不同模型的向量维度不同：

| 模型 | 维度 |
|---|---|
| `text-embedding-3-small` | 1536 |
| `text-embedding-3-large` | 3072 |
| `nomic-embed-text` | 768 |
| `bge-m3` | 1024 |

换模型后，库里旧向量的维度和新查询向量对不上，余弦相似度计算的结果**没有意义**（表现为分数异常偏低、检索结果乱序或全空）。

**必须点 `Rebuild index`。** 重建会从每份文档保存的 `raw_text` 原文重新切分 + 重新向量化，并同步重刷 sqlite-vec 虚表（维度变化时自动 drop + recreate）。

同理，**改了 chunk size / overlap / strategy 也要重建**，否则新旧分块粒度混在一起。

### 3.2 重建是全量重跑，会产生 API 调用和费用

`Rebuild index` 对**每一个分块**都重新请求一次 embedding。库大的时候：耗时长、按量计费的 provider 会产生实际费用、可能触发 rate limit。建议先在小库上确认配置可用，再灌大批量数据。

### 3.3 没有 embedding key 时会静默降级

检索失败（key 缺失、端点不可达、模型名写错）不会让 Agent 报错崩掉，而是**当作"没检索到任何内容"继续回答**。这是刻意的容错设计，但也意味着**配错了不会有明显报错**——只是知识库像不存在一样。

自查方法：库里有文档，但回答完全没引用资料 → 先确认 embedding 配置能通。

### 3.4 Score threshold 要跟着模式一起调

阈值是对**最终得分**过滤的，而不同模式的得分尺度不一样：

- `dense`：得分就是余弦相似度，`0.2` 是个合理起点。
- `hybrid`：`0.7 × 余弦 + 0.3 × 归一化BM25`，量级接近但分布更宽。
- 开了 `rerank`：`0.6 × 原分 + 0.4 × Jaccard`，**整体会被压低**，`0.2` 可能把该召回的也滤掉。

**症状 → 处理**：一条都召不回 → 降阈值（先试 `0.05` 或 `0`）；噪声太多 → 升阈值或减小 Top K。

### 3.5 Top K 直接吃上下文预算

每条命中片段都会拼进系统提示。`topK=5` + `chunkSize=900` ≈ 4500 字符的额外输入，每轮对话都要付。上下文窗口小的模型上，Top K 调太大会挤掉对话历史。

### 3.6 URL 抓取能力有限

URL 灌入只做"取 HTML → 正则剥标签 → 压空白"，没有正文提取（readability）也不执行 JS。所以：

- SPA / 需要登录 / 有反爬的页面 → 抓不到有用内容；
- 抓到的正文会混入导航、页脚等噪声。

重要资料建议**手动粘贴正文**，质量远好于 URL 抓取。

### 3.7 删除文档是级联的，且不可撤销

删一份文档会连带删掉它的所有分块、向量和 `raw_text` 原文，没有回收站。原文只存在库里，删了就要重新粘。

### 3.8 当前是单份全局配置

`rag_config` 目前只有一行（`id='default'`），所有文档共用同一套 embedding / 切分 / 检索参数。还不支持"每个知识库独立配置"。

---

## 4. 常见问题（QA）

**Q1：为什么灌了文档，Agent 回答时完全不引用？**
按顺序排查：① embedding 配置是否可用（见 3.3，配错是静默的）；② `Documents` 里 `chunks` 是否 > 0；③ Score threshold 是否过高（先降到 `0`）；④ 是否换过模型却没重建索引（见 3.1）。

**Q2：换了模型之后检索结果变得很奇怪 / 全空？**
维度不匹配。点 `Rebuild index`。

**Q3：能用本地模型、不给 OpenAI 付费吗？**
可以。任何暴露 OpenAI 兼容 `/embeddings` 的服务都行。Ollama：`http://localhost:11434/v1` + `nomic-embed-text`；也支持 Azure OpenAI、硅基流动、Together 等。API key 字段填任意非空字符串即可（本地服务通常不校验）。

**Q4：`sqlite-vec` 要不要开？**
分块数上万、或觉得检索有明显延迟时再开。开之前先装扩展（见 1.5）。装不上也没关系——会自动回退，不会坏。

**Q5：怎么确认 sqlite-vec 真的生效了？**
看面板右上角徽标：`index: sqlitevec` 表示已生效；`index: bruteforce (ext missing → fallback)` 表示选了但没加载成功。也可以直接请求 `GET /api/knowledge/index`，返回里有 `effective`、`version`、`dim`、`indexedVectors` 和回退原因 `reason`。

**Q6：hybrid 和 dense 到底该用哪个？**
文档里术语/编号/代码标识符多 → hybrid。纯自然语言叙述、更看重"意思相近" → dense 就够。改这一项**不需要**重建索引（只影响检索时的打分）。

**Q7：哪些配置改动需要重建索引？**
需要重建：**embedding 模型 / base URL（换了 provider）/ chunk size / chunk overlap / chunk strategy**。
不需要重建：**retrieval mode / rerank / Top K / score threshold / index backend**（index backend 切到 sqlite-vec 时会自动同步虚表，不用重新调 embedding API）。

**Q8：中文检索效果差怎么办？**
① 确认模型支持中文（`bge-m3`、`text-embedding-3-*` 都可以）；② 切到 `hybrid`——内置分词器对中文按字切分，BM25 能补上关键词命中；③ 中文信息密度高，`chunkSize` 可以适当调小（`400`~`600`）。

**Q9：重建索引会丢数据吗？**
不会丢文档。重建只重算分块和向量，原文 `raw_text` 一直保留。但重建期间检索到的可能是不完整的中间状态，建议避开使用高峰。

**Q10：知识库数据存在哪？能备份吗？**
`backend/data/agent.db`（SQLite，WAL 模式）。停掉服务后整个 `data/` 目录拷走即可完成备份。相关表：`knowledge_docs`（含 `raw_text` 原文）、`knowledge_chunks`（分块 + JSON 向量）、`knowledge_vec`（sqlite-vec 虚表，可重建）、`rag_config`（配置）。

**Q11：为什么分块数比我预期的少/多？**
`paragraph` 策略会把**相邻的短段落合并**到接近 `chunkSize`，所以段落多不等于分块多。`token` 策略的 size 是 token 而非字符（见 1.3 的警告）。

**Q12：支持 PDF / Word 吗？**
目前只接受纯文本和 URL。PDF / docx 需要先自行转成文本再粘贴。

---

## 5. 相关 API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/knowledge/ingest` | 灌入 `{ title, text }` 或 `{ title, url }`；传 `{ async: true }` 走后台队列 |
| GET | `/api/knowledge/ingest/jobs` · `/ingest/jobs/:id` | 异步灌入任务列表 / 单个任务状态 |
| POST | `/api/knowledge/search` | `{ query, topK }` → 命中片段 |
| GET | `/api/knowledge/config` | 读取当前 RAG 配置 |
| PUT | `/api/knowledge/config` | 更新配置（字段做了白名单 + 范围校验；换模型自动 bump embedding_version） |
| POST | `/api/knowledge/rebuild` | 全量重新切分 + 向量化（换模型后必须执行） |
| GET | `/api/knowledge/index` | 索引后端状态（configured / effective / version / dim / indexedVectors / reason） |
| POST | `/api/knowledge/index/sync` | 仅重建 sqlite-vec 虚表（不调 embedding API） |
| GET | `/api/knowledge/docs` | 文档列表 + 分块总数 |
| DELETE | `/api/knowledge/docs/:id` | 删除文档（级联删分块与向量） |

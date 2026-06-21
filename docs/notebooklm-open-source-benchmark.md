# NotebookLM 开源项目后端对标调研

调研日期：2026-06-16
口径：不依赖 GitHub API，直接检索 GitHub 页面、仓库 README、license 文件和关键工程配置文件。Star 与最近提交时间来自 GitHub 仓库页面 HTML，属于当日近似快照，用于排序和活跃度判断，不作为长期固定指标。

## 结论

灵笔工作室后端优化不应直接照搬某一个 NotebookLM clone。更稳妥的参考组合是：

1. Open Notebook：参考 NotebookLM-like 产品闭环，包括 notebook、source、chat、content transformation、podcast、多 provider 配置。
2. RAGFlow：参考文档解析、chunking、grounded citation、复杂 PDF/Office 文档理解。
3. AnythingLLM：参考 workspace、document collector、vector DB 抽象、多模型和生产部署。
4. Onyx：参考企业级 ingestion、connector、异步队列、权限边界和检索服务分层。
5. SurfSense：参考多入口资料采集、浏览器/桌面/Obsidian 连接器和 research workflow。

Dify、Khoj、Quivr 可以作为旁证，但不应成为本轮 NotebookLM 后端对标主线。Dify 太泛平台，Khoj 更偏个人 AI/搜索，Quivr 最近活跃度相对弱。

## 候选矩阵

| 项目 | GitHub | Star 快照 | 最近提交快照 | 主定位 | 本轮判断 |
| --- | --- | ---: | --- | --- | --- |
| Open Notebook | https://github.com/lfnovo/open-notebook | 30,821 | 2026-06-02 | 自托管 NotebookLM 替代品 | 主参考 |
| RAGFlow | https://github.com/infiniflow/ragflow | 82,821 | 2026-06-11 | 文档理解 + RAG 引擎 | 主参考 |
| AnythingLLM | https://github.com/Mintplex-Labs/anything-llm | 61,630 | 2026-06-09 | AI workspace + 文档 RAG | 主参考 |
| Onyx | https://github.com/onyx-dot-app/onyx | 30,337 | 2026-06-12 | 企业搜索/RAG/connector | 主参考 |
| SurfSense | https://github.com/MODSetter/SurfSense | 14,713 | 2026-06-11 | NotebookLM-like research copilot | 次主参考 |
| Dify | https://github.com/langgenius/dify | 145,331 | 2026-05-19 | LLM app platform | 平台化旁证 |
| Khoj | https://github.com/khoj-ai/khoj | 35,142 | 2026-03-26 | 个人 AI / 搜索助手 | 旁证 |
| Quivr | https://github.com/QuivrHQ/quivr | 39,164 | 2025-02-04 | 第二大脑/RAG | 活跃度偏弱，旁证 |
| PageLM | https://github.com/CaviraOSS/pagelm | 1,658 | 页面未稳定解析 | 浏览器页面上下文 AI | 低优先级 |
| KnowNote | https://github.com/MrSibe/KnowNote | 1,007 | 2026-01-30 | 笔记/知识库 | 低优先级 |
| InsightsLM public | https://github.com/theaiautomators/insights-lm-public | 547 | 2026-01-15 | NotebookLM-like demo/产品 | 低优先级 |
| Notex | https://github.com/smallnest/notex | 215 | 2026-01-06 | NotebookLM-like | 低优先级 |
| AssistantMD | https://github.com/DodgyBadger/AssistantMD | 11 | 2026-06-12 | Markdown assistant | 不作为主参考 |
| nano-NotebookLM | https://github.com/ArthurYangX/nano-NotebookLM | 1 | 2026-05-22 | 极简 NotebookLM demo | 不作为主参考 |
| SmartDoc AI | https://github.com/dungtq2k5/smartdoc-ai | 0 | 2026-04-24 | 文档 AI demo | 不作为主参考 |
| notebooklm-clone | https://github.com/AkshaykumarLilani/notebooklm-clone | 0 | 页面未稳定解析 | clone demo | 不作为主参考 |
| Memorwise | https://github.com/robzilla1738/memorwise | 21 | 页面未稳定解析 | 记忆/学习工具 | 不作为主参考 |

## 深度拆解

### Open Notebook

适合参考的点：

- 产品形态最接近 NotebookLM：notebook、sources、notes、chat、search、podcast、content transformations。
- README 明确支持 PDF、视频、音频、网页、Office 文档等多模态资料。
- 支持 18+ AI providers，并包含 OpenAI Compatible、Ollama、Azure OpenAI、Mistral、OpenRouter 等。
- 工程证据：`pyproject.toml` 命中 FastAPI、LangChain、SurrealDB；README 标注 Python、FastAPI、Next.js、React、SurrealDB。
- License：MIT。

对灵笔工作室的启发：

- 我们已具备用户填写 API Base / API Key 的入口，但 provider 能力拆分还不够细。应该把 chat model、vision model、embedding model、TTS/STT model 分开建模。
- 我们现在的资料问答仍是把全文/摘要直接塞进 prompt，应该升级为 notebook/source/chunk/search/citation 的闭环。
- Open Notebook 的 REST API 和可部署形态值得参考，但不应照搬 SurrealDB，当前项目可以先用本地 JSON/SQLite/Postgres 之一做 source/chunk 存储抽象。

### RAGFlow

适合参考的点：

- 后端能力最硬，重点在 deep document understanding、template-based chunking、grounded citations、复杂文档解析。
- 工程证据：`pyproject.toml` 命中 Elasticsearch、S3、PDF、Mammoth；Docker 配置存在独立服务栈。
- 对 PDF/Office 文档的解析与 chunk 策略更适合做我们后端可用性优化基线。
- License：Apache License。

对灵笔工作室的启发：

- 上传后不能只返回一个大段 `rawContent`。需要保存 `sourceId -> pages -> chunks -> extractionStatus`。
- chat 需要先检索相关 chunks，再把 `sourceId/page/snippet` 作为引用上下文传给模型。
- 生成报告、知识卡片、PPT 大纲也应该复用同一套 grounded chunks，而不是各路由各自拼 prompt。

### AnythingLLM

适合参考的点：

- 成熟的 workspace + document collector + vector DB 管线。
- README 明确支持 PDF/TXT/DOCX 等文档、拖拽上传、source citations、Developer API、多用户、生产部署。
- 工程证据：`server/package.json` 命中 LangChain、Qdrant、Milvus、LanceDB、Prisma、Express、PDF；`collector/package.json` 命中 LangChain、Express、PDF、Mammoth。
- 支持多 LLM、embedding、speech、TTS、vector database provider，包括 Generic OpenAI-compatible embedding APIs。
- License：MIT。

对灵笔工作室的启发：

- 应把当前 `upload` 路由中的解析逻辑拆出 collector-like 层，至少形成 `extract -> normalize -> chunk -> index -> summarize` 五步。
- 模型设置需要继续补 `embeddingModel` 和 `embeddingApiBase`，否则无法稳定支持大文档 RAG。
- 生产部署应该有明确的 storage/vector backend 配置，而不是只靠 `public/uploads` 或一次性内存数据。

### Onyx

适合参考的点：

- 企业级 RAG/搜索项目，重在 connectors、异步 ingestion、权限、队列和检索服务化。
- 工程证据：`backend/requirements/default.txt` 命中 FastAPI、LangChain、Celery、Redis、S3、unstructured、PDF、Mammoth；`web/package.json` 命中 Next/React。
- 最近提交活跃，适合参考工程化边界。
- License：主体 MIT Expat，但 `ee` 目录是企业 license，引用代码时需避开企业目录。

对灵笔工作室的启发：

- 当前 `upload` 内部 fire-and-forget 调 MinerU，状态不可追踪。应该引入 job 状态，即使先不用 Redis/Celery，也要有 `pending/running/succeeded/failed`。
- 需要把“用户问题 -> 检索 -> rerank -> answer -> citations”拆成后端管线，而不是单个 chat route 直接调用 LLM。
- 公网版本需要 request timeout、重试、错误分类和日志脱敏策略。

### SurfSense

适合参考的点：

- 是 NotebookLM-like research copilot，覆盖 web、backend、browser extension、desktop、Obsidian、evals。
- 工程结构证据：根目录含 `surfsense_backend`、`surfsense_web`、`surfsense_browser_extension`、`surfsense_desktop`、`surfsense_obsidian`、`surfsense_evals`。
- `surfsense_backend/pyproject.toml` 命中 FastAPI、LangChain、Llama、PGVector、Postgres、Celery、Redis。
- `docker/docker-compose.yml` 命中 FastAPI、PGVector、Postgres、Celery、Redis、Next。
- License：Apache License。

对灵笔工作室的启发：

- 可以参考它的多入口采集和 evals 思路，但现阶段不要展开浏览器扩展/桌面端，否则偏离主线。
- 比较适合后续加“网页收藏、浏览器资料采集、Obsidian 导入”时再深入。

## 当前项目差距

现有灵笔工作室后端已经完成：

- 用户可填写 OpenAI-compatible API Base、API Key、文本模型、视觉理解模型。
- Ark `/api/plan/v3` 这类 versioned base path 已可解析到 chat completions。
- `/api/ai/test-config` 已可做文本模型和视觉模型探测。
- 上传支持 PDF/DOCX/TXT/MD/CSV/XLSX/PPTX/图片等格式的基础解析。
- OpenAI-compatible smoke 已覆盖 test-config、chat、report、image vision routing、上传大小保护。
- 已接入 `@zvec/zvec` 本地向量库，支持 chunks embedding upsert 和 citation metadata 查询。
- 已新增本地 source store 和 ingestion 状态记录，上传后会保存 source/chunks、stage 状态和可选 vector index 状态。
- Source store 已抽象为 adapter，默认 `local-json`，并已提供 `SOURCE_STORE_ADAPTER=postgres` 的 Postgres 实现；当前 Postgres adapter 保留 `lingbi_source_store.payload jsonb` 兼容快照，同时同步维护 `lingbi_sources`、`lingbi_source_chunks`、`lingbi_ingestion_stages` 三张规范化表。
- `/api/health` 已暴露 source store 与 vector store 状态，`/api/ingestion/sources` 可查询后端 ingestion 结果。
- `/api/ai/chat` 已通过 `grounded-retrieval` 优先查询持久化 zvec，其次查询持久化 chunks 关键词检索，最后才回退请求内 selected papers。
- `/api/ai/chat` 支持 `debugRetrievalOnly`，可在不调用模型的情况下验证 grounded citations 和 retrieval mode。
- 前端资料库已保存并同步后端 ingestion/vector 状态，资料卡片会显示 `片段 n`、`索引 n`、`索引中` 或 `索引失败`。
- 知识卡片和报告接口已复用 `grounded-retrieval`，前端会传入选中资料 id/fileName/fileType，路由可按持久化 source scope 生成 grounded 产物。
- 播客接口已修正前端 `content` 字段与后端 `text` 字段不一致的问题，并复用 `grounded-retrieval` 为播客脚本提供同一套 citation 证据；同时新增 Doubao AgentPlan TTS provider，按 `Doubao AgentPlan TTS_TTS_ENDPOINT=https://Doubao AgentPlan TTS.bytedance.com/api/v3/plan/tts/unidirectional`、`Doubao AgentPlan TTS_TTS_RESOURCE_ID=seed-tts-2.0`、`Doubao AgentPlan TTS_TTS_SPEAKER` 和私有 key 合成真实音频，响应带 `provider=Doubao AgentPlan TTS-tts-v3` 与 `audioUrl`。`RuntimeAIConfig.ttsSpeaker` 允许用户在模型设置里填写播客音色并随右侧播客请求发送，未填写时再回退部署环境。`pnpm test:studio-grounded-routes` 覆盖 debug 路径，`pnpm test:Doubao AgentPlan TTS-tts` 覆盖本地 provider 契约和 Doubao AgentPlan TTS 401 鉴权错误分类，`pnpm smoke:real-Doubao AgentPlan TTS-tts` 会直接跑真实 TTS 音频，`pnpm smoke:real-studio-products` 会在配置真实 TTS 后单独跑播客音频任务。
- 普通图像式 PPT 接口 `/api/ai/ppt` 已复用 `grounded-retrieval` 构建 evidence outline，前端会传入选中资料 id/fileName/fileType 和 aiConfig；`debugRetrievalOnly` 可在不触发生图的情况下验证 citation scope。
- 学术报告 PPT 接口 `/api/ai/ppt-v2` 已复用 `grounded-retrieval`，ArcDeck discourse parse / slide plan 优先读取持久化 evidence outline，PPTX 封面和文件元信息仍使用原始论文；`debugRetrievalOnly` 可在不触发 LLM/PPTX 构建的情况下验证 citation scope。
- Chat、报告与知识卡片接口已输出 `citationAudit`，服务端会识别模型未使用引用编号或引用了不存在的编号；前端对话区和右侧知识卡片区已展示通过、未标号或非法编号提示。debug 模式支持 `debugAnswerText` 做无外部模型 smoke，`pnpm test:citation-audit` 已纳入 `pnpm validate`。

主要缺口：

- MinerU 后台任务仍是独立 `mineruStatus`，还没纳入统一 ingestion stage。
- ingestion pipeline 已有 local-json/Postgres adapter 边界，Postgres 已具备规范化 `sources/chunks/stages` 写入契约；公网多实例高并发部署仍需把读路径迁移到规范化表，并补真实数据库 smoke/迁移脚本。
- Chat/报告/知识卡片已经返回后端 citation metadata，具备服务端 citation 编号审计，并已在前端展示 `citationAudit` 结果；Studio PPT、播客脚本等其它生成类产物后续也应逐步接入相同审计。
- Studio 生成类能力已经统一具备 grounded retrieval debug path，播客已从“只验证脚本证据”推进到可真实 TTS 音频产出的 provider 契约；当前真实基线显示 Ark 文本/embedding 可用但 Doubao AgentPlan TTS 可能需要独立有效 key，若上游返回 `Invalid X-Api-Key`，后端会分类为 `auth` 并让前端给出可恢复提示。下一步重点转向 MinerU 纳入统一 ingestion stage、生产存储适配、Studio 长文本产物 citation audit 复用，以及用真实 AgentPlan/Doubao/Ark 环境持续验证播客音频质量和耗时。

## 建议落地路线

### P0：把资料库从 UI 状态升级为后端对象

新增最小数据结构：

- `Source`：`id`、`fileName`、`fileType`、`status`、`createdAt`、`error`、`storageKey`。
- `SourceChunk`：`id`、`sourceId`、`page`、`chunkIndex`、`text`、`tokenEstimate`、`metadata`。
- `Citation`：`sourceId`、`chunkId`、`page`、`snippet`、`score`。

先不必一上来引入完整向量库。可以先做 keyword/BM25-like 检索或内存检索，把接口形态定下来，再替换为 embedding/vector store。

### P1：重构上传为 ingestion pipeline

目标流程：

`upload -> store -> extract -> normalize -> chunk -> summarize -> index -> ready`

每一步都要有可返回给前端的状态。上传路由不要把所有工作压在一次请求里；至少要把耗时 OCR/MinerU 标记成异步 job。

### P2：重构 chat 为 grounded answer

目标流程：

`question -> retrieve chunks -> build grounded prompt -> stream answer -> return citations`

SSE 可以继续保留，但需要在流结束或单独接口返回 citations。回答中出现的 `[1]` 应该能映射到真实 `sourceId/page/snippet`。

### P3：统一生成类能力

报告、知识卡片、播客、PPT 不应各自重新分析全文。它们应复用同一套 retrieval context：

- 报告：按主题聚合 chunks。
- 知识卡片：按术语/论点抽取 chunks。
- 播客：先生成可引用脚本，再通过 Doubao AgentPlan TTS provider 合成真实音频，并把音频生成 PASS/FAIL/SKIP 与 grounded citations 分开报告。
- PPT：先生成 evidence outline，再生成页面。

### P4：补工程化和发布能力

- 新增 `pnpm test:ingestion`，覆盖 extract/chunk/retrieve/citation。
- 扩展 `pnpm smoke:openai-compatible`，加入“小文档上传 -> 检索问答 -> 引用返回”。
- `/api/health` 增加 vector store、storage、mineru、default model、user-config proxy 安全开关状态。
- 文档补 `EMBEDDING_API_BASE`、`EMBEDDING_MODEL`、`VECTOR_STORE`、`DATABASE_URL` 或替代最小本地存储方案。

## 本轮调研是否足够

足够支撑下一步后端实现，不足以支撑“完整复刻某个开源项目”。

足够的原因：

- 覆盖了 17 个相关仓库，而不是只看 NotebookLM clone 标题。
- 用 star、最近提交、license、README 能力、关键工程配置文件做了交叉判断。
- 明确区分了产品形态参考和后端能力参考。
- 已经映射到灵笔工作室现有代码的具体缺口。

仍需继续压实的点：

- 如果要正式借鉴某个仓库的具体实现，需要按 license 逐文件审查，不直接复制代码。
- RAGFlow/Onyx 的完整 ingestion 细节很大，本轮只做架构级参考。
- 下一步实现前，应先确定我们第一阶段使用本地 JSON/SQLite/Postgres 哪一种持久化方式。

## 参考入口

- Open Notebook: https://github.com/lfnovo/open-notebook
- SurfSense: https://github.com/MODSetter/SurfSense
- RAGFlow: https://github.com/infiniflow/ragflow
- Onyx: https://github.com/onyx-dot-app/onyx
- AnythingLLM: https://github.com/Mintplex-Labs/anything-llm
- Dify: https://github.com/langgenius/dify
- Khoj: https://github.com/khoj-ai/khoj
- Quivr: https://github.com/QuivrHQ/quivr

## 2026-06-17 结构化产品改造结果

本轮不再把工程化 smoke 当主线，而是按 NotebookLM-like 用户能力做真实产品路径验收。

对标转化：

- NotebookLM：中心对话、右侧 Studio、引用可追溯、失败/降级可见成为验收门；`smoke:workbench-studio-ui` 和 `smoke:studio-evidence-ui` 已验证无资料态、有资料态、右侧 prompt 入中央对话、PPT/报告/知识卡片/播客长任务文案、证据 badge、citation audit 和引用片段展开。
- Open Notebook：将 sources/chat/Studio 产物复用同一上下文的思路落到后端契约；`smoke:real-studio-products` 已验证知识卡片、报告、播客和 PPT-v2 均使用持久化检索上下文。
- RAGFlow/Onyx：把 ingestion/status/error/retry 与引用溯源作为产品路径验证，而不是只看上传成功；当前真实 Studio smoke 已覆盖上传后 chunks、retrieval mode、citation count 和 citationAudit。
- ArcDeck/banana-slides：PPT-v2 不再接受“看起来有文件但内部 fallback”的结果。discourse/slide structure/critic/commitment 改为确定性证据路径，严格要求 `observability.fallbacks=0`；真实 PPTX 生成已通过，文件大小约 102 KB，6 页 slide XML，无 `待补充/TODO/占位` 文本，并用 `pnpm audit:pptx-quality` 检查非封面页文本密度。

真实结果基线：

- `pnpm smoke:real-openai-compatible`：PASS，真实 Ark/OpenAI-compatible 文本、embedding、zvec upsert/query 均通过。
- `pnpm smoke:real-Doubao AgentPlan TTS-tts`：PASS，Doubao AgentPlan TTS 真实返回本地音频 URL。
- `pnpm smoke:real-studio-products`：PASS，上传、知识卡片、报告 SSE、播客 grounded context、Doubao AgentPlan TTS 真音频、PPT-v2 真 PPTX 全部通过；PPT-v2 `fallbacks=0`。
- `pnpm smoke:workbench-studio-ui`：PASS，覆盖右侧 Studio 无资料/有资料、PPT/报告/知识卡片/播客按钮、长任务等待文案、取消与恢复。
- `pnpm smoke:studio-evidence-ui`：PASS，覆盖可见引用审计、检索 badge、引用来源展开和前端不泄露 API key。

2026-06-17 PPT-v2 质量门补测：

- 当前基线：`pnpm audit:pptx-quality` 对上一份真实 PPTX 失败，6 页中最后一页只有 18 字，说明“真实生成文件”仍可能不等于“可交付内容”。
- 改后结果：PPT-v2 关闭页升级为三条可交付总结和追问提示，`draftStructure` 改为确定性 NotebookLM-like 学术结构，避免结构阶段慢模型超时触发 fallback；`pnpm generate:real-ppt-v2` 严格模式 PASS，耗时约 270s，4 次真实模型调用全部成功，`fallbacks=0`。
- 文件审计：`pnpm audit:pptx-quality` PASS，最新真实 PPTX 6 页、104695 bytes、占位符 0、薄页 0，非封面页文本长度分别为 166/165/159/164/80。
- Studio 回归：`pnpm smoke:real-studio-products` PASS，真实上传、persisted-vector 检索、知识卡片、报告 SSE、播客 Doubao AgentPlan TTS 真音频和 PPT-v2 全链路通过；`pnpm smoke:workbench-studio-ui` PASS，右侧 PPT/报告/知识卡片/播客的无资料态、有资料态、长任务等待/取消/恢复文案仍可用。
- 部署包回归：`pnpm smoke:linux-package-products` 先失败后修复。失败点包括 bundle manifest 未列 `smoke:runtime-health`，以及 Linux 包夹带 `public/uploads`、`public/mineru-figures` 运行期目录；修复后最新包通过，包含真实服务/Studio/PPTX 质量验收入口，且排除 `.env.real.local`、`.data`、`.logs` 和运行期 public 产物。

仍不足：

- 真实 Studio smoke 仍使用 local-json source store；服务器级部署还需要真实 Postgres、对象存储和 Linux clean-room 部署验证。
- PPT-v2 已有文件级文本密度门槛，但还没有视觉布局评分、图表截图比对和讲稿质量评分。
- 真实 Studio smoke 总耗时仍在数分钟级，下一轮应把长任务阶段耗时持久化为可对比 evidence，前端展示更细阶段和预计等待原因。

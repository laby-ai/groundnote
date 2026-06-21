# 参考项目许可与品牌风险登记

本项目可以参考开源项目的产品流程、数据契约和工程边界，但默认不复制外部项目的 UI 壳、品牌词、图标、字体、完整页面、企业版目录或许可证不清晰的子包。

## 执行规则

- 新增 `.references/*` 前，必须登记项目来源、license、子包例外和可复用边界。
- 任何用户可见文案、按钮、导出产物、截图和默认路由，不得出现参考项目品牌名。
- 直接复制代码前必须逐文件确认 license；没有逐文件确认时，只允许做干净重实现。
- GPL/AGPL/LGPL、企业版目录、字体包、素材包和商标资源默认视为高风险，需要隔离或不用。
- MIT/Apache 也不等于可以复制品牌和视觉系统；仍需去品牌化与独立前端壳。

## 当前项目内参考

| 参考项目 | 本地/文档位置 | 许可结论 | 风险点 | 允许复用 | 禁止默认复用 |
| --- | --- | --- | --- | --- | --- |
| OpenMAIC | `.references/OpenMAIC` | 根项目 MIT；README 明确有子包例外 | `packages/mathml2omml` 为 LGPL-3.0-or-later；renderer 字体有单独许可；品牌、营销页、公网入口和原始视觉壳不能外露 | 课程大纲、场景确认、讲解/测验/项目任务、进度、导出流程结构；本地 sidecar 课堂运行时可作为灵笔中间工作区内嵌过渡方案 | OpenMAIC/MAIC 名称、原公网入口、原 logo/banner、原字体包、子包代码、直接暴露原视觉壳 |
| Hyper-Extract | `.references/Hyper-Extract` | Apache-2.0 | 如直接复制源代码，必须保留 Apache-2.0 版权与许可声明；不把项目名、仓库名或文档路径暴露给最终用户 | 实体/关系抽取契约、节点与边的去重、边端点校验、关系网络优先的交互思路 | Hyper-Extract 名称、仓库链接、原 README/CLI 文案、未登记的直接代码复制 |
| Graphify | `.references/graphify` | MIT | 如直接复制源代码，必须保留 MIT 版权与许可声明；不把项目名、仓库名、CLI 文案或原可视化壳暴露给最终用户 | 节点/边 schema、sourceFile/fileType/label 约束、EXTRACTED/INFERRED/AMBIGUOUS 置信度、中心节点与问题分析思路、HTML graph 的搜索/详情/邻居交互结构 | Graphify 名称、仓库链接、原 CLI 文案、原 HTML/CSS/JS 可视化实现整体搬入 |
| vis-network | `package.json` / `node_modules/vis-network` | Apache-2.0 OR MIT | 作为运行时依赖使用；不得把示例页、品牌名或文档链接展示给最终用户 | 物理布局、拖拽缩放、箭头边、虚线边、节点点击与搜索交互运行时 | 示例页面、项目品牌、文档原文、未经审查的 demo 代码 |
| Open Notebook | `docs/notebooklm-open-source-benchmark.md` | MIT | 产品形态接近，容易照搬 UI/后端假设 | notebook/source/chat/podcast/content transformation 的流程参考 | 直接复制代码或品牌 |
| RAGFlow | `docs/notebooklm-open-source-benchmark.md` | Apache License | 大型后端栈和文档解析实现复杂 | 文档解析、chunking、grounded citation 思路 | 直接搬服务栈或具体解析实现 |
| AnythingLLM | `docs/notebooklm-open-source-benchmark.md` | MIT | workspace/document collector/vector DB 实现可借鉴但不要混入品牌 | collector-like 管线、workspace 抽象、多 provider 思路 | 直接复制 UI、API 表层或品牌 |
| Onyx | `docs/notebooklm-open-source-benchmark.md` | 主体 MIT Expat；`ee` 目录企业 license | 企业版目录必须避开 | connector、异步 ingestion、权限边界、检索服务分层 | `ee` 目录、企业许可代码 |
| SurfSense | `docs/notebooklm-open-source-benchmark.md` | Apache License | 入口多，容易偏离当前产品主线 | 多入口资料采集、evals、research workflow | 浏览器扩展/桌面端代码直接混入主线 |

## 之前工作区记忆中的参考

| 参考项目 | 许可/风险记忆 | 当前策略 |
| --- | --- | --- |
| Magic | modified Apache-style，存在额外商业、多租户、品牌限制 | 不作为可复制前端壳；只做抽象级参考 |
| TopicLab | MIT | 可作为较安全的视觉/流程参考，但仍需独立品牌 |
| OpenWork | 需单独审查 license 和 `/ee` 边界 | 不进入当前主线，若重启该方向先做 license audit |
| AgentScope | runtime/core 层参考，不是 UI/workbench 参考 | 不把旧架构假设带入当前前端 |

## 落地检查项

- UI 搜索：`OpenMAIC|MAIC|Hyper-Extract|Graphify|graphify|Magic|OpenWork|TopicLab|AgentScope|Coze|OpenSpeech` 不应出现在用户可见文案。
- 产物搜索：导出的 Markdown/PPTX/HTML/MP3 metadata 不应包含参考项目品牌名。
- 路由检查：默认产品路由不得跳转到外部参考项目；本地 sidecar iframe 只能作为灵笔工作区内的课堂运行时。
- 依赖检查：引入新 package 前确认 license；LGPL/GPL/AGPL 依赖必须有明确隔离方案。

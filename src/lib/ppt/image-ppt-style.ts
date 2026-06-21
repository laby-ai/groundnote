// Image PPT style presets and prompt knobs are kept outside the route so the API handler stays focused on orchestration.
interface PresetStyleDef {
  id: string;
  name: string;
  nameEn: string;
  color: string;
  description: string; // full visual description for image generation prompt
}

const PRESET_STYLES: Record<string, PresetStyleDef> = {
  'business-simple': {
    id: 'business-simple',
    name: '简约商务',
    nameEn: 'Business Simple',
    color: '#0B1F3B',
    description: `全局视觉语言严格对齐国际顶级咨询公司通用商务范式，强调专业、稳重、克制与可复用。全稿采用极致扁平化与强秩序网格，以信息清晰传达为唯一优先级。禁止渐变、发光、高光、拟物纹理、装饰性背景图案与任何非必要视觉元素。

配色：背景色为海军蓝或低饱和度渐变。分割线使用浅灰（#E5E7EB）。材质为平滑矢量色块，不使用纸张纹理或金属拟态。

排版：严格模块化网格系统，统一对齐规则与基线系统。页面结构固定为几何分区：标题区、主图区、要点区、结论区；分区边界使用1px细线划分。字体为无衬线体系：英文Roboto，中文思源黑体。

插图：所有视觉素材必须采用矢量插画形式，统一为线稿，关键部件用浅色或亮色点亮。禁止彩色照片和写实渲染。图表为2D扁平矢量，仅允许柱状图、折线图、流程框图。`,
  },
  'tech-modern': {
    id: 'tech-modern',
    name: '现代科技',
    nameEn: 'Tech Modern',
    color: '#7C3AED',
    description: `融合赛博朋克与现代SaaS产品的未来感。整体氛围神秘、深邃且富有动感，仿佛置身于高科技数据中心或虚拟空间。光照采用暗调环境下的自发光效果，模拟霓虹灯管和激光的辉光。

配色：背景色采用深邃午夜黑（#0B0F19）。主色调使用高饱和度电光蓝（#00A3FF）与赛博紫（#7C3AED）进行线性渐变，营造流动的能量感。材质上大量运用半透明玻璃、发光网格线以及带有金属光泽的几何体。

内容：画面中应包含悬浮的3D几何元素（立方体、四面体或芯片结构），这些元素应带有线框渲染效果。数据流以发光粒子或光纤束的形式穿梭其中。界面元素采用玻璃态设计（Glassmorphism）：半透明白色圆角卡片配合细微白色边框和背景模糊效果。

渲染：C4D+Octane渲染风格，强调体积光（Volumetric Lighting）和次表面散射（Subsurface Scattering），整体呈现电影级科幻质感。`,
  },
  'academic-formal': {
    id: 'academic-formal',
    name: '学术正式',
    nameEn: 'Academic Formal',
    color: '#1E3A5F',
    description: `经典论文/高质量学术报告风格，对标Nature/Science/Cell期刊内页排版标准。整体氛围严谨、克制、理性、学术权威感。无方向性阴影。

配色：纯白背景（#FFFFFF）。主色为黑色（#000000）和炭灰（#374151），用于标题和正文。深蓝作为唯一强调色，使用量不超过页面面积的15%，仅用于关键数据高亮或章节标记或banner。

排版：Times New Roman / Garamond 类衬线字体用于所有标题（一级28pt加粗、二级22pt半粗）。正文使用同族衬线体14-16pt。宽页边距（左右各≥15%），内容区采用左右分栏或上下严格对齐网格布局。行距1.5倍，段落间距固定。

视觉元素：主要装饰为细黑线（0.5pt）分隔线、三线表（仅上下及表头横线）、黑白线稿插图。图表采用极简线条风格，坐标轴带刻度标注和数据来源脚注。禁止书本边框、卷角效果、投影阴影、立体边框、三维背景、渐变填充、纹理贴图。`,
  },
  'creative-fun': {
    id: 'creative-fun',
    name: '创意趣味',
    nameEn: 'Creative Fun',
    color: '#FF6A00',
    description: `活泼有趣的创意演示风格，适合教育科普、创意提案和年轻化品牌展示。整体氛围轻松、愉悦、富有想象力和亲和力。光照采用明亮温暖的日光效果，营造积极向上的感觉。

配色：色彩丰富但不杂乱，保持高对比度和可读性。

排版：圆润友好的字体选择（如Nunito、圆体字），标题可以适度使用艺术字效但不过度。版式布局灵活多变，可以使用非对称布局、倾斜元素、手绘风格的图标和插画。适当留白但不必过于规整。

插图：扁平矢量插画风格或手绘风格插图为主，角色造型简约可爱有趣，可以使用渐变色块、波浪线、圆点等装饰元素增加趣味性。图标采用圆角设计和柔和阴影。`,
  },
  'minimalist-clean': {
    id: 'minimalist-clean',
    name: '极简干净',
    nameEn: 'Minimalist Clean',
    color: '#6B7280',
    description: `极致简约的现代主义设计风格，遵循"少即是多"原则。整体氛围干净、通透、高级且专注。光照采用纯白漫射光，无任何方向性和阴影。

配色：纯白背景（#FFFFFF）为主，深灰（#111827）文字，中灰（#6B7280）次要信息。唯一强调色使用单一色彩（推荐黑色或深蓝），面积严格控制。禁止使用渐变、图案、纹理。

排版：大字号标题 + 充足留白是核心特征。字体选用精致的无衬线体（如Inter/Helvetica）。每页只传达一个核心观点，文字精炼到极致。对齐方式严格统一（左对齐或居中对齐二选一）。

插图：如果必须使用图片，仅允许高质量摄影作品或极简线条图标。禁止一切装饰性图形、阴影、边框。图表使用最简单的柱状图或数字本身。整体呈现Apple/Stripe级别的极简美学。`,
  },
  'luxury-premium': {
    id: 'luxury-premium',
    name: '奢华高级',
    nameEn: 'Luxury Premium',
    color: '#D4AF37',
    description: `高端奢华的品牌演示风格，对标奢侈品发布会和高端财经报告。整体氛围优雅、精致、富有质感和品位。光照采用柔和的侧光或背光，强调材质的光泽和层次。

配色：深色背景为主（深炭灰#1C1917或接近黑的深棕#292524），搭配金色（#D4AF37）或香槟金（#F7E7CE）作为强调色。文字使用米白（#FAFAF9）或浅金。禁止使用高亮度色彩和廉价感的荧光色。

排版：使用精致的衬线字体（如Playfair Display/Didot）作为标题，展现优雅气质。正文使用干净的无衬线体。大量运用留白创造高级感。版式讲究对称美和黄金比例。

材质：强调物理材质的真实表现——金属光泽、皮革纹理、丝绸质感、大理石纹路。适当使用金色装饰线条和边框。图表使用精致的金色线条和优雅的数据可视化样式。整体呈现 Vogue 杂志或 Apple Pro 产品发布会的品质感。`,
  },
  'nature-fresh': {
    id: 'nature-fresh',
    name: '自然清新',
    nameEn: 'Nature Fresh',
    color: '#14532D',
    description: `唤起对自然的向往、环保意识和健康生活的风格，类似 Whole Foods 或 Aesop 品牌视觉。整体氛围治愈、透气、有机。光照模拟清晨阳光透过树叶的丁达尔效应，温暖柔和。

配色：柔和米色背景（#EAD9C6）。调色板取自大自然：森林绿（#14532D）、大地棕（#7A4E2D）、天空蓝（#38BDF8）。材质强调自然纹理如再生纸颗粒感和植物叶脉。

内容：场景应融入真实自然元素，主要以延伸的绿色植物叶片作为背景装饰或前景框架。排版使用圆润友好的字体。布局可以略微松散，模仿自然生长模式。阴影处理柔和自然，避免生硬的黑色投影。

渲染：微距摄影风格结合3D渲染，强调植物表面的次表面散射和细腻的自然材质纹理，呈现清新雅致、令人心旷神怡的画面。`,
  },
  'gradient-vibrant': {
    id: 'gradient-vibrant',
    name: '渐变活力',
    nameEn: 'Gradient Vibrant',
    color: '#2563EB',
    description: `对标现代科技独角兽公司（如 Stripe 或 Linear）网站视觉，呈现极光般的流动美感。整体氛围梦幻、通透、呼吸感强，避免生硬的色彩碰撞，强调优雅的色彩融合。

配色：背景即前景，使用全屏扩散渐变。调色板使用优雅和谐的"全息色"，以深邃皇家蓝（#2563EB）为基础平滑过渡到紫罗兰（#7C3AED）和亮品红（#DB2777）。色彩像水彩一样融合，没有硬边界。材质锁定为"磨砂玻璃"纹理，使色彩仿佛透过哑光屏幕发光，增添优雅朦胧感。

内容：视觉核心由缓慢流动的有机波浪形状组成，形态柔和自然。排版使用粗体无衬线字体，文字颜色为纯白（#FFFFFF）以确保在多彩背景上的绝对清晰度。界面元素采用玻璃态——高透明白色圆角卡片配合细微白边和背景模糊效果。

渲染：C4D流体模拟渲染，强调"丝绸般"光滑光泽，带有细微颗粒作为纹理。色彩饱和但不刺眼，呈现彩虹般现代数字美学。`,
  },
};

/** 前端 style id → 后端预设 key 映射 */
const STYLE_ID_MAP: Record<string, string> = {
  'academic': 'academic-formal',
  'modern': 'minimalist-clean',
  'tech': 'tech-modern',
  'nature': 'nature-fresh',
  'elegant': 'luxury-premium',
  'creative': 'creative-fun',
  'minimalist': 'minimalist-clean',
  'gradient': 'gradient-vibrant',
  'business': 'business-simple',
};

/** 获取风格描述：优先用自定义模板风格，否则从预设风格获取 */
export function getStyleDescription(styleId?: string, customStyle?: string): string {
  // Map frontend style id to backend preset key
  const mappedKey = styleId ? (STYLE_ID_MAP[styleId] || styleId) : undefined;
  // Prefer preset style description (more detailed than the short visualPrompt)
  if (mappedKey && PRESET_STYLES[mappedKey]) return PRESET_STYLES[mappedKey].description;
  // Also try direct key
  if (styleId && PRESET_STYLES[styleId]) return PRESET_STYLES[styleId].description;
  // Fallback to custom style visual prompt
  if (customStyle) return customStyle;
  return PRESET_STYLES['academic-formal'].description; // 默认学术正式
}

// ============================================================
// Detail Level Specs (from banana-slides DETAIL_LEVEL_SPECS)
// ============================================================
export const DETAIL_LEVEL_SPECS: Record<string, string> = {
  concise: '文字极致地压缩和精简，每条要点用一个核心词语或数据代替，例如效率↑80%',
  default: '清晰明了，每条要点控制在15-20字以内, 避免冗长的句子和复杂的表述',
  detailed: '忠于原文的基础上做到内容详实，逻辑清晰。',
};

export const PPT_LANG_INSTRUCTION: Record<string, string> = {
  zh: 'PPT文字请使用全中文。',
  en: 'Use English for PPT text.',
  ja: 'PPTのテキストは全て日本語で出力してください。',
  auto: '',
};

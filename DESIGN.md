# DESIGN.md

## 气质与意象
iOS 26 HDMI 液态玻璃（Liquid Glass）。整个界面如同悬浮在彩色光球之上的半透明玻璃面板，折射背景流光，边缘带有极细高光线，内部有柔和光晕。深色模式下：纯黑底色 + 紫/粉/青三色氛围光球，玻璃为白色半透明；浅色模式下：近白底色 + 柔和彩色光球，玻璃为高白透明。

## 视觉策略
- 所有面板、卡片、按钮、输入框均为液态玻璃质感：`backdrop-filter: blur(24px) saturate(180%)`
- 多层 box-shadow：外层大阴影 + inset 顶部极细高光 + inset 底部微反光 + inset 内部柔和光晕
- 半透明渐变背景：135deg 从 `rgba(255,255,255,0.15)` 到 `rgba(255,255,255,0.02)`
- 鼠标悬停时玻璃面出现追踪光源（radial-gradient overlay + mix-blend-mode: overlay）
- 页面底层有 2-3 个大型模糊色球缓慢浮动（ambient blobs），为玻璃折射提供色彩

## 配色方案
- 深色背景：#050505
- 浅色背景：#f5f5f7
- 氛围光球：紫 #431cff、粉 #ff2a5f、青 #00d4ff（深色）；浅紫/浅粉/浅青（浅色）
- 玻璃边框：rgba(255,255,255,0.2)（深色）；rgba(255,255,255,0.5)（浅色）
- 保留原有 accent 颜色（blue/purple/emerald/amber/red/cyan）

## 字体排版
- 系统字体栈：-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue"
- 标题：大号加粗，渐变文字（白→灰）
- 正文：轻量，次级色

## 动效与交互
- 氛围光球：10s ease-in-out 无限交替浮动（translate + scale）
- 玻璃 hover：光源跟随鼠标，0.3s 淡入
- 按钮点击：scale(0.97) 回弹
- 面板切换：0.6s cubic-bezier(0.16, 1, 0.3, 1) 过渡
- 背景光球位移：cubic-bezier(0.4, 0, 0.2, 1) 缓动

## 页面结构
- 全屏三栏布局，每栏均为液态玻璃面板
- 面板间分隔线为半透明线 + 中心圆点
- Studio 面板顶部 tab 网格为玻璃胶囊
- 知识卡片保留 3D 翻转 + 液态玻璃质感增强
- 导航栏为玻璃毛条

## 浅色模式视觉规范
- 背景：#f5f5f7 近白，微透明底层
- 氛围光球：浅紫 #8b5cf6/浅粉 #f472b6/浅青 #22d3ee，opacity 0.15~0.22，blur 120px
- 玻璃面板：高白透明 rgba(255,255,255,0.45~0.6)，border rgba(0,0,0,0.06)
- 色散偏移 1px（深色2px），焦散透明度降低
- 折射边缘光柔和 4px（深色8px），pastel色调
- 文字：#1d1d1f 主色，#6e6e73 次色，#aeaeb2 弱色
- 阴影：rgba(0,0,0,0.04) 小阴影，inset高光 rgba(0,0,0,0.03)
- hover-light：白色 radial-gradient，opacity 0.25

## 设计禁忌
- 禁止纯色不透明背景块——所有容器必须有玻璃折射
- 禁止扁平无边框区域——必须有至少 1px 半透明边框
- 禁止硬阴影——所有阴影必须多层叠加、柔和扩散
- 禁止无 backdrop-filter 的面板——必须有 blur + saturate

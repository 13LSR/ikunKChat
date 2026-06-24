STYLEKIT_STYLE_REFERENCE
style_name: 新拟物派
style_slug: neumorphism
style_source: /styles/neumorphism

## 项目上下文
- 项目类型: 其他

# Hard Prompt

## 什么时候用
当你希望 AI 严格按风格规则生成代码时使用。它是生产界面最稳的默认选择。

## 怎么用
- 把完整提示词复制到 ChatGPT、Claude、Cursor 或其他编码助手。
- 在提示词后追加具体产品、页面或组件需求。
- 生成后按禁止项和交互状态检查，确认没有风格漂移。

请严格遵守以下风格规则并保持一致性，禁止风格漂移。

## 执行要求

- 优先保证风格一致性，其次再做创意延展。
- 遇到冲突时以禁止项为最高优先级。
- 输出前自检：颜色、排版、间距、交互是否仍属于该风格。

## Style Rules

# Neumorphism (新拟物派) Design System

> 柔和的内凹外凸立体效果，通过双重阴影模拟光源，浅色背景配同色系元素，营造精致的立体感。

## 核心理念

Neumorphism（新拟物派）是一种介于扁平设计和拟物设计之间的风格，通过柔和的阴影创造出元素从背景中"挤压"或"凹陷"的视觉效果。

核心理念：
- 柔和立体：通过双重阴影（亮/暗）模拟自然光源
- 同色系统一：元素与背景使用相同或相近的颜色
- 触感直觉：凸起表示可交互，凹陷表示已激活或输入区
- 克制装饰：避免过多颜色和对比，保持整体柔和感

设计原则：
- 视觉一致性：所有组件必须遵循统一的视觉语言，从色彩到字体到间距保持谐调
- 层次分明：通过颜色深浅、字号大小、留白空间建立清晰的信息层级
- 交互反馈：每个可交互元素都必须有明确的 hover、active、focus 状态反馈
- 响应式适配：设计必须在移动端、平板、桌面端上保持一致的体验
- 无障碍性：确保色彩对比度符合 WCAG 2.1 AA 标准，所有交互元素可键盘访问

---

## Token 字典（精确 Class 映射）

### 边框
```
宽度: border-0
颜色: border-transparent
圆角: rounded-xl
```

### 阴影
```
小:   shadow-[4px_4px_8px_#b8bcc2,-4px_-4px_8px_#ffffff]
中:   shadow-[6px_6px_12px_#b8bcc2,-6px_-6px_12px_#ffffff] md:shadow-[8px_8px_16px_#b8bcc2,-8px_-8px_16px_#ffffff]
大:   shadow-[8px_8px_16px_#b8bcc2,-8px_-8px_16px_#ffffff] md:shadow-[12px_12px_24px_#b8bcc2,-12px_-12px_24px_#ffffff]
悬停: hover:shadow-[4px_4px_8px_#b8bcc2,-4px_-4px_8px_#ffffff]
聚焦: focus:shadow-[6px_6px_12px_#b8bcc2,-6px_-6px_12px_#ffffff]
```

### 交互效果
```
悬停位移: undefined
过渡动画: transition-all duration-200
按下状态: active:shadow-[inset_4px_4px_8px_#b8bcc2,inset_-4px_-4px_8px_#ffffff]
```

### 字体
```
标题: font-semibold text-gray-800
正文: text-gray-600
```

### 字号
```
Hero:  text-4xl md:text-6xl
H1:    text-3xl md:text-4xl
H2:    text-2xl md:text-3xl
H3:    text-xl md:text-2xl
正文:  text-sm md:text-base
小字:  text-xs
```

### 间距
```
Section: py-12 md:py-20
容器:    px-6 md:px-8
卡片:    p-6 md:p-8
```

---

## [FORBIDDEN] 绝对禁止

以下 class 在本风格中**绝对禁止使用**，生成时必须检查并避免：

### 禁止的 Class
- `rounded-none`
- `rounded-sm`
- `shadow-sm`
- `shadow`
- `shadow-md`
- `shadow-lg`
- `shadow-xl`
- `shadow-2xl`
- `bg-black`
- `bg-white`
- `bg-gray-900`
- `bg-gray-950`
- `border-2`
- `border-4`
- `border-8`
- `border`
- `bg-gradient-to-r`
- `bg-gradient-to-l`
- `bg-gradient-to-t`
- `bg-gradient-to-b`

### 禁止的模式
- 匹配 `^rounded-none`
- 匹配 `^shadow-(?!\[|none)`
- 匹配 `^bg-gradient-`
- 匹配 `^border-[248]`
- 匹配 `^bg-black`
- 匹配 `^bg-white$`

### 禁止原因
- `rounded-none`: Neumorphism requires rounded corners (rounded-xl or rounded-2xl)
- `shadow-lg`: Neumorphism uses dual-shadow system, not standard shadows
- `bg-white`: Neumorphism uses light gray backgrounds (#e0e5ec), not pure white
- `bg-black`: Neumorphism uses light gray backgrounds, not black
- `border-2`: Neumorphism avoids visible borders, shadows create separation
- `bg-gradient-to-r`: Neumorphism uses solid colors, no gradients

> WARNING: 如果你的代码中包含以上任何 class，必须立即替换。

---

## [REQUIRED] 必须包含

### 按钮必须包含
```
bg-[#e0e5ec]
rounded-xl
shadow-[6px_6px_12px_#b8bcc2,-6px_-6px_12px_#ffffff]
hover:shadow-[4px_4px_8px_#b8bcc2,-4px_-4px_8px_#ffffff]
active:shadow-[inset_4px_4px_8px_#b8bcc2,inset_-4px_-4px_8px_#ffffff]
transition-all duration-200
```

### 卡片必须包含
```
bg-[#e0e5ec]
rounded-2xl
shadow-[8px_8px_16px_#b8bcc2,-8px_-8px_16px_#ffffff]
```

### 输入框必须包含
```
bg-[#e0e5ec]
rounded-xl
shadow-[inset_4px_4px_8px_#b8bcc2,inset_-4px_-4px_8px_#ffffff]
focus:shadow-[inset_6px_6px_12px_#b8bcc2,inset_-6px_-6px_12px_#ffffff]
focus:outline-none
placeholder:text-gray-400
transition-shadow duration-200
```

---

## [COMPARE] 错误 vs 正确对比

### 按钮

[WRONG] **错误示例**（使用了圆角和模糊阴影）：
```html
<button class="rounded-lg shadow-lg bg-blue-500 text-white px-4 py-2 hover:bg-blue-600">
  点击我
</button>
```

[CORRECT] **正确示例**（使用硬边缘、无圆角、位移效果）：
```html
<button class="bg-[#e0e5ec] rounded-xl shadow-[6px_6px_12px_#b8bcc2,-6px_-6px_12px_#ffffff] hover:shadow-[4px_4px_8px_#b8bcc2,-4px_-4px_8px_#ffffff] active:shadow-[inset_4px_4px_8px_#b8bcc2,inset_-4px_-4px_8px_#ffffff] transition-all duration-200 bg-[#ff006e] text-white px-4 py-2 md:px-6 md:py-3">
  点击我
</button>
```

### 卡片

[WRONG] **错误示例**（使用了渐变和圆角）：
```html
<div class="rounded-xl shadow-2xl bg-gradient-to-r from-purple-500 to-pink-500 p-6">
  <h3 class="text-xl font-semibold">标题</h3>
</div>
```

[CORRECT] **正确示例**（纯色背景、硬边缘阴影）：
```html
<div class="bg-[#e0e5ec] rounded-2xl shadow-[8px_8px_16px_#b8bcc2,-8px_-8px_16px_#ffffff] p-6 md:p-8">
  <h3 class="font-semibold text-gray-800 text-xl md:text-2xl">标题</h3>
</div>
```

### 输入框

[WRONG] **错误示例**（灰色边框、圆角）：
```html
<input class="rounded-md border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500" />
```

[CORRECT] **正确示例**（黑色粗边框、聚焦阴影）：
```html
<input class="bg-[#e0e5ec] rounded-xl shadow-[inset_4px_4px_8px_#b8bcc2,inset_-4px_-4px_8px_#ffffff] focus:shadow-[inset_6px_6px_12px_#b8bcc2,inset_-6px_-6px_12px_#ffffff] focus:outline-none placeholder:text-gray-400 transition-shadow duration-200 px-3 py-2 md:px-4 md:py-3" placeholder="请输入..." />
```

---

## [TEMPLATES] 页面骨架模板

使用以下模板生成页面，只需替换 `{PLACEHOLDER}` 部分：

### 导航栏骨架
```html
<nav class="bg-white border-b-2 md:border-b-4 border-black px-4 md:px-8 py-3 md:py-4">
  <div class="flex items-center justify-between max-w-6xl mx-auto">
    <a href="/" class="font-black text-xl md:text-2xl tracking-wider">
      {LOGO_TEXT}
    </a>
    <div class="flex gap-4 md:gap-8 font-mono text-sm md:text-base">
      {NAV_LINKS}
    </div>
  </div>
</nav>
```

### Hero 区块骨架
```html
<section class="min-h-[60vh] md:min-h-[80vh] flex items-center px-4 md:px-8 py-12 md:py-0 bg-{ACCENT_COLOR} border-b-2 md:border-b-4 border-black">
  <div class="max-w-4xl mx-auto">
    <h1 class="font-black text-4xl md:text-6xl lg:text-8xl leading-tight tracking-tight mb-4 md:mb-6">
      {HEADLINE}
    </h1>
    <p class="font-mono text-base md:text-xl max-w-xl mb-6 md:mb-8">
      {SUBHEADLINE}
    </p>
    <button class="bg-black text-white font-black px-6 py-3 md:px-8 md:py-4 border-2 md:border-4 border-black shadow-[4px_4px_0px_0px_rgba(255,0,110,1)] md:shadow-[8px_8px_0px_0px_rgba(255,0,110,1)] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all text-sm md:text-base">
      {CTA_TEXT}
    </button>
  </div>
</section>
```

### 卡片网格骨架
```html
<section class="py-12 md:py-24 px-4 md:px-8">
  <div class="max-w-6xl mx-auto">
    <h2 class="font-black text-2xl md:text-4xl mb-8 md:mb-12">{SECTION_TITLE}</h2>
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
      <!-- Card template - repeat for each card -->
      <div class="bg-white border-2 md:border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] md:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] p-4 md:p-6 hover:shadow-[4px_4px_0px_0px_rgba(255,0,110,1)] md:hover:shadow-[8px_8px_0px_0px_rgba(255,0,110,1)] hover:-translate-y-1 transition-all">
        <h3 class="font-black text-lg md:text-xl mb-2">{CARD_TITLE}</h3>
        <p class="font-mono text-sm md:text-base text-gray-700">{CARD_DESCRIPTION}</p>
      </div>
    </div>
  </div>
</section>
```

### 页脚骨架
```html
<footer class="bg-black text-white py-12 md:py-16 px-4 md:px-8 border-t-2 md:border-t-4 border-black">
  <div class="max-w-6xl mx-auto">
    <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
      <div>
        <span class="font-black text-xl md:text-2xl">{LOGO_TEXT}</span>
        <p class="font-mono text-sm mt-4 text-gray-400">{TAGLINE}</p>
      </div>
      <div>
        <h4 class="font-black text-lg mb-4">{COLUMN_TITLE}</h4>
        <ul class="space-y-2 font-mono text-sm text-gray-400">
          {FOOTER_LINKS}
        </ul>
      </div>
    </div>
  </div>
</footer>
```

---

## [CHECKLIST] 生成后自检清单

**在输出代码前，必须逐项验证以下每一条。如有违反，立即修正后再输出：**

### 1. 圆角检查
- [ ] 搜索代码中的 `rounded-`
- [ ] 确认只有 `rounded-none` 或无圆角
- [ ] 如果发现 `rounded-lg`、`rounded-md` 等，替换为 `rounded-none`

### 2. 阴影检查
- [ ] 搜索代码中的 `shadow-`
- [ ] 确认只使用 `shadow-[Xpx_Xpx_0px_0px_rgba(...)]` 格式
- [ ] 如果发现 `shadow-lg`、`shadow-xl` 等，替换为正确格式

### 3. 边框检查
- [ ] 搜索代码中的 `border-`
- [ ] 确认边框颜色是 `border-black`
- [ ] 如果发现 `border-gray-*`、`border-slate-*`，替换为 `border-black`

### 4. 交互检查
- [ ] 所有按钮都有 `hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px]`
- [ ] 所有卡片都有 hover 效果（阴影变色或位移）
- [ ] 都包含 `transition-all`

### 5. 响应式检查
- [ ] 边框有 `border-2 md:border-4`
- [ ] 阴影有 `shadow-[4px...] md:shadow-[8px...]`
- [ ] 间距有 `p-4 md:p-6` 或类似的响应式值
- [ ] 字号有 `text-sm md:text-base` 或类似的响应式值

### 6. 字体检查
- [ ] 标题使用 `font-black`
- [ ] 正文使用 `font-mono`

> CRITICAL: **如果任何一项检查不通过，必须修正后重新生成代码。**

---

## [EXAMPLES] 示例 Prompt

### 1. 智能家居控制面板

设备控制和状态展示

```
用 Neumorphism 风格设计一个智能家居控制面板，要求：
1. 背景：统一浅灰色 #e0e5ec
2. 设备卡片：凸起效果，显示设备图标和状态
3. 开关按钮：圆形，开启时凹陷 + 强调色图标
4. 温度滑块：凹槽轨道，凸起滑块
5. 场景按钮：按下时从凸起变凹陷
所有阴影使用双色：右下深色 + 左上亮色
```

### 2. 计算器应用

拟物风格计算器界面

```
用 Neumorphism 风格创建一个计算器界面，要求：
1. 外框：大圆角凸起容器
2. 显示屏：凹陷区域，深色背景，显示数字
3. 数字按钮：4x3 网格，凸起效果
4. 运算符：右侧一列，用强调色
5. 按下效果：从凸起变凹陷
背景色 #e0e5ec，阴影用 #a3b1c6 和 #ffffff
```

### 3. 音频控制器

音量和均衡器控制

```
用 Neumorphism 风格设计一个音频控制器，要求：
1. 主容器：大圆角凸起面板
2. 旋钮：圆形凸起，带刻度指示
3. 推子/滑块：垂直凹槽，凸起滑块
4. 均衡器：多个垂直滑块并排
5. 按钮：静音/预设等，按下时凹陷
保持统一的浅灰色调，通过阴影创造立体感
```

## 绝对禁止（匹配即拒绝）

以下模式一旦出现，视为风格违规——不找借口，直接重写。

- 使用纯黑或纯白背景
- 使用高对比度配色
- 使用粗边框 border-2 及以上
- 使用渐变背景 bg-gradient-*
- 直角 rounded-none
- 按钮使用任何 translate 位移（新拟物元素是长在背景上的，不可浮起）
- hover 时增大阴影（与光影物理规律相悖，手指靠近应使阴影缩小）
- 打破光源方向（亮阴影必须在左上 -X/-Y，暗阴影必须在右下 +X/+Y）

## 自检清单（交付前逐条确认）

如果任何一条不通过，说明风格漂移了——修改后再交付。

- [ ] 没有紫色到蓝色的渐变
- [ ] 没有使用 Inter / Roboto / Geist 等过度使用的字体
- [ ] 没有嵌套卡片（卡片里面套卡片）
- [ ] 没有在彩色背景上放灰色文字
- [ ] 正文对比度满足 WCAG AA（≥4.5:1）
- [ ] 没有 bounce / elastic 缓动曲线
- [ ] 动效有 prefers-reduced-motion 备选方案
- [ ] 正文行宽不超过 65-75 个字符
- [ ] 没有单侧粗边框装饰（border-left/right accent stripe）
- [ ] 没有渐变文字（background-clip: text）
- [ ] 没有把玻璃态（glassmorphism）当作默认风格
- [ ] 没有 tiny uppercase tracked eyebrow 放在每个 section 标题上面
- [ ] 禁止使用纯黑或纯白背景
- [ ] 禁止使用高对比度配色
- [ ] 禁止使用粗边框 border-2 及以上
- [ ] 禁止使用渐变背景 bg-gradient-*
- [ ] 禁止直角 rounded-none
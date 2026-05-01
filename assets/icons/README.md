# RSS Reader 插件图标需求清单

## 📋 图标目录结构

```
assets/
└── icons/
    ├── plugin-icon.svg          # 插件主图标（Dock 显示）
    ├── toolbar-add.svg          # 添加订阅源
    ├── toolbar-refresh.svg      # 刷新
    ├── toolbar-mark-read.svg    # 标记已读
    ├── toolbar-settings.svg     # 设置
    ├── toolbar-help.svg         # 帮助
    └── save-article.svg         # 保存文章到笔记
```

---

## 🎨 图标详细规格

### 1. 插件主图标 (plugin-icon.svg)
**用途**: Dock 栏和插件列表中显示的图标

**规格**:
- **尺寸**: 512x512 px（正方形）
- **格式**: SVG
- **风格**: 简洁、现代，符合思源笔记设计风格
- **颜色**: 建议使用主题色或中性色，支持暗色/亮色模式
- **内容建议**: RSS 符号、无线电波、或阅读相关图标

**参考**: 
- 思源笔记内置图标风格
- Material Design Icons - RSS
- Feather Icons - RSS

---

### 2. 工具栏图标系列

所有工具栏图标统一规格：

**通用规格**:
- **尺寸**: 24x24 px（ viewBox="0 0 24 24" ）
- **格式**: SVG
- **线条宽度**: 2px
- **风格**: 线性图标（outline），非填充
- **颜色**: 使用 `currentColor`（继承父元素颜色）

#### 2.1 添加订阅源 (toolbar-add.svg)
- **图标名称**: Add / Plus
- **描述**: 加号或添加符号
- **参考**: 
  - Material: `add`
  - Feather: `plus`
  - Heroicons: `plus`

#### 2.2 刷新 (toolbar-refresh.svg)
- **图标名称**: Refresh / Reload
- **描述**: 循环箭头或刷新符号
- **参考**:
  - Material: `refresh`
  - Feather: `refresh-cw`
  - Heroicons: `arrow-path`

#### 2.3 标记已读 (toolbar-mark-read.svg)
- **图标名称**: Check / Done / Eye
- **描述**: 对勾、眼睛或完成符号
- **参考**:
  - Material: `done_all` 或 `visibility`
  - Feather: `check` 或 `eye`
  - Heroicons: `check-circle`

#### 2.4 设置 (toolbar-settings.svg)
- **图标名称**: Settings / Gear / More
- **描述**: 齿轮或更多选项（三个点）
- **参考**:
  - Material: `settings` 或 `more_vert`
  - Feather: `settings` 或 `more-vertical`
  - Heroicons: `cog-6-tooth` 或 `ellipsis-vertical`

#### 2.5 帮助 (toolbar-help.svg)
- **图标名称**: Help / Question
- **描述**: 问号或帮助符号
- **参考**:
  - Material: `help` 或 `help_outline`
  - Feather: `help-circle`
  - Heroicons: `question-mark-circle`

---

### 3. 保存文章图标 (save-article.svg)
**用途**: 文章详情页的保存按钮

**规格**:
- **尺寸**: 24x24 px（ viewBox="0 0 24 24" ）
- **格式**: SVG
- **线条宽度**: 2px
- **风格**: 线性图标
- **颜色**: 使用 `currentColor`
- **描述**: 保存、下载或收藏符号
- **参考**:
  - Material: `save` 或 `bookmark`
  - Feather: `save` 或 `bookmark`
  - Heroicons: `bookmark`

---

## 🎯 推荐图标资源网站

### 免费图标库（推荐）

1. **Material Design Icons**
   - 网址: https://fonts.google.com/icons
   - 特点: Google 官方设计，风格统一，数量丰富
   - 下载: 选择 SVG 格式

2. **Feather Icons**
   - 网址: https://feathericons.com
   - 特点: 简洁优雅，开源免费
   - 下载: 直接复制 SVG 代码

3. **Heroicons**
   - 网址: https://heroicons.com
   - 特点: Tailwind CSS 官方图标，现代简洁
   - 下载: 提供 SVG 和 React 组件

4. **Lucide Icons**
   - 网址: https://lucide.dev
   - 特点: Feather Icons 的分支，更活跃维护
   - 下载: SVG 格式

5. **Iconify**
   - 网址: https://icon-sets.iconify.design
   - 特点: 聚合多个图标库，可搜索
   - 下载: SVG 格式

### 注意事项

✅ **推荐做法**:
- 使用线性图标（outline），不要使用填充图标（filled）
- 确保所有图标的线条宽度一致（2px）
- 使用 `currentColor` 作为填充色，让图标能跟随主题变化
- 保持简洁，避免过于复杂的细节

❌ **避免**:
- 彩色图标（应使用单色）
- 过小的细节（在 16x16 或 24x24 尺寸下可能看不清）
- 不同风格的图标混用（保持视觉一致性）

---

## 📝 SVG 文件要求

### 标准 SVG 模板

```svg
<svg xmlns="http://www.w3.org/2000/svg" 
     width="24" 
     height="24" 
     viewBox="0 0 24 24" 
     fill="none" 
     stroke="currentColor" 
     stroke-width="2" 
     stroke-linecap="round" 
     stroke-linejoin="round">
  <!-- 图标路径 -->
</svg>
```

### 关键属性说明

- `fill="none"`: 不填充颜色
- `stroke="currentColor"`: 使用当前文本颜色
- `stroke-width="2"`: 线条宽度 2px
- `stroke-linecap="round"`: 线条端点圆角
- `stroke-linejoin="round"`: 线条连接处圆角

---

## 🔧 后续集成步骤

当你准备好图标后：

1. **将 SVG 文件放入** `assets/icons/` 目录
2. **告诉我已完成**，我会帮你：
   - 注册图标到思源笔记
   - 更新代码引用新图标
   - 测试图标显示效果

---

## 💡 快速开始建议

如果你想快速开始，可以：

1. **访问 Feather Icons**: https://feathericons.com
2. **搜索并下载以下图标**:
   - `plus` → toolbar-add.svg
   - `refresh-cw` → toolbar-refresh.svg
   - `check` → toolbar-mark-read.svg
   - `settings` → toolbar-settings.svg
   - `help-circle` → toolbar-help.svg
   - `bookmark` → save-article.svg
3. **对于插件主图标**，可以使用 Material Design 的 `rss_feed` 图标

这些图标风格统一，质量高，且完全免费！

---

**准备好了吗？找到图标后告诉我，我会帮你集成！** 🚀

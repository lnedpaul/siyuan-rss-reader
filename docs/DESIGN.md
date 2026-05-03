# 架构设计说明 (Design Document)

本文档描述了 SiYuan RSS Reader 插件的架构设计、数据流向及核心模块定义。

## 1. 核心技术栈

| 技术 | 用途 |
|------|------|
| [SiYuan Plugin API](https://github.com/siyuan-note/siyuan) | 插件生命周期、Dock 面板、数据存储 |
| TypeScript | 类型安全的开发体验 |
| SCSS | 灵活的样式管理，支持深色模式 |
| Webpack 5 | 模块打包与资源管理 |

> **注意**：虽然 `package.json` 中声明了 `rss-parser` 依赖，但当前实现使用原生 `DOMParser` 手动解析 RSS/Atom，以获得更好的兼容性和错误处理。

## 2. 总体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        SiYuan Note                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    RSSReaderPlugin                       │   │
│  │  (src/index.ts - extends Plugin)                         │   │
│  │                                                          │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │   │
│  │  │   Settings   │  │  i18n System │  │   Storage    │   │   │
│  │  │  Management  │  │  (zh/en)     │  │  (load/save) │   │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘   │   │
│  │                                                          │   │
│  │  ┌──────────────────────────────────────────────────┐   │   │
│  │  │                    UI Layer                       │   │   │
│  │  │  ┌─────────┐  ┌─────────────┐  ┌──────────────┐  │   │   │
│  │  │  │Sidebar  │  │Article List │  │Content Panel │  │   │   │
│  │  │  │(Subs)   │  │(Infinite)   │  │(HTML Render) │  │   │   │
│  │  │  └─────────┘  └─────────────┘  └──────────────┘  │   │   │
│  │  └──────────────────────────────────────────────────┘   │   │
│  │                                                          │   │
│  │  ┌──────────────────────────────────────────────────┐   │   │
│  │  │                 Core Services                     │   │   │
│  │  │  • RSS/Atom Parsing (DOMParser)                   │   │   │
│  │  │  • HTML → Markdown Conversion                      │   │   │
│  │  │  • SiYuan API Bridge (createDocWithMd)            │   │   │
│  │  │  • Theme Detection (MutationObserver)             │   │   │
│  │  └──────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 3. 数据模型

### 3.1 订阅源 (Subscription)
```typescript
interface Subscription {
    id: string;           // 唯一标识符
    url: string;          // RSS 源地址
    name: string;         // 用户自定义名称
    lastFetchTime?: number; // 上次抓取时间戳
}
```

### 3.2 文章 (Article)
```typescript
interface Article extends RSSItem {
    id: string;              // 文章唯一ID（基于 link + subscriptionId）
    subscriptionId: string;  // 所属订阅源ID
    title: string;           // 文章标题
    link: string;            // 原文链接
    pubDate: string;         // 发布日期
    content: string;         // HTML 内容
    description: string;     // 摘要
    isRead?: boolean;        // 是否已读
    cachedAt?: number;       // 缓存时间戳
    thumbnail?: string;      // 缩略图URL（缓存提取结果）
}
```

### 3.3 插件设置 (Settings)
```typescript
interface Settings {
    articlesPerPage: number;        // 每页条目数 (默认: 20)
    autoMarkRead: boolean;          // 自动标记已读 (默认: true)
    layout: 'horizontal' | 'vertical'; // 布局模式 (默认: vertical)
    enableKeyboardShortcuts: boolean;  // 启用快捷键 (默认: true)
    showUnreadOnly: boolean;        // 仅显示未读 (默认: false)
    fontSize: number;               // 字体大小 12-20px (默认: 14)
    autoRefreshInterval: number;    // 自动刷新间隔 (分钟, 0=禁用)
    lastUsedNotebookId?: string;    // 上次使用的笔记本ID
}
```

### 3.4 存储位置
| 数据 | 存储路径 |
|------|----------|
| 订阅源列表 | `data/storage/siyuan-rss-reader/rss_subscriptions.json` |
| 插件设置 | `data/storage/siyuan-rss-reader/settings.json` |

## 4. 核心流程

### 4.1 添加订阅
```
用户点击 "+" 按钮
    → 弹出 Dialog 输入 URL 和名称
    → 调用 fetchAndParseRSS() 验证 URL
    → 验证通过：更新 subscriptions 数组
    → 调用 saveData() 持久化
    → 重新渲染侧边栏列表
```

### 4.2 保存文章到思源
```
用户点击 "保存到思源" 按钮
    → 弹出笔记本选择 Dialog
    → 用户选择目标笔记本
    → 调用 htmlToMarkdown() 转换文章内容
    → 调用 createDocWithMd() 创建文档
    → 显示成功提示
```

### 4.3 无限滚动
```
用户滚动文章列表
    → scroll 事件触发
    → 检测滚动位置 (距底部 < 80px)
    → 设置 isLoadingMore = true (防抖)
    → displayedArticleCount += articlesPerPage
    → renderArticleList(append=true)
    → 检查是否填满容器 (checkAndLoadMore)
    → 设置 isLoadingMore = false
```

## 5. UI 布局

### 5.1 Dock 面板结构
```
┌──────────────────────────────────────────────────────┐
│ 📡 RSS Reader                  [⚙] [?] [—]          │  ← 自建标题栏
├──────────┬───────────────────────────────────────────┤
│          │  工具栏 [+] [↻] [✓]                       │  ← 订阅列表顶部
│ 订阅列表  ├───────────────────────────────────────────┤
│ (20%)    │  文章列表 (可滚动，无限加载)               │
│          ├───────────────────────────────────────────┤
│          │  文章内容 (HTML 渲染)                     │
└──────────┴───────────────────────────────────────────┘
     ↑              ↑
     └──────────────┴── 可拖拽分隔符

注：
- 标题栏为插件自建，包含 Logo、标题和窗口控制按钮
- 工具栏按钮根据上下文动态显示（订阅列表/文章列表）
- 侧边栏宽度固定为 Dock 的 20%
```

### 5.2 响应式布局
- 侧边栏宽度：Dock 的 20%
- 文章列表/内容区：通过垂直分隔符动态调整
- 最小宽度限制：防止过度缩小

## 6. 国际化 (i18n)

### 6.1 实现方式
1. `plugin.json` 声明 `displayName` 和 `description` 的多语言版本
2. `i18n/zh_CN.json` 和 `i18n/en_US.json` 存放翻译字符串
3. 思源自动根据 `window.siyuan.config.lang` 加载对应语言文件
4. 代码中通过 `this.i18n.keyName` 访问翻译

### 6.2 新增翻译步骤
1. 在 `src/i18n/zh_CN.json` 添加键值对
2. 在 `src/i18n/en_US.json` 添加对应英文翻译
3. 重新构建：`npm run build`

## 7. 深色模式

### 7.1 实现方式
```typescript
// 监听 body[data-theme] 属性变化
const observer = new MutationObserver(() => {
    const theme = document.body.getAttribute('data-theme');
    this.applyTheme(theme === 'dark' ? 'dark' : 'light');
});
observer.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
```

### 7.2 CSS 变量
```scss
// 浅色模式
--rss-bg: #ffffff;
--rss-text: #1f1f1f;
--rss-border: #e0e0e0;

// 深色模式
--rss-bg: #1a1a1a;
--rss-text: #e0e0e0;
--rss-border: #333333;
```

## 8. 扩展计划

| 功能 | 优先级 | 预计实现 |
|------|--------|----------|
| Readability 正文提取 | 高 | v0.2.0 |
| 多笔记本选择 | 高 | v0.2.0 |
| 离线缓存 | 中 | v0.3.0 |
| OPML 导入导出 | 中 | v0.3.0 |
| 文章收藏/星标 | 低 | v0.4.0 |
| 定时刷新通知 | 低 | v0.4.0 |

---

**文档版本**：0.1.1  
**最后更新**：2026-05-03  
**更新说明**：
- 修正数据模型定义，与实际代码保持一致
- 更新 UI 布局描述，反映自建标题栏架构
- 修正构建命令为 npm
- 补充 Settings 接口完整字段

# 思源笔记 RSS 订阅插件

> 📡 打破信息获取与知识内化之间的壁垒。

一个为 [思源笔记](https://github.com/siyuan-note/siyuan) 打造的原生 RSS 阅读器插件，支持一键将 RSS 文章转化为你的永久知识库。

## ✨ 功能特性

### 核心功能
- **RSS/Atom 订阅管理**：添加、删除订阅源，内置预设源快速添加
- **沉浸式阅读**：在思源内直接阅读文章，完整 HTML 渲染，支持文本选中复制
- **一键保存到思源**：自动解析文章内容，生成思源文档，支持自定义模板
- **多设备同步**：订阅列表、已读状态、文章缓存通过思源同步引擎无缝跨设备同步
- **国际化支持**：支持中文 (zh-CN) 和英文 (en)，自动跟随思源语言设置
- **深色模式**：自动跟随思源主题（浅色/深色）

### 界面体验
- **标签页集成**：以思源标签页形式打开，无 Dock 面板冲突
- **布局切换**：支持垂直（左右）和水平（上下）两种布局
- **未读角标**：订阅项上实时显示未读数量，超过 99 条显示 `99+`
- **可调整面板**：拖拽调整侧边栏/文章列表/内容面板大小
- **无限滚动**：滚动到底部自动加载更多文章
- **键盘快捷键**：完整的键盘导航支持
- **可定制设置**：字体大小、每页条目数、自动刷新间隔、自动标记已读
- **触屏支持**：触屏设备禁用悬停动画，点按直接触发功能
- **智能缓存**：5 分钟缓存过期 + 后台静默刷新，订阅源切换瞬间加载

### 键盘快捷键
| 按键 | 操作 |
|------|------|
| `J/K` | 上一条/下一条文章 |
| `Space` | 向下滚动一屏文章内容 |
| `O` | 打开原文链接 |
| `S` | 保存到思源 |
| `R` | 刷新当前订阅源 |
| `A` | 全部标记已读 |
| `?` | 显示帮助 |

### 📡 内置订阅源

插件预置了 **30 个 RSS 源**，覆盖 5 个分类：

| 分类 | 订阅源 |
|:----:|--------|
| **中文科技/设计** | 少数派、爱范儿、优设、钛媒体、机核网、阮一峰的网络日志 |
| **新闻** | 中新网 9 分类（实时/要闻/国内/国际/社会/体育/文化/军事）+ IT之家 + 澳门文化局 |
| **财经** | 中新网财经/证券/财富/能源/房地产 + 东方财富 |
| **天气** | 中国气象局 5 路（重要天气/气象要闻/媒体聚焦/工作动态/气象科技）|
| **学术期刊** | arXiv CS、PNAS、Nature |

## 🚀 安装

### 从发布包安装
1. 下载最新发布包
2. 解压到 `SiYuan/data/plugins/siyuan-rss-reader/`
3. 重启思源或重新加载插件

### 从源码构建
```bash
# 克隆仓库
git clone https://github.com/lnedpaul/siyuan-rss-reader.git
cd siyuan-rss-reader

# 安装依赖
npm install

# 构建
npm run build

# dist/ 目录包含插件文件
# 复制到 SiYuan/data/plugins/siyuan-rss-reader/
```

## 🛠️ 开发

```bash
# 安装依赖
npm install

# 开发模式（监听文件变化）
npm run dev

# 生产构建
npm run build

# 类型检查
npm run type-check
```

## 📁 项目结构

```
siyuan-rss-reader/
├── src/                  # 源代码
│   ├── index.ts          # 主插件逻辑
│   ├── index.scss        # 样式文件
│   ├── featured-feeds.json  # 内置订阅源预设
│   └── i18n/             # 翻译文件
│       ├── zh-CN.json
│       └── en.json
├── dist/                 # 构建输出（自动生成，不在 git 中）
├── plugin.json           # 插件清单
├── icon.png              # 插件图标
├── preview.png           # 市场预览图
├── CHANGELOG.md          # 更新日志
├── CONTRIBUTING.md       # 贡献指南
├── README.md
├── README_zh-CN.md
├── LICENSE
├── package.json
├── tsconfig.json
└── webpack.config.js
```

**注意**：`dist/` 目录在构建时生成，不会提交到仓库。请从 [Releases 页面](https://github.com/lnedpaul/siyuan-rss-reader/releases) 下载预构建的版本。

## 🔧 配置

通过侧边栏的 ⚙️ 按钮访问插件设置：

- **每页条目数**：每批次加载的文章数量（默认：20）
- **字体大小**：12px–20px，滑块调节
- **布局模式**：垂直（左右分割）或水平（上下分割）
- **自动标记已读**：选中文章时自动标记为已读
- **自动刷新间隔**：自动更新订阅源的分钟数（默认关闭）
- **保存模板**：保存文章时可选的元信息前缀（订阅源名称、保存日期时间、原文链接）

## 🤝 参与贡献

欢迎参与贡献！请参阅 [CONTRIBUTING.md](https://github.com/lnedpaul/siyuan-rss-reader/blob/main/CONTRIBUTING.md) 了解详情。

### 开发流程
1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/my-feature`
3. 进行修改
4. 运行类型检查：`npm run type-check`
5. 构建：`npm run build`
6. 提交 Pull Request

## 📄 许可证

本项目采用 [MIT 许可证](https://github.com/lnedpaul/siyuan-rss-reader/blob/main/LICENSE)。

## 🙏 致谢

- [思源笔记](https://github.com/siyuan-note/siyuan) - 强大的个人知识管理系统
- [@SunsetSail](https://github.com/SunsetSail) - 贡献事件监听器重构和文本选择支持 (PR #3)

---


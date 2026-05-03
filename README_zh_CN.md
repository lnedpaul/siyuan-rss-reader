# 思源笔记 RSS 订阅插件

> 📡 打破信息获取与知识内化之间的壁垒。

一个为 [思源笔记](https://github.com/siyuan-note/siyuan) 打造的原生 RSS 阅读器插件，支持一键将 RSS 文章转化为你的永久知识库。

## ✨ 功能特性

### 核心功能
- **RSS/Atom 订阅管理**：添加、删除、重命名订阅源，支持拖拽排序
- **沉浸式阅读**：在思源内直接阅读文章，完整 HTML 渲染
- **一键保存到思源**：自动解析文章内容，生成思源文档并保留原文链接
- **国际化支持**：支持中文 (zh_CN) 和英文 (en_US)，自动跟随思源语言设置
- **深色模式**：自动跟随思源主题（浅色/深色）

### 界面体验
- **Dock 集成**：原生 Dock 面板，支持 8 个位置选项（左/右/下侧）
- **可调整布局**：拖拽调整侧边栏/文章列表/内容面板大小
- **无限滚动**：滚动到底部自动加载更多文章
- **键盘快捷键**：完整的键盘导航支持
- **可定制设置**：字体大小、每页条目数、自动刷新间隔

### 键盘快捷键
| 按键 | 操作 |
|------|------|
| `↑/↓` | 导航文章 |
| `Enter` | 打开选中文章 |
| `O` | 打开原文链接 |
| `S` | 保存到思源 |
| `R` | 刷新当前订阅源 |
| `M` | 全部标记已读 |
| `F` | 聚焦搜索框 |
| `Escape` | 退出搜索 |
| `?` | 显示帮助 |

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
│   ├── index.ts          # 主插件代码
│   ├── index.scss        # 样式文件
│   └── i18n/             # 翻译文件
│       ├── zh_CN.json
│       └── en_US.json
├── dist/                 # 构建输出（自动生成，不在 git 中）
├── docs/                 # 文档
├── plugin.json           # 插件清单
├── icon.png              # 插件图标
└── package.json
```

**注意**：`dist/` 目录在构建时生成，不会提交到仓库。请从 [Releases 页面](https://github.com/lnedpaul/siyuan-rss-reader/releases) 下载预构建的版本。

## 🔧 配置

通过工具栏的 ⚙️ 按钮访问插件设置：

- **每页条目数**：每批次加载的文章数量（默认：20）
- **字体大小**：小 / 中 / 大
- **自动刷新间隔**：自动更新订阅源的分钟数
- **键盘快捷键**：启用/禁用键盘导航

## 🤝 参与贡献

欢迎参与贡献！请参阅 [CONTRIBUTING.md](./CONTRIBUTING.md) 了解详情。

### 开发流程
1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/my-feature`
3. 进行修改
4. 运行类型检查：`npm run type-check`
5. 构建：`npm run build`
6. 提交 Pull Request

## 📄 许可证

本项目采用 [MIT 许可证](./LICENSE)。

## 🙏 致谢

- [思源笔记](https://github.com/siyuan-note/siyuan) - 强大的个人知识管理系统
- [rss-parser](https://github.com/rbren/rss-parser) - 轻量级 RSS/Atom 解析器

---


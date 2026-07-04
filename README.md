# SiYuan RSS Reader Plugin

> 📡 Break the barrier between information acquisition and knowledge internalization.

A native RSS reader plugin for [SiYuan Note](https://github.com/siyuan-note/siyuan), supporting one-click conversion of RSS articles into your permanent knowledge base.

## ✨ Features

### Core Features
- **RSS/Atom Subscription Management**: Add, delete, rename feeds with drag-and-drop reordering
- **Immersive Reading**: Read articles directly within SiYuan with full HTML rendering
- **One-Click Save to SiYuan**: Automatically parse article content and generate SiYuan documents with original links
- **Internationalization**: Supports Chinese (zh-CN) and English (en), auto-follows SiYuan language setting
- **Dark Mode**: Auto-follows SiYuan theme (light/dark)

### UI/UX
- **Tab-based Integration**: Opens in a SiYuan tab, no dock panel conflicts
- **Unread Count Badges**: Real-time unread badges on subscription items, capped at `99+`
- **Resizable Layout**: Drag to adjust sidebar/article list/content panel sizes
- **Infinite Scroll**: Auto-load more articles when scrolling to bottom
- **Keyboard Shortcuts**: Full keyboard navigation support
- **Customizable Settings**: Font size, articles per page, auto-refresh interval

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| `J/K` | Previous/Next article |
| `Space` | Scroll article content down one page |
| `O` | Open original link |
| `S` | Save to SiYuan |
| `R` | Refresh current feed |
| `A` | Mark all as read |
| `?` | Show help |

### 📡 Built-in Feeds

The plugin comes with **31 pre-configured RSS feeds** across 5 categories:

| Category | Feeds |
|----------|-------|
| **Chinese Tech & Design** | 少数派, 爱范儿, 优设, 钛媒体, 机核网, 36氪, 阮一峰的网络日志 |
| **News** | China News (8 categories: breaking/domestic/world/society/sports/culture/military), IT之家, Macau Cultural Affairs |
| **Finance & Economy** | China News finance/stock/fortune/energy/real estate, East Money |
| **Weather** | China Meteorological Administration (5 feeds: alerts/briefings/media/operations/tech) |
| **Academic Journals** | arXiv CS, PNAS, Nature |

## 🚀 Installation

### From Release
1. Download the latest release package
2. Extract to `SiYuan/data/plugins/siyuan-rss-reader/`
3. Restart SiYuan or reload plugins

### From Source
```bash
# Clone the repository
git clone https://github.com/lnedpaul/siyuan-rss-reader.git
cd siyuan-rss-reader

# Install dependencies
npm install

# Build
npm run build

# The dist/ folder contains the plugin files
# Copy to SiYuan/data/plugins/siyuan-rss-reader/
```

## 🛠️ Development

```bash
# Install dependencies
npm install

# Development mode (watch for changes)
npm run dev

# Production build
npm run build

# Type check
npm run type-check
```

## 📁 Project Structure

```
siyuan-rss-reader/
├── src/                  # Source code
│   ├── index.ts          # Main plugin code
│   ├── index.scss        # Styles
│   └── i18n/             # Translations
│       ├── zh-CN.json
│       └── en.json
├── dist/                 # Build output (generated, not in git)
├── docs/                 # Documentation
├── plugin.json           # Plugin manifest
├── icon.png              # Plugin icon
└── package.json
```

**Note**: The `dist/` directory is generated during build and is not committed to the repository. Download pre-built releases from the [Releases page](https://github.com/lnedpaul/siyuan-rss-reader/releases).

## 🔧 Configuration

Access plugin settings via the ⚙️ button in the toolbar:

- **Articles per page**: Number of articles to load per batch (default: 20)
- **Font size**: 12px,14px,16px,18px,20px
- **Auto-refresh interval**: Minutes between automatic feed updates
- **Keyboard shortcuts**: Enable/disable keyboard navigation

## 🤝 Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](https://github.com/lnedpaul/siyuan-rss-reader/blob/main/CONTRIBUTING.md) for guidelines.

### Development Setup
1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run type check: `npm run type-check`
5. Build: `npm run build`
6. Submit a pull request

## 📄 License

This project is licensed under the [MIT License](https://github.com/lnedpaul/siyuan-rss-reader/blob/main/LICENSE).

## 🙏 Acknowledgments

- [SiYuan Note](https://github.com/siyuan-note/siyuan) - A powerful personal knowledge management system
- [rss-parser](https://github.com/rbren/rss-parser) - A lightweight RSS/Atom parser

---


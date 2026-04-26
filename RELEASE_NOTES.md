# RSS Reader Plugin - Release Notes

## Version 0.1.0 (Initial Release)

### ✨ Features

#### Core Functionality
- **RSS/Atom Feed Management**: Add, delete, rename, and reorder RSS subscriptions
- **Built-in Subscriptions**: Pre-configured popular feeds (arXiv AI, Hacker News, etc.)
- **Immersive Reading**: Read articles directly within SiYuan Note
- **One-Click Save**: Convert articles to SiYuan documents with original links preserved
- **Article Caching**: Local storage for offline reading and faster loading

#### User Interface
- **Dock Panel Integration**: Native sidebar with 8 position options
- **Resizable Layout**: Drag to adjust panel sizes
- **Infinite Scroll**: Auto-load more articles when scrolling
- **Search Functionality**: Filter articles by keywords
- **Dark Mode Support**: Auto-follows SiYuan theme

#### Internationalization
- **Multi-language**: Supports Chinese (zh_CN) and English (en_US)
- **Auto-detection**: Follows SiYuan language settings

#### Keyboard Shortcuts
- Arrow keys: Navigate articles
- Enter: Open selected article
- O: Open original link
- S: Save to SiYuan
- R: Refresh feed
- M: Mark all as read
- F: Focus search
- Escape: Exit search
- ?: Show help

### 🔧 Technical Details
- Built with TypeScript and Webpack
- Uses rss-parser for feed parsing
- IndexedDB for local caching
- Event delegation for optimal performance
- Physical isolation layout to prevent UI jitter

### 📝 Known Limitations
- Requires network access for initial feed fetching
- Some RSS feeds may have compatibility issues

### 🙏 Acknowledgments
- SiYuan Note team for the plugin framework
- rss-parser library contributors

---

**Author**: HM  
**License**: MIT  
**Minimum SiYuan Version**: 3.3.0

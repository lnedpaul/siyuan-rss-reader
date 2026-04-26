# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-24

### Added
- **Dock Panel Integration**: Native dock panel with 8 position options (left/right/bottom sides)
- **Resizable Layout**: Drag to adjust sidebar/article list/content panel sizes
- **Infinite Scroll**: Auto-load more articles when scrolling to bottom
- **Keyboard Shortcuts**: Full keyboard navigation support (↑/↓/Enter/O/S/R/M/F/Esc/?)
- **Customizable Settings**: Font size, articles per page, auto-refresh interval
- **Internationalization (i18n)**: Chinese (zh_CN) and English (en_US) translations
- **Dark Mode**: Auto-follows SiYuan theme (light/dark)
- **Custom Title Bar**: Built-in title bar with toolbar buttons (Add, Refresh, Mark All Read, Settings, Help, Minimize)

### Changed
- Migrated from dialog-based UI to dock panel for better integration
- Improved RSS parsing with better error handling
- Enhanced HTML-to-Markdown conversion for saving articles
- Optimized article rendering with dynamic font sizes

### Fixed
- Encoding issues with Chinese characters in source files
- Infinite scroll not triggering when list is shorter than container
- Help dialog now uses i18n translations instead of hardcoded Chinese
- Removed duplicate `detectLanguage()` calls in plugin initialization

## [0.0.1] - 2026-04-15

### Added
- Initial project structure with TypeScript + SCSS
- RSS/Atom subscription management (add/delete/rename)
- Article list display and detail page reading
- One-click save article to SiYuan note
- Chinese (zh_CN) and English (en_US) internationalization
- Documentation: README, DESIGN, CONTRIBUTING
- Sidebar mode (dock) replacing dialog mode
- 8 different dock positions support
- Horizontal and vertical separator resizing
- Default dock width increased to 50% of window
- Subscription source width set to 20% of dock

---

## Roadmap

### Planned Features
- [ ] Readability integration for better content extraction
- [ ] Multiple notebook support (choose target notebook when saving)
- [ ] Offline mode with article caching
- [ ] Custom style settings (font, spacing)
- [ ] OPML import/export
- [ ] Article starring/favorites
- [ ] Reading progress tracking
- [ ] Article tags
- [ ] Scheduled updates with notifications

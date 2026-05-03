# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.9] - 2026-05-03

### Removed
- **FORCED_RELOAD_GUIDE.md**: Removed obsolete troubleshooting guide
- **TROUBLESHOOTING.md**: Removed outdated diagnostic documentation (content integrated into CHANGELOG)
- **assets/icons/**: Deleted unused SVG icon files (9 files) - icons are now defined inline in code
- **docs/DESIGN.md**: Removed design document (project completed)

### Changed
- **Project Structure**: Cleaner, more focused project layout
- **Documentation**: Consolidated and streamlined documentation
- **preview.png**: Kept for SiYuan marketplace listing requirement

---

## [0.1.8] - 2026-05-03

### Fixed
- **SiYuan 3.6.5 Compatibility**: Moved `addTopBar()` from `onload()` to `onLayoutReady()` lifecycle method
- **API Migration**: Fixed critical API usage issue - SiYuan 3.3+ requires `addTopBar()` to be called in `onLayoutReady()`

### Changed
- **Lifecycle Compliance**: Plugin now follows SiYuan 3.3+ API specifications correctly
- **Version Compatibility**: Updated to work properly with SiYuan 3.6.5

---

## [0.1.7] - 2026-05-03

### Fixed
- **Top Bar Icon Hidden**: Added robust JavaScript-based hiding logic with MutationObserver to ensure top bar icon stays hidden
- **Dual Display Issue**: Resolved conflict between top bar icon and plugin list entry - now only shows in management list

### Changed
- **Hide Mechanism**: Enhanced from simple `display: none` to comprehensive style hiding with MutationObserver monitoring
- **Plugin Visibility**: Plugin correctly appears in Settings → Plugins list while top bar icon is completely hidden

---

## [0.1.6] - 2026-05-03

### Removed
- **Top Bar Icon**: Removed `addTopBar()` to eliminate duplicate icon in top toolbar
- Plugin now only shows in **Settings → Plugins management list** and **Dock bottom bar**

### Changed
- **Cleaner UI**: Removed redundant top bar icon, keeping only Dock bottom icon and plugin management entry
- **Command Palette**: Still accessible via command palette with "Open RSS Reader" command

---

## [0.1.5] - 2026-05-03

### Added
- **Top Bar Icon**: Added `addTopBar()` to display plugin icon in SiYuan's top toolbar - REQUIRED for plugin to appear in Settings panel plugin list
- **Plugin List Display**: Plugin now appears in Settings → Plugins list with icon and name (matching other plugins like Savor Callout, Link Icons, etc.)

### Changed
- **Plugin Visibility**: Top bar icon enables proper plugin registration in SiYuan's plugin management system
- **User Experience**: Click top bar icon to toggle RSS Reader Dock panel (same functionality as Dock bottom icon)

---

## [0.1.4] - 2026-05-03

### Fixed
- **Dock Icon Conflict**: Reordered icon registration to ensure `iconRSSMain` is registered first, preventing conflicts with built-in icons
- **Command Registration**: Changed command langKey from `toggleDock` to `openRssReader` for proper menu display
- **Dock Toggle Logic**: Fixed dock icon button selector to use `.dock__item[data-type="rss_reader_dock"]` instead of generic selector

### Changed
- **Icon Registration Order**: Moved `iconRSSMain` symbol definition to the top of SVG registration list to ensure priority
- **Command Language Key**: Updated command registration to use more descriptive `openRssReader` key
- **Enhanced Logging**: Added detailed icon registration log showing all 8 registered icons

---

## [0.1.3] - 2026-05-03

### Fixed
- **Plugin Icon in Marketplace**: Added missing `icon` field to plugin.json to display icon in SiYuan's plugin management menu
- **Plugin Registration**: Fixed plugin.json configuration to ensure proper icon display in marketplace

### Changed
- **Plugin Manifest**: Updated plugin.json with required `icon: "icon.png"` field for marketplace compatibility

---

## [0.1.2] - 2026-05-03

### Changed
- **Dock Icon**: Changed Dock bottom icon from iconSave to iconRSSMain for better visual identity
- **Title Bar Icon**: Unified all title bar icons to use iconRSSMain instead of iconRss
- **Empty State Icon**: Updated empty subscription list icon to iconRSSMain

### Fixed
- **Dock Icon Display**: Fixed Dock bottom icon showing wrong icon (iconSave/iconRss) instead of iconRSSMain
- **Icon Consistency**: Unified all plugin icons to use custom iconRSSMain instead of built-in icons
- **Plugin Registration**: Fixed icon registration to ensure iconRSSMain is properly displayed in Dock

### Performance
- **Smart Caching**: Added 5-minute cache expiration to reduce unnecessary network requests
- **Request Deduplication**: Prevented duplicate concurrent requests for the same subscription
- **DOM Optimization**: Used DocumentFragment for better performance when appending articles
- **Expected Performance Improvement**: 50-70% faster subscription switching

---

## [0.1.1] - 2026-04-25

### Changed
- Unified title bar button sizes and hover effects
- Updated icons to Lucide Icons with consistent visual sizing
- Refined button styles: transparent borders with hover color effects
- Optimized save button, add button, and toolbar button interactions
- Standardized CSS class usage for better maintainability
- Removed tooltip artifacts from all title bar buttons

### Fixed
- Icon size inconsistency across settings, help, and minimize buttons
- Hover border effects not displaying correctly on save button
- Unified hover styles across all action buttons

---

## [0.1.0] - 2026-04-25

### Added
- **Dock Panel Integration**: Native dock panel with 8 position options (left/right/bottom sides)
- **Resizable Layout**: Drag to adjust sidebar/article list/content panel sizes
- **Infinite Scroll**: Auto-load more articles when scrolling to bottom
- **Keyboard Shortcuts**: Full keyboard navigation support (↑/↓/Enter/O/S/R/M/F/Esc/?)
- **Customizable Settings**: Font size, articles per page, auto-refresh interval
- **Internationalization (i18n)**: Chinese (zh_CN) and English (en_US) translations
- **Dark Mode**: Auto-follows SiYuan theme (light/dark)
- **Custom Title Bar**: Built-in title bar with toolbar buttons (Add, Refresh, Mark All Read, Settings, Help, Minimize)
- **CI/CD Pipeline**: GitHub Actions workflow for automated build and lint checks
- **Contributing Guide**: CONTRIBUTING.md with development guidelines and PR process

### Changed
- Migrated from dialog-based UI to dock panel for better integration
- Improved RSS parsing with better error handling
- Enhanced HTML-to-Markdown conversion for saving articles
- Optimized article rendering with dynamic font sizes
- Updated repository URLs to https://github.com/lnedpaul/siyuan-rss-reader
- Clarified dist/ directory is build output (not in git) in README files
- Enhanced package.json with additional scripts (lint:check, type-check, clean)

### Fixed
- Encoding issues with Chinese characters in source files
- Infinite scroll not triggering when list is shorter than container
- Help dialog now uses i18n translations instead of hardcoded Chinese
- Removed duplicate `detectLanguage()` calls in plugin initialization
- Removed build artifacts (zip files) from git tracking
- Fixed plugin.json URL pointing to correct repository

### Removed
- Build artifacts (*.zip) from git repository (now managed via GitHub Releases)

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

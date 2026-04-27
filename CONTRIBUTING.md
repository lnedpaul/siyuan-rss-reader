# Contributing to RSS Reader Plugin

Thank you for your interest in contributing to the RSS Reader plugin for SiYuan Note!

## 🚀 Getting Started

### Prerequisites
- Node.js >= 16
- pnpm >= 8
- Git

### Development Setup

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/lnedpaul/siyuan-rss-reader.git
   cd siyuan-rss-reader
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Start development mode**
   ```bash
   pnpm run dev
   ```

4. **Load plugin in SiYuan**
   - Copy `dist/` folder to `SiYuan/data/plugins/siyuan-rss-reader/`
   - Restart SiYuan or reload plugins

## 📝 Code Style

- Use TypeScript for all new code
- Follow existing code style
- Run linting before committing:
  ```bash
  pnpm run lint
  ```

## 🧪 Testing

Currently, the project uses manual testing. Please test your changes thoroughly:

1. Test with different RSS feeds
2. Test both light and dark themes
3. Test keyboard shortcuts
4. Test internationalization (zh_CN and en_US)

## 📦 Building for Production

```bash
pnpm run build
```

The built files will be in the `dist/` directory.

## 🔄 Pull Request Process

1. Create a feature branch from `main`
2. Make your changes
3. Run linting: `pnpm run lint`
4. Build and test: `pnpm run build`
5. Commit your changes with clear messages
6. Push to your fork
7. Submit a Pull Request

### Commit Message Convention

Use clear, descriptive commit messages:
- `feat: add new feature`
- `fix: resolve bug`
- `docs: update documentation`
- `style: code formatting`
- `refactor: code refactoring`
- `test: add tests`
- `chore: maintenance tasks`

## 🐛 Reporting Issues

When reporting bugs, please include:
- SiYuan version
- Plugin version
- Steps to reproduce
- Expected behavior
- Actual behavior
- Screenshots (if applicable)

## 💡 Feature Requests

We welcome feature requests! Please describe:
- The problem you're trying to solve
- Your proposed solution
- Any alternatives you've considered

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing! 🎉

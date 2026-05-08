const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const webpack = require('webpack');
const ZipPlugin = require('zip-webpack-plugin');
const fs = require('fs');
const pluginJson = require('./plugin.json');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';
  return {
    entry: './src/index.ts',
    output: {
      filename: 'index.js',
      path: path.resolve(__dirname, 'dist'),
      libraryTarget: 'commonjs',
      clean: true, // Clean the output directory before each build
    },
    resolve: {
      extensions: ['.ts', '.js', '.scss', '.css'],
      fallback: {
        http: false,
        https: false,
        url: false,
        timers: false
      }
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: 'ts-loader',
          exclude: [/node_modules/, /__tests__/],
        },
        {
          test: /\.scss$/,
          use: [
            MiniCssExtractPlugin.loader,
            'css-loader',
            'sass-loader',
          ],
        },
        {
          test: /\.css$/,
          use: [
            MiniCssExtractPlugin.loader,
            'css-loader',
          ],
        },
      ],
    },
    plugins: [
      new MiniCssExtractPlugin({
        filename: 'index.css',
      }),
      // Only add LICENSE banner in development for easier debugging
      ...(isProd ? [] : [
        new webpack.BannerPlugin({
          banner: () => {
            const license = fs.readFileSync('LICENSE').toString();
            return `/*!\n${license}\n*/`;
          },
          raw: true,
          entryOnly: true,
        })
      ]),
      new CopyPlugin({
        patterns: [
          { from: 'plugin.json', to: 'plugin.json' },
          { from: 'src/i18n', to: 'i18n', noErrorOnMissing: true },
          { from: 'icon.png', to: 'icon.png', noErrorOnMissing: true },
          { from: 'preview.png', to: 'preview.png', noErrorOnMissing: true },
          { from: 'README.md', to: 'README.md', noErrorOnMissing: true },
          { from: 'README_zh_CN.md', to: 'README_zh_CN.md', noErrorOnMissing: true },
        ],
      }),
      ...(isProd ? [
        new ZipPlugin({
          filename: 'package.zip',
          algorithm: 'gzip',
          // Only include necessary files, exclude source maps and dev files
          include: [/\.js$/, /\.css$/, /plugin\.json$/, /icon\.png$/, /preview\.png$/, /README.*\.md$/, /i18n\//],
          exclude: [/\.map$/], // Explicitly exclude source maps
        })
      ] : []),
    ],
    externals: {
      siyuan: 'siyuan',
    },
    devtool: isProd ? false : 'source-map',
    // Production optimization
    optimization: isProd ? {
      minimize: true,
      minimizer: [
        new TerserPlugin({
          terserOptions: {
            compress: {
              drop_console: true, // Remove console.log in production
              drop_debugger: true,
              pure_funcs: ['logger.debug'], // Remove debug calls
            },
            mangle: {
              toplevel: false, // Don't mangle top-level names (important for plugin exports)
            },
            output: {
              comments: false, // Remove all comments
            },
          },
          extractComments: false, // Don't extract comments to separate file
        }),
      ],
      // Enable tree shaking
      usedExports: true,
      sideEffects: false, // Mark module as side-effect free for better tree shaking
    } : {},
    stats: 'errors-only',
  };
};

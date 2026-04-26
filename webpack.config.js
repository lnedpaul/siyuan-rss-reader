const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';
  return {
    entry: './src/index.ts',
    output: {
      filename: 'index.js',
      path: path.resolve(__dirname, 'dist'),
      libraryTarget: 'commonjs',
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
          exclude: /node_modules/,
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
      new CopyPlugin({
        patterns: [
          { from: 'plugin.json', to: 'plugin.json' },
          { from: 'src/i18n', to: 'i18n', noErrorOnMissing: true },
          { from: 'icon.png', to: 'icon.png', noErrorOnMissing: true },
          { from: 'preview.png', to: 'preview.png', noErrorOnMissing: true },
        ],
      }),
    ],
    externals: {
      siyuan: 'siyuan',
    },
    devtool: isProd ? false : 'source-map',
    stats: 'errors-only',
  };
};

process.chdir('F:/HM_projects/rss-reader');
const wpFactory = require('./webpack.config.js');
const webpack = require('webpack');
const config = wpFactory({}, {mode: 'production'});
config.cache = {type: 'memory'};
webpack(config, (err, stats) => {
    if (err) { console.error('Build error:', err); return; }
    if (stats.hasErrors()) {
        console.error('TS errors:');
        stats.compilation.errors.forEach(e => console.error(e.message));
        return;
    }
    const assets = stats.toJson().assets;
    assets.forEach(a => console.log(a.name, (a.size/1024).toFixed(1)+'KB'));
    console.log('Build SUCCESS');
});

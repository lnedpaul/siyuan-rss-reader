const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

// Plugin name and version from plugin.json
const pluginJson = JSON.parse(fs.readFileSync('./plugin.json', 'utf8'));
const pluginName = pluginJson.name;
const version = pluginJson.version;
const outputFileName = `package.zip`;

const output = fs.createWriteStream(path.join(__dirname, outputFileName));
const archive = archiver('zip', {
    zlib: { level: 9 } // Maximum compression
});

output.on('close', () => {
    console.log(`✅ Package created: ${outputFileName}`);
    console.log(`📦 Total size: ${(archive.pointer() / 1024).toFixed(2)} KB`);
    console.log(`📋 Included files:`);
    console.log(`   - index.js`);
    console.log(`   - index.css`);
    console.log(`   - plugin.json`);
    console.log(`   - icon.png`);
    console.log(`   - preview.png`);
    console.log(`   - README.md`);
    console.log(`   - README_zh_CN.md`);
    console.log(`   - i18n/*.json`);
});

archive.on('error', (err) => {
    throw err;
});

archive.pipe(output);

// Add required files
archive.file('dist/index.js', { name: 'index.js' });
archive.file('dist/index.css', { name: 'index.css' });
archive.file('dist/plugin.json', { name: 'plugin.json' });
archive.file('dist/icon.png', { name: 'icon.png' });

// Add preview.png if exists
if (fs.existsSync('dist/preview.png')) {
    archive.file('dist/preview.png', { name: 'preview.png' });
}

// Add README files
if (fs.existsSync('dist/README.md')) {
    archive.file('dist/README.md', { name: 'README.md' });
}
if (fs.existsSync('dist/README_zh_CN.md')) {
    archive.file('dist/README_zh_CN.md', { name: 'README_zh_CN.md' });
}

// Add i18n directory
if (fs.existsSync('dist/i18n')) {
    archive.directory('dist/i18n/', 'i18n/');
}

archive.finalize();

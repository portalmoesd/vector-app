const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHECK_DIRS = ['server', 'frontend/js'];

function listJsFiles(dir) {
  const absolute = path.join(ROOT, dir);
  if (!fs.existsSync(absolute)) return [];

  const files = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const fullPath = path.join(absolute, entry.name);
    const relative = path.relative(ROOT, fullPath);
    if (entry.isDirectory()) {
      files.push(...listJsFiles(relative));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(relative);
    }
  }
  return files;
}

const files = CHECK_DIRS.flatMap(listJsFiles).sort();
let failed = false;

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (result.status !== 0) failed = true;
}

if (failed) process.exit(1);
console.log(`Checked ${files.length} JavaScript files.`);

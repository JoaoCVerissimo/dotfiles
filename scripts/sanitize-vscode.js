#!/usr/bin/env node
// Copies a VS Code settings.json into the repo without machine-specific state.
// usage: node scripts/sanitize-vscode.js <live settings.json> <repo vscode/settings.json>
const fs = require('fs');
const [src, dst] = process.argv.slice(2);
const raw = fs.readFileSync(src, 'utf8').replace(/^\s*\/\/.*$/mg, '').replace(/,(\s*[}\]])/g, '$1');
const obj = JSON.parse(raw);
const DROP = ['snyk.folderConfigs', 'snyk.trustedFolders', 'snyk.advanced.cliPath', 'atlascode.jira.lastCreastSiteAndProject'];
for (const k of DROP) delete obj[k];
for (const [k, v] of Object.entries(obj)) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const kk of Object.keys(v)) if (kk.startsWith('file:///Users/')) delete v[kk];
    if (Object.keys(v).length === 0) delete obj[k];
  }
}
fs.writeFileSync(dst, JSON.stringify(obj, null, 2) + '\n');
console.log(`wrote ${dst} (${Object.keys(obj).length} keys)`);

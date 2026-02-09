#!/usr/bin/env node
// open-bookmark.js
// Usage: npm run assistant:open-bookmark -- "Bookmark Name"
// This script reads Chrome's Bookmarks JSON and opens the first matching bookmark URL in Google Chrome.

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const bookmarkName = process.argv.slice(2).join(' ').trim();
if (!bookmarkName) {
  console.error('Usage: npm run assistant:open-bookmark -- "Bookmark Name"');
  process.exit(1);
}

// Default Chrome Bookmarks path for the current user (Default profile)
const bookmarksPath = path.join(process.env.HOME || '~', 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'Bookmarks');

function findBookmark(node, name) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'url' && node.name === name) return node.url;
  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      const found = findBookmark(child, name);
      if (found) return found;
    }
  }
  return null;
}

fs.readFile(bookmarksPath, 'utf8', (err, data) => {
  if (err) {
    console.error('Could not read Chrome bookmarks file at', bookmarksPath);
    console.error('Error:', err.message);
    process.exit(1);
  }

  try {
    const json = JSON.parse(data);
    // Bookmarks are usually under roots.bookmark_bar and roots.other
    const roots = json.roots || {};
    const searchRoots = [roots.bookmark_bar, roots.other, roots.synced]
      .filter(Boolean);

    let url = null;
    for (const r of searchRoots) {
      url = findBookmark(r, bookmarkName);
      if (url) break;
    }

    if (!url) {
      console.error(`Bookmark named "${bookmarkName}" not found in Chrome bookmarks.`);
      process.exit(2);
    }

    // Open the URL in Google Chrome
    const openCmd = `open -a "Google Chrome" "${url}"`;
    exec(openCmd, (e) => {
      if (e) {
        console.error('Failed to open URL in Chrome:', e.message);
        process.exit(1);
      }
      console.log('Opened bookmark in Chrome:', url);
    });
  } catch (parseErr) {
    console.error('Failed to parse Chrome bookmarks file:', parseErr.message);
    process.exit(1);
  }
});

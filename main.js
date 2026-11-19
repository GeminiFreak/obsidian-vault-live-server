const { Plugin, PluginSettingTab, Setting, MarkdownRenderer, Component, TFile, Notice } = require('obsidian');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  port: 8888,
  landingNote: 'Home',
  username: 'admin',
  password: 'obsidian'
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.pdf': 'application/pdf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf'
};

class VaultLiveServerPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.sockets = new Set();
    this.server = null;
    this.isRunning = false;
    this.cachedAppCss = null;

    this.ribbonEl = this.addRibbonIcon('wifi', 'Toggle Vault Live Server', () => {
      this.toggleServer();
    });

    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.style.cursor = 'pointer';
    this.statusBarEl.setAttribute('aria-label', 'Click to toggle Vault Live Server');
    this.statusBarEl.addEventListener('click', () => {
      this.toggleServer();
    });

    this.addCommand({
      id: 'toggle-vault-live-server',
      name: 'Toggle Server On/Off',
      callback: () => this.toggleServer()
    });

    this.addCommand({
      id: 'open-vault-live-server-browser',
      name: 'Open in Browser',
      callback: () => {
        const port = Number(this.settings.port) || 8888;
        window.open(`http://localhost:${port}/`, '_blank');
      }
    });

    this.addSettingTab(new VaultLiveServerSettingTab(this.app, this));
    this.startServer();
  }

  onunload() {
    this.stopServer();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  getVaultBasePath() {
    return this.app.vault.adapter.getBasePath();
  }

  updateStatusUI() {
    const port = Number(this.settings.port) || 8888;
    if (this.isRunning) {
      if (this.ribbonEl) {
        this.ribbonEl.setAttribute('aria-label', `Vault Live Server: ON (:${port}) - Click to stop`);
        this.ribbonEl.style.color = 'var(--interactive-accent)';
      }
      if (this.statusBarEl) {
        this.statusBarEl.setText(`Live: ON (:${port})`);
        this.statusBarEl.style.color = 'var(--text-success, #4ade80)';
      }
    } else {
      if (this.ribbonEl) {
        this.ribbonEl.setAttribute('aria-label', 'Vault Live Server: OFF - Click to start');
        this.ribbonEl.style.color = 'var(--text-muted)';
      }
      if (this.statusBarEl) {
        this.statusBarEl.setText('Live: OFF');
        this.statusBarEl.style.color = 'var(--text-muted)';
      }
    }
  }

  toggleServer() {
    if (this.isRunning) {
      this.stopServer();
      new Notice('Vault Live Server stopped.');
    } else {
      this.startServer();
      const port = Number(this.settings.port) || 8888;
      new Notice(`Vault Live Server started at http://localhost:${port}/`);
    }
  }

  startServer() {
    this.stopServer();

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((err) => {
        console.error('[Vault Live Server] Request error:', err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Internal Server Error: ' + err.message);
        }
      });
    });

    this.server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });

    this.server.on('error', (err) => {
      console.error('[Vault Live Server] Server error:', err);
      this.isRunning = false;
      this.updateStatusUI();
      new Notice(`Vault Live Server error: ${err.message}`);
    });

    const port = Number(this.settings.port) || 8888;
    this.server.listen(port, '127.0.0.1', () => {
      this.isRunning = true;
      this.updateStatusUI();
      console.log(`[Vault Live Server] Listening at http://localhost:${port}/`);
    });
  }

  stopServer() {
    if (this.server) {
      for (const socket of this.sockets) {
        try {
          socket.destroy();
        } catch (_) {}
      }
      this.sockets.clear();
      try {
        this.server.close();
      } catch (_) {}
      this.server = null;
    }
    this.isRunning = false;
    this.updateStatusUI();
  }

  checkBasicAuth(req, res) {
    const user = this.settings.username || '';
    const pass = this.settings.password || '';
    if (!user && !pass) return true;

    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Basic ')) {
      const b64 = authHeader.slice(6).trim();
      const decoded = Buffer.from(b64, 'base64').toString('utf8');
      const sepIndex = decoded.indexOf(':');
      if (sepIndex !== -1) {
        const reqUser = decoded.slice(0, sepIndex);
        const reqPass = decoded.slice(sepIndex + 1);
        if (reqUser === user && reqPass === pass) {
          return true;
        }
      }
    }

    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="Obsidian Vault", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8'
    });
    res.end('Authentication required.');
    return false;
  }

  async handleRequest(req, res) {
    if (!this.checkBasicAuth(req, res)) return;

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(parsedUrl.pathname);

    if (pathname.startsWith('/_vault/')) {
      const relPath = pathname.slice('/_vault/'.length);
      return this.serveVaultFile(relPath, req, res);
    }

    if (pathname === '/' || pathname === '') {
      const landing = (this.settings.landingNote || 'Home').replace(/\.md$/i, '');
      const targetFile = this.resolveNoteFile(landing, '');
      if (targetFile) {
        return this.serveRenderedNote(targetFile, res);
      }
      const allMd = this.app.vault.getMarkdownFiles();
      if (allMd.length > 0) {
        return this.serveRenderedNote(allMd[0], res);
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Landing note not found and vault contains no Markdown files.');
      return;
    }

    const strippedPath = pathname.replace(/^\/+/, '');
    const exactAbstractFile = this.app.vault.getAbstractFileByPath(strippedPath);
    if (exactAbstractFile instanceof TFile && exactAbstractFile.extension.toLowerCase() !== 'md') {
      return this.serveVaultFile(exactAbstractFile.path, req, res);
    }

    const noteFile = this.resolveNoteFile(strippedPath, '');
    if (noteFile) {
      return this.serveRenderedNote(noteFile, res);
    }

    const resolvedAttachment = this.app.metadataCache.getFirstLinkpathDest(strippedPath, '');
    if (resolvedAttachment instanceof TFile && resolvedAttachment.extension.toLowerCase() !== 'md') {
      return this.serveVaultFile(resolvedAttachment.path, req, res);
    }

    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h1>404 - Note Not Found</h1><p>Could not find note: <code>${this.escapeHtml(strippedPath)}</code></p><p><a href="/">Return Home</a></p>`);
  }

  resolveNoteFile(linkpath, sourcePath) {
    const firstPart = linkpath.replace(/^\/+/, '').split('#')[0];
    const cleanLink = firstPart ? firstPart.trim() : '';
    if (!cleanLink) return null;

    const withMd = cleanLink.endsWith('.md') ? cleanLink : `${cleanLink}.md`;
    const exact = this.app.vault.getAbstractFileByPath(withMd);
    if (exact instanceof TFile) return exact;

    const dest = this.app.metadataCache.getFirstLinkpathDest(cleanLink, sourcePath || '');
    if (dest instanceof TFile && dest.extension.toLowerCase() === 'md') {
      return dest;
    }

    const lowerTarget = cleanLink.replace(/\.md$/i, '').toLowerCase();
    return this.app.vault.getMarkdownFiles().find(
      (f) => f.basename.toLowerCase() === lowerTarget || f.path.toLowerCase() === `${lowerTarget}.md`
    ) || null;
  }

  serveVaultFile(relPath, req, res) {
    const basePath = this.getVaultBasePath();
    const safeRelPath = relPath.replace(/^\/+/, '');
    const fullPath = path.resolve(basePath, safeRelPath);

    if (!fullPath.startsWith(path.resolve(basePath))) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    fs.stat(fullPath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('File not found');
        return;
      }

      const ext = path.extname(fullPath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const fileSize = stats.size;
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (isNaN(start) || isNaN(end) || start > end || end >= fileSize) {
          res.writeHead(416, {
            'Content-Range': `bytes */${fileSize}`
          });
          res.end();
          return;
        }

        const chunkSize = end - start + 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': contentType,
          'Cache-Control': 'no-cache'
        });

        const stream = fs.createReadStream(fullPath, { start, end });
        stream.on('error', () => {
          if (!res.headersSent) res.writeHead(500);
          res.end();
        });
        stream.pipe(res);
      } else {
        res.writeHead(200, {
          'Accept-Ranges': 'bytes',
          'Content-Length': fileSize,
          'Content-Type': contentType,
          'Cache-Control': 'no-cache'
        });

        const stream = fs.createReadStream(fullPath);
        stream.on('error', () => {
          if (!res.headersSent) res.writeHead(500);
          res.end();
        });
        stream.pipe(res);
      }
    });
  }

  async serveRenderedNote(file, res) {
    const content = await this.app.vault.cachedRead(file);

    const host = document.createElement('div');
    host.className = 'workspace-leaf mod-active';
    host.style.position = 'fixed';
    host.style.left = '-99999px';
    host.style.top = '0';
    host.style.width = '1200px';
    host.style.visibility = 'hidden';
    host.style.pointerEvents = 'none';

    const leafContent = document.createElement('div');
    leafContent.className = 'workspace-leaf-content';
    leafContent.setAttribute('data-type', 'markdown');
    leafContent.setAttribute('data-mode', 'preview');

    const viewContent = document.createElement('div');
    viewContent.className = 'view-content';

    const readingView = document.createElement('div');
    readingView.className = 'markdown-reading-view';

    const wrapper = document.createElement('div');
    wrapper.className = 'markdown-preview-view markdown-rendered node-insert-event is-readable-line-width allow-fold-headings show-indentation-guide';

    const sizer = document.createElement('div');
    sizer.className = 'markdown-preview-sizer markdown-preview-section';

    wrapper.appendChild(sizer);
    readingView.appendChild(wrapper);
    viewContent.appendChild(readingView);
    leafContent.appendChild(viewContent);
    host.appendChild(leafContent);
    document.body.appendChild(host);

    const comp = new Component();
    comp.load();

    try {
      await MarkdownRenderer.render(this.app, content, sizer, file.path, comp);
      await this.waitForAsyncBlocks(sizer);
      this.rewriteDomElements(sizer, file.path);

      const renderedHtml = sizer.innerHTML;
      const fullPageHtml = this.buildHtmlDocument(file, renderedHtml);

      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, must-revalidate'
      });
      res.end(fullPageHtml);
    } finally {
      comp.unload();
      host.remove();
    }
  }

  async waitForAsyncBlocks(container) {
    const maxWaitMs = 2500;
    const pollIntervalMs = 100;
    let elapsed = 0;

    await new Promise((r) => setTimeout(r, 120));
    elapsed += 120;

    while (elapsed < maxWaitMs) {
      const dvBlocks = container.querySelectorAll('.block-language-dataview, .block-language-dataviewjs, .dataview');
      if (dvBlocks.length === 0) {
        break;
      }

      let allPopulated = true;
      for (const block of dvBlocks) {
        const hasRenderedContent =
          block.querySelector('table, ul, ol, span.dataview, p, .dataview-error-box') !== null ||
          (block.textContent && block.textContent.trim().length > 0 && !block.querySelector('code.language-dataview'));
        if (!hasRenderedContent) {
          allPopulated = false;
          break;
        }
      }

      if (allPopulated) {
        await new Promise((r) => setTimeout(r, 80));
        break;
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
      elapsed += pollIntervalMs;
    }
  }

  rewriteDomElements(container, sourcePath) {
    const basePath = this.getVaultBasePath();
    const normalizedBase = basePath.replace(/\\/g, '/').replace(/\/+$/, '');

    // 1. Rewrite internal wikilinks
    const internalLinks = container.querySelectorAll('a.internal-link');
    for (const a of internalLinks) {
      const rawHref = a.getAttribute('data-href') || a.getAttribute('href') || '';
      if (!rawHref) continue;

      const splitHref = rawHref.split('#');
      const notePart = splitHref[0];
      const headingPart = splitHref[1];

      const targetFile = notePart
        ? this.app.metadataCache.getFirstLinkpathDest(notePart, sourcePath)
        : this.app.vault.getAbstractFileByPath(sourcePath);

      const hashSuffix = headingPart ? `#${encodeURIComponent(headingPart.replace(/\s+/g, '-'))}` : '';

      if (targetFile instanceof TFile) {
        if (targetFile.extension.toLowerCase() === 'md') {
          const cleanNotePath = targetFile.path.replace(/\.md$/i, '');
          const encodedPath = cleanNotePath.split('/').map(encodeURIComponent).join('/');
          a.setAttribute('href', `/${encodedPath}${hashSuffix}`);
        } else {
          const encodedAssetPath = targetFile.path.split('/').map(encodeURIComponent).join('/');
          a.setAttribute('href', `/_vault/${encodedAssetPath}${hashSuffix}`);
        }
      } else if (notePart) {
        const fallbackEncoded = notePart.replace(/\.md$/i, '').split('/').map(encodeURIComponent).join('/');
        a.setAttribute('href', `/${fallbackEncoded}${hashSuffix}`);
      } else if (hashSuffix) {
        a.setAttribute('href', hashSuffix);
      }

      a.removeAttribute('target');
      a.removeAttribute('rel');
    }

    // 2. Preserve |330 image widths, heights, and |center / |shadow alt modifiers on image embeds
    const imageEmbeds = container.querySelectorAll('.internal-embed.image-embed, span.image-embed');
    for (const embed of imageEmbeds) {
      const embedWidth = embed.getAttribute('width');
      const embedHeight = embed.getAttribute('height');
      const embedAlt = embed.getAttribute('alt') || '';
      const img = embed.querySelector('img');

      if (img) {
        if (embedAlt && !img.getAttribute('alt')) {
          img.setAttribute('alt', embedAlt);
        }
        let parsedW = embedWidth ? parseInt(embedWidth, 10) : NaN;
        let parsedH = embedHeight ? parseInt(embedHeight, 10) : NaN;

        if (isNaN(parsedW) && embedAlt) {
          const dimMatch = embedAlt.match(/(?:^|\|)(\d+)(?:x(\d+))?(?:\||$)/);
          if (dimMatch) {
            parsedW = parseInt(dimMatch[1], 10);
            if (dimMatch[2]) parsedH = parseInt(dimMatch[2], 10);
          }
        }

        if (!isNaN(parsedW) && parsedW > 0) {
          img.setAttribute('width', String(parsedW));
          img.style.width = `${parsedW}px`;
          img.style.maxWidth = '100%';
          embed.style.maxWidth = '100%';
        }
        if (!isNaN(parsedH) && parsedH > 0) {
          img.setAttribute('height', String(parsedH));
          img.style.height = `${parsedH}px`;
        }
      }
    }

    // 3. Rewrite media elements
    const mediaEls = container.querySelectorAll('img, video, audio, source, embed');
    for (const el of mediaEls) {
      for (const attr of ['src', 'poster']) {
        const val = el.getAttribute(attr);
        if (!val) continue;

        const rewritten = this.rewriteAssetUrl(val, normalizedBase, sourcePath);
        if (rewritten) {
          el.setAttribute(attr, rewritten);
        }
      }

      if (el.tagName === 'IMG') {
        const wAttr = el.getAttribute('width');
        if (wAttr && !el.style.width) {
          const wNum = parseInt(wAttr, 10);
          if (!isNaN(wNum) && wNum > 0) {
            el.style.width = `${wNum}px`;
            el.style.maxWidth = '100%';
          }
        }
      }

      if (el.tagName === 'VIDEO' && !el.hasAttribute('controls')) {
        el.setAttribute('controls', '');
        el.setAttribute('preload', 'metadata');
      }
    }

    // 4. Rewrite unexpanded internal media embeds
    const internalEmbeds = container.querySelectorAll('.internal-embed[src]');
    for (const embed of internalEmbeds) {
      if (embed.querySelector('img, video, audio')) continue;
      const embedSrc = embed.getAttribute('src');
      if (!embedSrc) continue;
      const cleanSrc = embedSrc.split('#')[0];
      const dest = this.app.metadataCache.getFirstLinkpathDest(cleanSrc, sourcePath);
      if (dest instanceof TFile && dest.extension.toLowerCase() !== 'md') {
        const encoded = dest.path.split('/').map(encodeURIComponent).join('/');
        const ext = dest.extension.toLowerCase();
        const wAttr = embed.getAttribute('width');
        const altAttr = embed.getAttribute('alt') || dest.name;
        const wStyle = wAttr ? `width: ${parseInt(wAttr, 10)}px; max-width: 100%;` : 'max-width: 100%;';

        if (['mp4', 'webm', 'mov', 'ogv', 'mkv'].includes(ext)) {
          embed.innerHTML = `<video controls preload="metadata" src="/_vault/${encoded}" style="${wStyle}"></video>`;
        } else if (['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext)) {
          embed.innerHTML = `<audio controls preload="metadata" src="/_vault/${encoded}"></audio>`;
        } else if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) {
          embed.innerHTML = `<img src="/_vault/${encoded}" alt="${this.escapeHtml(altAttr)}" style="${wStyle}" />`;
        }
      }
    }

    // 5. Rewrite inline CSS url("app://...") references
    const styledEls = container.querySelectorAll('[style]');
    for (const el of styledEls) {
      const styleVal = el.getAttribute('style');
      if (styleVal && styleVal.includes('app://')) {
        el.setAttribute('style', this.rewriteCssUrls(styleVal, normalizedBase));
      }
    }

    // 6. Ensure collapsible callouts honor initial collapsed state
    const collapsedCallouts = container.querySelectorAll('.callout.is-collapsible.is-collapsed');
    for (const callout of collapsedCallouts) {
      const contentEl = callout.querySelector('.callout-content');
      if (contentEl) {
        contentEl.style.setProperty('display', 'none', 'important');
      }
    }
  }

  rewriteAssetUrl(rawUrl, normalizedBase, sourcePath) {
    if (!rawUrl || rawUrl.startsWith('http://') || rawUrl.startsWith('https://') || rawUrl.startsWith('data:') || rawUrl.startsWith('/_vault/')) {
      return null;
    }

    if (rawUrl.startsWith('app://')) {
      try {
        const parsed = new URL(rawUrl);
        let fsPath = decodeURIComponent(parsed.pathname);
        if (/^\/[a-zA-Z]:\//.test(fsPath)) {
          fsPath = fsPath.slice(1);
        }
        const normalizedFs = fsPath.replace(/\\/g, '/');
        if (normalizedFs.toLowerCase().startsWith(normalizedBase.toLowerCase() + '/')) {
          const relPath = normalizedFs.slice(normalizedBase.length + 1);
          return '/_vault/' + relPath.split('/').map(encodeURIComponent).join('/');
        }
      } catch (_) {}
    }

    const withoutQuery = rawUrl.split('?')[0];
    const withoutHash = withoutQuery.split('#')[0];
    const cleanRel = decodeURIComponent(withoutHash);
    const dest = this.app.metadataCache.getFirstLinkpathDest(cleanRel, sourcePath);
    if (dest instanceof TFile) {
      return '/_vault/' + dest.path.split('/').map(encodeURIComponent).join('/');
    }

    return null;
  }

  rewriteCssUrls(cssText, normalizedBase) {
    if (!cssText) return '';
    return cssText.replace(/url\(\s*(['"]?)(app:\/\/[^'")]+)\1\s*\)/gi, (match, quote, appUrl) => {
      const rewritten = this.rewriteAssetUrl(appUrl, normalizedBase, '');
      return rewritten ? `url("${rewritten}")` : match;
    });
  }

  resolveDynamicWallpaperForNote(file, normalizedBase) {
    try {
      const basePath = this.getVaultBasePath();
      const dwDataPath = path.join(basePath, '.obsidian', 'plugins', 'dynamic-wallpapers-plugin', 'data.json');
      if (!fs.existsSync(dwDataPath)) return null;

      const dwConfig = JSON.parse(fs.readFileSync(dwDataPath, 'utf8'));
      if (!dwConfig || !dwConfig.settings) return null;
      const s = dwConfig.settings;

      const visited = new Set();
      const findWallpaperInNote = (targetFile, depth) => {
        if (!targetFile || !(targetFile instanceof TFile) || depth > 5 || visited.has(targetFile.path)) {
          return null;
        }
        visited.add(targetFile.path);

        const cache = this.app.metadataCache.getFileCache(targetFile);
        const fm = cache && cache.frontmatter ? cache.frontmatter : null;

        if (fm) {
          const wpProp = s.wallpaperProperty || 'wallpaper';
          if (fm[wpProp]) {
            const val = Array.isArray(fm[wpProp]) ? fm[wpProp][0] : fm[wpProp];
            if (typeof val === 'string' && val.trim()) return val.trim();
          }

          const wpsProp = s.wallpapersProperty || 'wallpapers';
          if (fm[wpsProp]) {
            const list = Array.isArray(fm[wpsProp]) ? fm[wpsProp] : [fm[wpsProp]];
            const valid = list.filter((item) => typeof item === 'string' && item.trim());
            if (valid.length > 0) {
              const pick = valid[Math.floor(Math.random() * valid.length)];
              return pick.trim();
            }
          }

          if (s.enableWallpaperInheritance) {
            const inheritProp = s.inheritanceProperty || 'inherit_wallpaper';
            if (fm[inheritProp]) {
              const rawTarget = Array.isArray(fm[inheritProp]) ? fm[inheritProp][0] : fm[inheritProp];
              const cleanLink = String(rawTarget).replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0].split('#')[0].trim();
              const linked = this.app.metadataCache.getFirstLinkpathDest(cleanLink, targetFile.path);
              const inherited = findWallpaperInNote(linked, depth + 1);
              if (inherited) return inherited;
            }
          }

          if (s.enableFrontmatterLinkInheritance && cache.frontmatterLinks) {
            for (const link of cache.frontmatterLinks) {
              const linked = this.app.metadataCache.getFirstLinkpathDest(link.link, targetFile.path);
              const inherited = findWallpaperInNote(linked, depth + 1);
              if (inherited) return inherited;
            }
          }
        }

        if (s.enableBodyLinkInheritance && cache && cache.links) {
          for (const link of cache.links) {
            const linked = this.app.metadataCache.getFirstLinkpathDest(link.link, targetFile.path);
            const inherited = findWallpaperInNote(linked, depth + 1);
            if (inherited) return inherited;
          }
        }

        if (s.enableBacklinkInheritance) {
          const resolvedLinks = this.app.metadataCache.resolvedLinks || {};
          for (const [sourcePath, targets] of Object.entries(resolvedLinks)) {
            if (targets && Object.prototype.hasOwnProperty.call(targets, targetFile.path)) {
              const backlinkFile = this.app.vault.getAbstractFileByPath(sourcePath);
              const inherited = findWallpaperInNote(backlinkFile, depth + 1);
              if (inherited) return inherited;
            }
          }
        }

        return null;
      };

      const rawWallpaper = findWallpaperInNote(file, 0);
      if (!rawWallpaper) return null;

      let resolvedUrl = null;
      const trimmed = rawWallpaper.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0].trim();

      if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:')) {
        resolvedUrl = trimmed;
      } else if (trimmed.startsWith('app://')) {
        resolvedUrl = this.rewriteAssetUrl(trimmed, normalizedBase, file.path);
      } else {
        const dest = this.app.metadataCache.getFirstLinkpathDest(trimmed, file.path);
        if (dest instanceof TFile) {
          resolvedUrl = '/_vault/' + dest.path.split('/').map(encodeURIComponent).join('/');
        } else if (s.defaultWallpaperFolder) {
          const folderCandidate = `${s.defaultWallpaperFolder.replace(/\/+$/, '')}/${trimmed.replace(/^\/+/, '')}`;
          const folderDest = this.app.metadataCache.getFirstLinkpathDest(folderCandidate, file.path);
          if (folderDest instanceof TFile) {
            resolvedUrl = '/_vault/' + folderDest.path.split('/').map(encodeURIComponent).join('/');
          }
        }
      }

      if (!resolvedUrl) return null;

      const isDark = document.body.classList.contains('theme-dark');
      const opacity = isDark
        ? (typeof s.darkModeOpacity === 'number' ? s.darkModeOpacity : 0.75)
        : (typeof s.lightModeOpacity === 'number' ? s.lightModeOpacity : 0.85);
      const blur = typeof s.blur === 'number' ? s.blur : 0;

      return {
        url: resolvedUrl,
        opacity,
        blur
      };
    } catch (err) {
      console.warn('[Vault Live Server] Dynamic Wallpaper resolution error:', err);
      return null;
    }
  }

  getObsidianAppCss(normalizedBase) {
    if (this.cachedAppCss !== null) {
      return this.cachedAppCss;
    }

    const appRules = [];
    try {
      for (const sheet of Array.from(document.styleSheets)) {
        const href = sheet.href || '';
        const ownerTag = sheet.ownerNode ? sheet.ownerNode.tagName : '';
        if (ownerTag === 'LINK' && href.includes('app.css')) {
          try {
            const rules = sheet.cssRules || sheet.rules;
            if (rules) {
              for (const rule of Array.from(rules)) {
                appRules.push(rule.cssText);
              }
            }
          } catch (_) {}
        }
      }
    } catch (err) {
      console.warn('[Vault Live Server] Could not extract app.css rules:', err);
    }

    this.cachedAppCss = this.rewriteCssUrls(appRules.join('\n'), normalizedBase);
    return this.cachedAppCss;
  }

  collectStylesAndClasses(file) {
    const basePath = this.getVaultBasePath();
    const normalizedBase = basePath.replace(/\\/g, '/').replace(/\/+$/, '');
    const obsidianDir = path.join(basePath, '.obsidian');

    const htmlClasses = document.documentElement.className || '';
    const htmlStyle = this.rewriteCssUrls(document.documentElement.getAttribute('style') || '', normalizedBase);
    const bodyClasses = document.body.className || '';
    const bodyStyle = this.rewriteCssUrls(document.body.getAttribute('style') || '', normalizedBase);

    const appCss = this.getObsidianAppCss(normalizedBase);

    const inlineStyles = [];
    for (const styleEl of document.querySelectorAll('head style')) {
      const css = styleEl.textContent || '';
      if (css.trim()) {
        inlineStyles.push(this.rewriteCssUrls(css, normalizedBase));
      }
    }

    let diskThemeCss = '';
    let diskSnippetsCss = '';
    try {
      const appearancePath = path.join(obsidianDir, 'appearance.json');
      if (fs.existsSync(appearancePath)) {
        const appearance = JSON.parse(fs.readFileSync(appearancePath, 'utf8'));

        if (appearance.cssTheme) {
          const themeCssPath = path.join(obsidianDir, 'themes', appearance.cssTheme, 'theme.css');
          if (fs.existsSync(themeCssPath)) {
            diskThemeCss = this.rewriteCssUrls(fs.readFileSync(themeCssPath, 'utf8'), normalizedBase);
          }
        }

        if (Array.isArray(appearance.enabledCssSnippets)) {
          for (const snippetName of appearance.enabledCssSnippets) {
            const snippetPath = path.join(obsidianDir, 'snippets', `${snippetName}.css`);
            if (fs.existsSync(snippetPath)) {
              const rawSnippet = fs.readFileSync(snippetPath, 'utf8');
              diskSnippetsCss += `\n/* Snippet: ${snippetName} */\n` + this.rewriteCssUrls(rawSnippet, normalizedBase);
            }
          }
        }
      }
    } catch (err) {
      console.warn('[Vault Live Server] Could not read theme/snippets from disk:', err);
    }

    const computedRoot = getComputedStyle(document.documentElement);
    const computedBody = getComputedStyle(document.body);
    const customVars = [];
    const seenVars = new Set();

    for (const styleDecl of [document.documentElement.style, document.body.style]) {
      for (let i = 0; i < styleDecl.length; i++) {
        const prop = styleDecl[i];
        if (prop.startsWith('--') && !seenVars.has(prop)) {
          seenVars.add(prop);
          const val = this.rewriteCssUrls(styleDecl.getPropertyValue(prop), normalizedBase);
          customVars.push(`${prop}: ${val};`);
        }
      }
    }

    const importantVarPrefixes = [
      '--background-', '--text-', '--interactive-', '--font-', '--h1-', '--h2-', '--h3-',
      '--h4-', '--h5-', '--h6-', '--link-', '--code-', '--blockquote-', '--callout-',
      '--table-', '--file-line-width', '--size-', '--radius-', '--border-'
    ];
    for (const sourceStyle of [computedRoot, computedBody]) {
      for (let i = 0; i < sourceStyle.length; i++) {
        const prop = sourceStyle[i];
        if (prop.startsWith('--') && !seenVars.has(prop) && importantVarPrefixes.some((p) => prop.startsWith(p))) {
          seenVars.add(prop);
          const val = this.rewriteCssUrls(sourceStyle.getPropertyValue(prop), normalizedBase);
          if (val) customVars.push(`${prop}: ${val};`);
        }
      }
    }

    const noteWallpaper = this.resolveDynamicWallpaperForNote(file, normalizedBase);

    return {
      htmlClasses,
      htmlStyle,
      bodyClasses,
      bodyStyle,
      appCss,
      inlineStyles: inlineStyles.join('\n'),
      diskThemeCss,
      diskSnippetsCss,
      customVarsCss: customVars.length ? `:root, body {\n  ${customVars.join('\n  ')}\n}` : '',
      noteWallpaper
    };
  }

  buildHtmlDocument(file, renderedBodyHtml) {
    const {
      htmlClasses,
      htmlStyle,
      bodyClasses,
      bodyStyle,
      appCss,
      inlineStyles,
      diskThemeCss,
      diskSnippetsCss,
      customVarsCss,
      noteWallpaper
    } = this.collectStylesAndClasses(file);

    const title = this.escapeHtml(file.basename);

    const wallpaperLayerHtml = noteWallpaper
      ? `<div id="vault-dynamic-wallpaper" style="position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: 0; pointer-events: none; background-image: url('${this.escapeHtml(noteWallpaper.url)}'); background-size: cover; background-position: center center; background-repeat: no-repeat; ${noteWallpaper.blur > 0 ? `filter: blur(${noteWallpaper.blur}px); transform: scale(1.03);` : ''}"></div>
         <div id="vault-dynamic-wallpaper-overlay" style="position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: 0; pointer-events: none; background-color: var(--background-primary, #1e1e1e); opacity: ${noteWallpaper.opacity};"></div>`
      : '';

    const wallpaperOverrideCss = noteWallpaper
      ? `
    /* Override Obsidian's active-tab global wallpaper pseudo-elements so per-note wallpaper renders at locked 100vh */
    body::before,
    body::after,
    .app-container::before,
    .app-container::after {
      background-image: none !important;
      content: none !important;
    }
    html, body, .app-container, .horizontal-main-container, .workspace, .workspace-split, .workspace-leaf, .workspace-leaf-content, .view-content, .markdown-reading-view, .markdown-preview-view {
      background-color: transparent !important;
    }
      `
      : '';

    return `<!DOCTYPE html>
<html lang="en" class="${this.escapeHtml(htmlClasses)}" style="${this.escapeHtml(htmlStyle)}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style id="obsidian-core-app-css">
${appCss}
  </style>
  <style id="obsidian-injected-styles">
${inlineStyles}
  </style>
  <style id="obsidian-disk-theme">
${diskThemeCss}
  </style>
  <style id="obsidian-disk-snippets">
${diskSnippetsCss}
  </style>
  <style id="obsidian-computed-vars">
${customVarsCss}
  </style>
  <style id="vault-live-server-layout">
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      width: 100% !important;
      min-height: 100vh !important;
      height: auto !important;
      overflow-x: hidden !important;
      overflow-y: auto !important;
      user-select: text !important;
      -webkit-user-select: text !important;
      background-color: var(--background-primary, #1e1e1e);
      color: var(--text-normal, #dcddde);
      font-family: var(--font-text, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
    }

    ${wallpaperOverrideCss}

    /* Hide Obsidian desktop UI chrome */
    .workspace-ribbon,
    .workspace-split.mod-left-split,
    .workspace-split.mod-right-split,
    .titlebar,
    .status-bar,
    .workspace-tab-header-container,
    .view-header {
      display: none !important;
    }

    /* Unlock Obsidian workspace containers so the page scrolls naturally in Thorium */
    .app-container,
    .horizontal-main-container,
    .workspace,
    .workspace-split.mod-root,
    .workspace-tabs,
    .workspace-tab-container,
    .workspace-leaf,
    .workspace-leaf-content,
    .view-content,
    .markdown-reading-view {
      position: relative !important;
      z-index: 1 !important;
      display: block !important;
      width: 100% !important;
      height: auto !important;
      min-height: 100vh !important;
      overflow: visible !important;
      contain: none !important;
    }

    .vault-web-container {
      position: relative;
      z-index: 1;
      width: 100%;
      min-height: 100vh;
      box-sizing: border-box;
      padding: 2rem clamp(1rem, 4vw, 3.5rem) 4rem;
    }

    .vault-web-container .markdown-preview-view {
      position: static !important;
      width: 100% !important;
      height: auto !important;
      overflow: visible !important;
      padding: 0 !important;
    }

    .vault-web-container .markdown-preview-sizer {
      max-width: var(--file-line-width, 900px);
      margin: 0 auto;
      padding-bottom: 4rem;
    }

    /* Keep callout title icon, text, and fold chevron aligned horizontally on one row */
    .vault-web-container .callout-title {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .vault-web-container .callout-title-inner {
      flex: 1 1 auto;
    }

    .vault-web-container .callout-icon,
    .vault-web-container .callout-fold {
      display: inline-flex;
      align-items: center;
      flex: 0 0 auto;
    }

    /* Callout |wide and |centered support */
    .vault-web-container .callout[data-callout-metadata*="wide"] {
      width: 100% !important;
      max-width: min(92vw, 1400px) !important;
      margin-left: auto !important;
      margin-right: auto !important;
    }

    .vault-web-container .callout[data-callout-metadata*="centered"] {
      margin-left: auto !important;
      margin-right: auto !important;
    }

    /* Ensure collapsed callouts close cleanly even when snippets set display: flex !important */
    .vault-web-container .callout.is-collapsible.is-collapsed > .callout-content {
      display: none !important;
    }

    /* Code block & copy button alignment */
    .vault-web-container .markdown-rendered pre {
      position: relative !important;
      padding: 12px 44px 12px 14px !important;
      box-sizing: border-box !important;
      overflow-x: auto !important;
    }

    .vault-web-container .markdown-rendered pre code {
      display: block !important;
      white-space: pre !important;
    }

    .vault-web-container .markdown-rendered pre button.copy-code-button {
      position: absolute !important;
      top: 8px !important;
      right: 8px !important;
      left: auto !important;
      margin: 0 !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      z-index: 2 !important;
      cursor: pointer !important;
    }

    .vault-web-container img,
    .vault-web-container video {
      max-width: 100%;
      height: auto;
      border-radius: var(--radius-m, 6px);
    }

    .vault-web-container a.internal-link {
      cursor: pointer;
    }
  </style>
</head>
<body class="${this.escapeHtml(bodyClasses)}" style="${this.escapeHtml(bodyStyle)}">
  ${wallpaperLayerHtml}
  <div class="app-container">
    <div class="horizontal-main-container">
      <div class="workspace">
        <div class="workspace-split mod-vertical mod-root">
          <div class="workspace-tabs mod-active">
            <div class="workspace-tab-container">
              <div class="workspace-leaf mod-active">
                <div class="workspace-leaf-content" data-type="markdown" data-mode="preview">
                  <div class="view-content">
                    <div class="markdown-reading-view">
                      <main class="vault-web-container">
                        <div class="markdown-preview-view markdown-rendered is-readable-line-width allow-fold-headings show-indentation-guide">
                          <div class="markdown-preview-sizer markdown-preview-section">
                            ${renderedBodyHtml}
                          </div>
                        </div>
                      </main>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <script>
    // Interactive callout folding
    document.addEventListener('click', (e) => {
      const calloutTitle = e.target.closest('.callout.is-collapsible .callout-title');
      if (calloutTitle) {
        const callout = calloutTitle.closest('.callout');
        const isNowCollapsed = !callout.classList.contains('is-collapsed');
        callout.classList.toggle('is-collapsed', isNowCollapsed);
        const content = callout.querySelector('.callout-content');
        if (content) {
          if (isNowCollapsed) {
            content.style.setProperty('display', 'none', 'important');
          } else {
            content.style.removeProperty('display');
          }
        }
      }

      // Interactive copy-code button
      const copyBtn = e.target.closest('button.copy-code-button');
      if (copyBtn) {
        const pre = copyBtn.closest('pre');
        const code = pre ? pre.querySelector('code') : null;
        if (code && navigator.clipboard) {
          navigator.clipboard.writeText(code.innerText || code.textContent || '');
        }
      }
    });
  </script>
</body>
</html>`;
  }

  escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

class VaultLiveServerSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Vault Live Server Settings' });

    new Setting(containerEl)
      .setName('Server Port')
      .setDesc('Local port to serve the vault on (default: 8888).')
      .addText((text) =>
        text
          .setPlaceholder('8888')
          .setValue(String(this.plugin.settings.port))
          .onChange(async (value) => {
            const parsed = parseInt(value, 10);
            if (!isNaN(parsed) && parsed > 0 && parsed < 65536) {
              this.plugin.settings.port = parsed;
              await this.plugin.saveSettings();
              if (this.plugin.isRunning) {
                this.plugin.startServer();
              }
            }
          })
      );

    new Setting(containerEl)
      .setName('Default Landing Note')
      .setDesc('Note name or vault path served at http://localhost:8888/ (e.g., master_list.md or Folder/Index).')
      .addText((text) =>
        text
          .setPlaceholder('Home')
          .setValue(this.plugin.settings.landingNote)
          .onChange(async (value) => {
            this.plugin.settings.landingNote = value.trim() || 'Home';
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Basic Auth Username')
      .setDesc('Username required to view the served site. Leave both username and password blank to disable auth.')
      .addText((text) =>
        text
          .setPlaceholder('admin')
          .setValue(this.plugin.settings.username)
          .onChange(async (value) => {
            this.plugin.settings.username = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Basic Auth Password')
      .setDesc('Password required to view the served site.')
      .addText((text) => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder('obsidian')
          .setValue(this.plugin.settings.password)
          .onChange(async (value) => {
            this.plugin.settings.password = value;
            await this.plugin.saveSettings();
          });
      });
  }
}

module.exports = VaultLiveServerPlugin;

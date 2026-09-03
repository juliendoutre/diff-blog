(function () {
  'use strict';

  // Data lives next to the app at demo/ (local staging and GitHub Pages deploy).
  var DATA_BASE = 'demo/';

  // ============================================================
  // State
  // ============================================================
  const state = {
    data: null,
    currentChapter: 0,
    currentSection: 0,
    pendingSection: null, // when set, renderCurrent uses this instead of resuming from storage
    progress: {},       // chapterIndex -> maxSectionReached (high-water mark for progress bar)
    position: {},       // chapterIndex -> actual current section (where the user left off)
    diffCache: {},      // commit SHA -> array of file objects
    activeColumn: 'left',
    isTransitioning: false,
    wheelLock: false,
  };

  const STORAGE_KEYS = {
    progress: 'diff-blog:progress',
    theme: 'diff-blog:theme',
    position: 'diff-blog:position',
  };

  const TRANSITION_MS = 300;
  const WHEEL_COOLDOWN_MS = 400;

  // ============================================================
  // DOM references
  // ============================================================
  const el = {};
  function cacheDom() {
    el.projectTitle = document.getElementById('projectTitle');
    el.githubLink = document.getElementById('githubLink');
    el.themeToggle = document.getElementById('themeToggle');
    el.tocToggle = document.getElementById('tocToggle');
    el.tocPanel = document.getElementById('tocPanel');
    el.tocOverlay = document.getElementById('tocOverlay');
    el.tocContent = document.getElementById('tocContent');
    el.progressFill = document.getElementById('progressFill');
    el.leftColumn = document.getElementById('leftColumn');
    el.rightColumn = document.getElementById('rightColumn');
    el.sectionContent = document.getElementById('sectionContent');
    el.diffContent = document.getElementById('diffContent');
    el.navIndicator = document.getElementById('navIndicator');
  }

  // ============================================================
  // Init
  // ============================================================
  async function init() {
    cacheDom();
    loadTheme();
    setupThemeToggle();
    setupKeyboard();
    setupMouseWheel();
    setupColumnTracking();

    try {
      const res = await fetch(DATA_BASE + 'data.json');
      if (!res.ok) throw new Error('Failed to load data.json');
      state.data = await res.json();
    } catch (err) {
      el.sectionContent.innerHTML = '<p class="diff-error">Failed to load data.json: ' + escapeHtml(err.message) + '</p>';
      return;
    }

    loadProgress();
    loadPosition();
    setupTopBar();
    setupToc();
    setupRouting();
    await renderCurrent();
    updateProgress();
    showNavIndicator();
    updateTocActive();
  }

  // ============================================================
  // Top bar
  // ============================================================
  function setupTopBar() {
    el.projectTitle.textContent = state.data.title || 'Diff Blog';
    el.githubLink.href = state.data.repo || '#';
  }

  // ============================================================
  // Table of contents
  // ============================================================
  function setupToc() {
    el.tocToggle.addEventListener('click', toggleToc);
    el.tocOverlay.addEventListener('click', closeToc);
    renderToc();
  }

  function toggleToc() {
    el.tocPanel.classList.toggle('open');
    el.tocOverlay.classList.toggle('visible');
  }

  function closeToc() {
    el.tocPanel.classList.remove('open');
    el.tocOverlay.classList.remove('visible');
  }

  function renderToc() {
    let html = '';
    state.data.chapters.forEach(function (chapter, ci) {
      const chapterActive = ci === state.currentChapter ? ' active' : '';
      html += '<div class="toc-chapter">';
      html += '<button class="toc-chapter-title' + chapterActive + '" data-chapter="' + ci + '">' +
        escapeHtml(chapter.title || 'Chapter ' + (ci + 1)) + '</button>';
      html += '</div>';
    });
    el.tocContent.innerHTML = html;

    el.tocContent.querySelectorAll('.toc-chapter-title').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const ci = parseInt(btn.getAttribute('data-chapter'), 10);
        jumpTo(ci, 0);
      });
    });
  }

  function updateTocActive() {
    el.tocContent.querySelectorAll('.toc-chapter-title').forEach(function (btn) {
      const ci = parseInt(btn.getAttribute('data-chapter'), 10);
      btn.classList.toggle('active', ci === state.currentChapter);
    });
  }

  function jumpTo(chapterIndex, sectionIndex) {
    if (chapterIndex < 0 || chapterIndex >= state.data.chapters.length) return;
    state.currentChapter = chapterIndex;
    const chapter = state.data.chapters[chapterIndex];
    if (chapter.sections.length === 0) {
      state.pendingSection = null;
      renderCurrent();
      closeToc();
      showNavIndicator();
      return;
    }
    state.pendingSection = Math.min(sectionIndex, chapter.sections.length - 1);
    savePosition();
    renderCurrent();
    closeToc();
    showNavIndicator();
    updateTocActive();
  }

  // ============================================================
  // URL query params (?commit=&section=)
  // ============================================================
  function setupRouting() {
    window.addEventListener('popstate', function () {
      handleRoute();
      renderCurrent();
      showNavIndicator();
      updateTocActive();
    });
    handleRoute();
  }

  function handleRoute() {
    if (!state.data) return;
    const params = new URLSearchParams(window.location.search);
    const commit = params.get('commit');
    if (!commit) return;

    const chapterIndex = state.data.chapters.findIndex(function (c) {
      return c.commit === commit;
    });
    if (chapterIndex === -1) return;

    state.currentChapter = chapterIndex;
    const chapter = state.data.chapters[chapterIndex];
    if (chapter.sections.length === 0) {
      state.pendingSection = null;
      return;
    }

    if (params.has('section')) {
      const sectionIdx = parseInt(params.get('section'), 10);
      if (!isNaN(sectionIdx)) {
        state.pendingSection = Math.min(Math.max(0, sectionIdx), chapter.sections.length - 1);
      }
    }
  }

  function updateRoute() {
    if (!state.data) return;
    const chapter = getCurrentChapter();
    if (!chapter) return;

    const params = new URLSearchParams(window.location.search);
    const section = String(state.currentSection);
    if (params.get('commit') === chapter.commit && params.get('section') === section) {
      return;
    }

    params.set('commit', chapter.commit);
    params.set('section', section);
    const qs = params.toString();
    const url = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
    window.history.pushState(null, '', url);
  }

  // ============================================================
  // Theme
  // ============================================================
  function loadTheme() {
    const saved = localStorage.getItem(STORAGE_KEYS.theme);
    if (saved) {
      document.documentElement.setAttribute('data-theme', saved);
    }
  }

  function setupThemeToggle() {
    el.themeToggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem(STORAGE_KEYS.theme, next);
    });
  }

  // ============================================================
  // Progress (localStorage)
  // ============================================================
  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.progress);
      state.progress = raw ? JSON.parse(raw) : {};
    } catch {
      state.progress = {};
    }
  }

  function saveProgress() {
    localStorage.setItem(STORAGE_KEYS.progress, JSON.stringify(state.progress));
  }

  function loadPosition() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.position);
      if (raw) {
        const pos = JSON.parse(raw);
        if (typeof pos.chapter === 'number' && pos.chapter < state.data.chapters.length) {
          state.currentChapter = pos.chapter;
        }
        if (pos.position && typeof pos.position === 'object') {
          state.position = pos.position;
        }
        if (typeof pos.section === 'number') {
          // Legacy format: single section, migrate to per-chapter position
          state.position[state.currentChapter] = pos.section;
        }
      }
    } catch {
      /* ignore */
    }
  }

  function savePosition() {
    state.position[state.currentChapter] = state.currentSection;
    localStorage.setItem(STORAGE_KEYS.position, JSON.stringify({
      chapter: state.currentChapter,
      position: state.position,
    }));
  }

  function updateProgress() {
    const chapters = state.data.chapters;
    let total = 0;
    let read = 0;
    for (let i = 0; i < chapters.length; i++) {
      const count = chapters[i].sections.length;
      total += count;
      const maxReached = state.progress[i] || 0;
      read += Math.min(maxReached + 1, count);
    }
    const pct = total > 0 ? (read / total) * 100 : 0;
    el.progressFill.style.width = pct + '%';
  }

  function markSectionRead(chapterIndex, sectionIndex) {
    const current = state.progress[chapterIndex] ?? -1;
    if (sectionIndex > current) {
      state.progress[chapterIndex] = sectionIndex;
      saveProgress();
      updateProgress();
    }
  }

  // ============================================================
  // Chapter / section rendering
  // ============================================================
  function getCurrentChapter() {
    return state.data.chapters[state.currentChapter];
  }

  function sectionBlockHtml(chapter, index) {
    return '<div class="section-block" data-section-index="' + index + '">' +
      renderMarkdown(chapter.sections[index].content || '') +
      '</div>';
  }

  async function renderCurrent() {
    const chapter = getCurrentChapter();
    if (!chapter || chapter.sections.length === 0) {
      await renderEmptyChapter(chapter);
      return;
    }

    if (typeof state.pendingSection === 'number') {
      state.currentSection = Math.min(state.pendingSection, chapter.sections.length - 1);
      state.pendingSection = null;
    } else {
      // Resume from saved position (not high-water mark)
      const savedPos = state.position[state.currentChapter];
      const maxReached = state.progress[state.currentChapter] ?? 0;
      state.currentSection = savedPos != null
        ? Math.min(savedPos, chapter.sections.length - 1)
        : Math.min(maxReached, chapter.sections.length - 1);
    }

    state.isTransitioning = true;
    el.sectionContent.classList.add('fading');
    el.diffContent.classList.add('fading');
    await wait(TRANSITION_MS);

    // Render all sections from 0 to currentSection (progressive reveal)
    let html = '';
    for (let i = 0; i <= state.currentSection; i++) {
      html += sectionBlockHtml(chapter, i);
    }
    el.sectionContent.innerHTML = html;
    el.sectionContent.classList.remove('fading');

    // Render the full chapter diff once, then highlight the current section
    el.diffContent.innerHTML = '<div class="loading-message">Loading diff…</div>';
    el.diffContent.classList.remove('fading');
    renderDiffForChapter(chapter).then(() => {
      el.diffContent.classList.remove('fading');
      highlightSection(chapter.sections[state.currentSection]);
    }).catch((err) => {
      console.error('renderDiffForChapter failed:', err);
    });

    requestAnimationFrame(() => {
      scrollToCurrentSection();
    });

    await wait(TRANSITION_MS);
    state.isTransitioning = false;
    markSectionRead(state.currentChapter, state.currentSection);
    savePosition();
    updateRoute();
    updateTocActive();
  }

  function scrollToCurrentSection() {
    const blocks = el.sectionContent.querySelectorAll('.section-block');
    if (blocks.length === 0) return;
    const lastBlock = blocks[blocks.length - 1];
    lastBlock.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function renderEmptyChapter(chapter) {
    state.isTransitioning = true;
    el.sectionContent.classList.add('fading');
    el.diffContent.classList.add('fading');
    await wait(TRANSITION_MS);
    el.sectionContent.innerHTML = '<div class="loading-message">' +
      escapeHtml(chapter ? chapter.title : 'No chapter') + ' has no sections yet.</div>';
    el.diffContent.innerHTML = '<div class="diff-placeholder">No diff to display.</div>';
    el.sectionContent.classList.remove('fading');
    el.diffContent.classList.remove('fading');
    el.leftColumn.onscroll = null;
    await wait(TRANSITION_MS);
    state.isTransitioning = false;
  }

  // ============================================================
  // Diff fetching & parsing
  // ============================================================
  async function fetchCommitFiles(commit) {
    if (state.diffCache[commit]) return state.diffCache[commit];

    if (!commit || commit === 'TODO') {
      throw new Error('Invalid commit reference');
    }

    const res = await fetch(DATA_BASE + 'diffs/' + commit + '.json');
    if (!res.ok) throw new Error('Diff not found for commit ' + commit);
    const json = await res.json();

    const files = (json.files || []).map(function (f) {
      return { filename: f.filename, status: f.status, patch: f.patch || '' };
    });
    state.diffCache[commit] = files;
    return files;
  }

  function parsePatch(patch, filename) {
    const lines = patch.split('\n');
    const hunks = [];
    let currentHunk = null;
    let oldLine = 0;
    let newLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
      if (hunkMatch) {
        currentHunk = {
          oldStart: parseInt(hunkMatch[1], 10),
          newStart: parseInt(hunkMatch[3], 10),
          header: line,
          context: hunkMatch[5] || '',
          lines: [],
        };
        hunks.push(currentHunk);
        oldLine = currentHunk.oldStart;
        newLine = currentHunk.newStart;
        continue;
      }

      if (!currentHunk) continue;

      if (line.startsWith('\\')) {
        // "No newline at end of file" marker — skip
        continue;
      }

      if (line.startsWith('+')) {
        currentHunk.lines.push({ type: 'add', oldLine: null, newLine: newLine++, content: line.slice(1) });
      } else if (line.startsWith('-')) {
        currentHunk.lines.push({ type: 'del', oldLine: oldLine++, newLine: null, content: line.slice(1) });
      } else {
        const content = line.startsWith(' ') ? line.slice(1) : line;
        currentHunk.lines.push({ type: 'context', oldLine: oldLine++, newLine: newLine++, content: content });
      }
    }

    return { filename: filename, hunks: hunks };
  }

  async function renderDiffForChapter(chapter) {
    const commit = chapter.commit;
    try {
      const files = await fetchCommitFiles(commit);

      let html = '';
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.patch) {
          html += '<div class="diff-file" data-filename="' + escapeHtml(file.filename) + '">';
          html += '<div class="diff-file-header"><span class="diff-file-name">' +
            escapeHtml(file.filename) + '</span> <span style="margin-left:12px;color:var(--text-muted)">' +
            escapeHtml(file.status) + ' (binary or no textual diff)</span></div></div>';
          continue;
        }
        const parsed = parsePatch(file.patch, file.filename);
        html += renderDiffFileHtml(parsed);
      }

      el.diffContent.innerHTML = html;
    } catch (err) {
      console.error('Diff fetch error for commit', commit, ':', err);
      el.diffContent.innerHTML = '<div class="diff-error">Could not load diff for commit ' +
        escapeHtml(commit) + '<br><br>' + escapeHtml(err.message) + '</div>';
    }
  }

  function highlightSection(section) {
    // Clear previous highlights and dimming
    el.diffContent.querySelectorAll('.diff-row-highlight').forEach(function (r) {
      r.classList.remove('diff-row-highlight');
    });
    el.diffContent.querySelectorAll('.diff-file-highlight').forEach(function (f) {
      f.classList.remove('diff-file-highlight');
    });
    el.diffContent.querySelectorAll('.diff-file-dimmed').forEach(function (f) {
      f.classList.remove('diff-file-dimmed');
    });

    const fileEls = el.diffContent.querySelectorAll('.diff-file');

    if (!section || !section.path || section.path.trim() === '') {
      // No path: no file highlighted, none dimmed
      return;
    }

    // Find the matching diff-file element
    let targetFile = null;
    fileEls.forEach(function (f) {
      const name = f.getAttribute('data-filename');
      if (name === section.path) targetFile = f;
    });
    if (!targetFile) {
      // Fallback: partial match
      fileEls.forEach(function (f) {
        const name = f.getAttribute('data-filename');
        if (name && name.indexOf(section.path) !== -1) targetFile = f;
      });
    }
    if (!targetFile) return;

    // Highlight the target file, dim the rest
    targetFile.classList.add('diff-file-highlight');
    fileEls.forEach(function (f) {
      if (f !== targetFile) f.classList.add('diff-file-dimmed');
    });

    const from = typeof section.from === 'number' ? section.from : null;
    const to = typeof section.to === 'number' ? section.to : null;

    let firstHighlightRow = null;

    if (from !== null && to !== null) {
      const rows = targetFile.querySelectorAll('.diff-row');
      rows.forEach(function (row) {
        const type = row.getAttribute('data-type');
        const oldLine = row.getAttribute('data-old-line');
        const newLine = row.getAttribute('data-new-line');
        let match = false;
        if (type === 'add' || type === 'context') {
          if (newLine !== '') {
            const n = parseInt(newLine, 10);
            if (n >= from && n <= to) match = true;
          }
        } else if (type === 'del') {
          if (oldLine !== '') {
            const n = parseInt(oldLine, 10);
            if (n >= from && n <= to) match = true;
          }
        }
        if (match) {
          row.classList.add('diff-row-highlight');
          if (!firstHighlightRow) firstHighlightRow = row;
        }
      });
    }

    // Scroll the right column to the highlighted file or first highlighted line
    const scrollTarget = firstHighlightRow || targetFile;
    const offset = getOffsetTopWithin(scrollTarget, el.rightColumn);
    el.rightColumn.scrollTo({ top: offset - 60, behavior: 'smooth' });
  }

  function renderDiffFileHtml(parsedFile) {
    let html = '<div class="diff-file" data-filename="' + escapeHtml(parsedFile.filename) + '">';
    html += '<div class="diff-file-header"><span class="diff-file-name">' + escapeHtml(parsedFile.filename) + '</span></div>';
    html += '<div class="diff-body">';

    for (let h = 0; h < parsedFile.hunks.length; h++) {
      const hunk = parsedFile.hunks[h];
      html += '<div class="diff-hunk-header"><span>' + escapeHtml(hunk.header) + '</span>';
      if (hunk.context) {
        html += '<span class="hunk-context">' + escapeHtml(hunk.context) + '</span>';
      }
      html += '</div>';

      for (let i = 0; i < hunk.lines.length; i++) {
        const line = hunk.lines[i];
        const rowClass = 'diff-row-' + line.type;
        const oldLineStr = line.oldLine !== null ? String(line.oldLine) : '';
        const newLineStr = line.newLine !== null ? String(line.newLine) : '';

        html += '<div class="diff-row ' + rowClass + '" data-type="' + line.type + '" data-old-line="' + oldLineStr + '" data-new-line="' + newLineStr + '">';
        html += '<span class="diff-line-num">' + oldLineStr + '</span>';
        html += '<span class="diff-line-num">' + newLineStr + '</span>';
        html += '<span class="diff-line-content">' + escapeHtml(line.content || ' ') + '</span>';
        html += '</div>';
      }
    }

    html += '</div></div>';
    return html;
  }

  // ============================================================
  // Markdown rendering
  // ============================================================
  function renderMarkdown(text) {
    if (!text) return '';
    const lines = text.split('\n');
    let html = '';
    let inCodeBlock = false;
    let codeLines = [];
    let inList = false;
    let listTag = '';
    let paragraph = [];

    function flushParagraph() {
      if (paragraph.length > 0) {
        html += '<p>' + paragraph.join('<br>') + '</p>';
        paragraph = [];
      }
    }
    function flushList() {
      if (inList) {
        html += '</' + listTag + '>';
        inList = false;
      }
    }
    function flushCode() {
      if (codeLines.length > 0) {
        html += '<pre><code>' + escapeHtml(codeLines.join('\n')) + '</code></pre>';
        codeLines = [];
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Code block fence
      if (line.trim().startsWith('```')) {
        if (inCodeBlock) {
          flushCode();
          inCodeBlock = false;
        } else {
          flushParagraph();
          flushList();
          inCodeBlock = true;
        }
        continue;
      }
      if (inCodeBlock) {
        codeLines.push(line);
        continue;
      }

      // Headers
      if (/^###\s/.test(line)) { flushParagraph(); flushList(); html += '<h3>' + inline(line.replace(/^###\s/, '')) + '</h3>'; continue; }
      if (/^##\s/.test(line))  { flushParagraph(); flushList(); html += '<h2>' + inline(line.replace(/^##\s/, '')) + '</h2>'; continue; }
      if (/^#\s/.test(line))   { flushParagraph(); flushList(); html += '<h1>' + inline(line.replace(/^#\s/, '')) + '</h1>'; continue; }

      // Horizontal rule
      if (/^---+\s*$/.test(line)) { flushParagraph(); flushList(); html += '<hr>'; continue; }

      // Blockquote
      if (/^>\s/.test(line)) { flushParagraph(); flushList(); html += '<blockquote>' + inline(line.replace(/^>\s/, '')) + '</blockquote>'; continue; }

      // Unordered list
      if (/^[-*]\s/.test(line)) {
        flushParagraph();
        if (!inList || listTag !== 'ul') { flushList(); inList = true; listTag = 'ul'; html += '<ul>'; }
        html += '<li>' + inline(line.replace(/^[-*]\s/, '')) + '</li>';
        continue;
      }

      // Ordered list
      if (/^\d+\.\s/.test(line)) {
        flushParagraph();
        if (!inList || listTag !== 'ol') { flushList(); inList = true; listTag = 'ol'; html += '<ol>'; }
        html += '<li>' + inline(line.replace(/^\d+\.\s/, '')) + '</li>';
        continue;
      }

      // Empty line
      if (line.trim() === '') {
        flushParagraph();
        flushList();
        continue;
      }

      // Normal text
      flushList();
      paragraph.push(inline(line));
    }

    flushParagraph();
    flushList();
    if (inCodeBlock) flushCode();

    return html;
  }

  function inline(text) {
    let t = escapeHtml(text);
    // Links
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // Bold
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    // Italic
    t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    t = t.replace(/_([^_]+)_/g, '<em>$1</em>');
    // Inline code
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    return t;
  }

  // ============================================================
  // Navigation
  // ============================================================
  function setupKeyboard() {
    document.addEventListener('keydown', function (e) {
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          navigateSection(-1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          navigateSection(1);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          navigateChapter(-1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          navigateChapter(1);
          break;
      }
    });
  }

  function navigateSection(direction) {
    const chapter = getCurrentChapter();
    if (!chapter || chapter.sections.length === 0) return;

    if (direction === 1) {
      // Down: append next section with fade-in
      if (state.currentSection >= chapter.sections.length - 1) return;
      appendSection(chapter);
    } else {
      // Up: remove last section with fade-out
      if (state.currentSection <= 0) return;
      removeLastSection(chapter);
    }
  }

  function appendSection(chapter) {
    state.currentSection++;

    // Append new block (starts faded, then fades in)
    const div = document.createElement('div');
    div.innerHTML = sectionBlockHtml(chapter, state.currentSection);
    const block = div.firstChild;
    block.classList.add('fading');
    el.sectionContent.appendChild(block);
    requestAnimationFrame(() => {
      block.classList.remove('fading');
    });

    // Highlight the new section in the existing diff
    highlightSection(chapter.sections[state.currentSection]);

    markSectionRead(state.currentChapter, state.currentSection);
    savePosition();
    showNavIndicator();
    updateRoute();
    updateTocActive();

    // Scroll immediately so the new section is visible
    scrollToCurrentSection();
  }

  function removeLastSection(chapter) {
    state.currentSection--;

    const blocks = el.sectionContent.querySelectorAll('.section-block');
    if (blocks.length === 0) return;
    const lastBlock = blocks[blocks.length - 1];
    lastBlock.classList.add('fading');

    // Highlight the previous section in the existing diff
    highlightSection(chapter.sections[state.currentSection]);

    savePosition();
    showNavIndicator();
    updateRoute();
    updateTocActive();

    setTimeout(() => {
      lastBlock.remove();
    }, TRANSITION_MS);
  }

  function navigateChapter(direction) {
    const newChapter = state.currentChapter + direction;
    if (newChapter < 0 || newChapter >= state.data.chapters.length) return;

    state.currentChapter = newChapter;
    savePosition();
    renderCurrent();
    showNavIndicator();
  }

  // ============================================================
  // Mouse wheel
  // ============================================================
  function setupColumnTracking() {
    el.leftColumn.addEventListener('mouseenter', function () { state.activeColumn = 'left'; });
    el.rightColumn.addEventListener('mouseenter', function () { state.activeColumn = 'right'; });
  }

  function setupMouseWheel() {
    el.leftColumn.addEventListener('wheel', function (e) {
      const chapter = getCurrentChapter();
      if (!chapter || chapter.sections.length === 0) return;

      e.preventDefault();
      if (state.wheelLock) return;
      state.wheelLock = true;
      setTimeout(function () { state.wheelLock = false; }, WHEEL_COOLDOWN_MS);

      const direction = e.deltaY > 0 ? 1 : -1;
      navigateSection(direction);
    }, { passive: false });
  }

  // ============================================================
  // Navigation indicator
  // ============================================================
  let navIndicatorTimer = null;
  function showNavIndicator() {
    const chapter = getCurrentChapter();
    const totalSections = chapter ? chapter.sections.length : 0;
    const chapterNum = state.currentChapter + 1;
    const totalChapters = state.data.chapters.length;
    const sectionNum = Math.min(state.currentSection + 1, totalSections);

    let text;
    if (totalSections === 0) {
      text = '<span class="nav-current">Chapter ' + chapterNum + '</span> / ' + totalChapters;
    } else {
      text = '<span class="nav-current">Chapter ' + chapterNum + '</span> / ' + totalChapters +
        ' · Section ' + sectionNum + ' / ' + totalSections;
    }

    el.navIndicator.innerHTML = text;
    el.navIndicator.classList.add('visible');

    clearTimeout(navIndicatorTimer);
    navIndicatorTimer = setTimeout(function () {
      el.navIndicator.classList.remove('visible');
    }, 2500);
  }

  // ============================================================
  // Utilities
  // ============================================================
  function escapeHtml(text) {
    if (text == null) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getOffsetTopWithin(element, container) {
    let top = 0;
    let node = element;
    while (node && node !== container) {
      top += node.offsetTop;
      node = node.offsetParent;
    }
    return top;
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // ============================================================
  // Boot
  // ============================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

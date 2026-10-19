(() => {
  'use strict';

  const SIZE = 8;
  const TYPE_COUNT = 8;
  const LEVEL_TARGETS = [1000, 2500, 5000];
  const STARTING_MOVES = [25, 23, 21];
  const GLYPHS = ['●', '◆', '✿', '✦', '♥', '☾', '✧', '■'];
  const TYPE_NAMES = ['berry', 'lemon', 'mint', 'blueberry', 'plum', 'rose', 'lime', 'lagoon'];
  const TYPE_COLORS = ['#e75d54', '#f2b943', '#55b899', '#63aada', '#a27acb', '#e66d9e', '#9cb64c', '#559fa0'];
  const $ = (selector) => document.querySelector(selector);
  const boardElement = $('#board');
  const modal = $('#modal');
  const modalButton = $('#modalButton');
  const cells = [];
  const tileElements = new Map();

  const state = {
    board: [],
    score: 0,
    levelScore: 0,
    level: 1,
    moves: STARTING_MOVES[0],
    highScore: readHighScore(),
    selected: null,
    pointerStart: null,
    busy: false,
    paused: false,
    soundOn: false,
    musicOn: false,
    finished: false,
    nextId: 1,
    audio: null,
    musicTimer: null,
    musicStep: 0,
    modalAction: null
  };

  function readHighScore() {
    try { return Number(localStorage.getItem('sugar-rush-high-score')) || 0; }
    catch { return 0; }
  }

  function writeHighScore() {
    try { localStorage.setItem('sugar-rush-high-score', String(state.highScore)); }
    catch { /* Storage can be unavailable in private browsing. */ }
  }

  function makeTile(type = randomType(), special = null) {
    return { id: state.nextId++, type, special };
  }

  function randomType() { return Math.floor(Math.random() * TYPE_COUNT); }
  function wait(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
  function cellIndex(row, column) { return row * SIZE + column; }
  function isInside(row, column) { return row >= 0 && row < SIZE && column >= 0 && column < SIZE; }

  function buildBoardCells() {
    const fragment = document.createDocumentFragment();
    for (let row = 0; row < SIZE; row += 1) {
      for (let column = 0; column < SIZE; column += 1) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.setAttribute('role', 'gridcell');
        cell.tabIndex = -1;
        cell.dataset.row = String(row);
        cell.dataset.column = String(column);
        fragment.append(cell);
        cells.push(cell);
      }
    }
    boardElement.append(fragment);
    boardElement.setAttribute('aria-rowcount', String(SIZE));
    boardElement.setAttribute('aria-colcount', String(SIZE));
    boardElement.addEventListener('pointerdown', onPointerDown);
    boardElement.addEventListener('pointerup', onPointerUp);
    boardElement.addEventListener('pointercancel', () => { state.pointerStart = null; });
    boardElement.addEventListener('keydown', onBoardKeyDown);
    boardElement.addEventListener('dragstart', (event) => event.preventDefault());
  }

  function createInitialBoard() {
    state.board = [];
    for (let row = 0; row < SIZE; row += 1) {
      const nextRow = [];
      for (let column = 0; column < SIZE; column += 1) {
        let type;
        do { type = randomType(); }
        while ((column >= 2 && nextRow[column - 1].type === type && nextRow[column - 2].type === type) ||
          (row >= 2 && state.board[row - 1][column].type === type && state.board[row - 2][column].type === type));
        nextRow.push(makeTile(type));
      }
      state.board.push(nextRow);
    }
  }

  function renderBoard() {
    const oldElements = new Map(tileElements);
    const oldRects = new Map();
    for (const [id, element] of oldElements) {
      if (element.isConnected) oldRects.set(id, element.getBoundingClientRect());
    }
    const present = new Set();

    for (let row = 0; row < SIZE; row += 1) {
      for (let column = 0; column < SIZE; column += 1) {
        const tile = state.board[row][column];
        const cell = cells[cellIndex(row, column)];
        if (!tile) {
          cell.replaceChildren();
          continue;
        }
        present.add(tile.id);
        let candy = tileElements.get(tile.id);
        const isNew = !candy;
        if (!candy) {
          candy = document.createElement('span');
          candy.className = 'candy';
          candy.setAttribute('aria-hidden', 'true');
          tileElements.set(tile.id, candy);
        }
        candy.classList.remove('is-clearing', 'is-bomb', 'is-stripe', 'horizontal', 'vertical');
        candy.classList.add(`type-${tile.type}`);
        if (tile.special === 'bomb') candy.classList.add('is-bomb');
        if (tile.special === 'row' || tile.special === 'column') {
          candy.classList.add('is-stripe', tile.special === 'row' ? 'horizontal' : 'vertical');
        }
        candy.textContent = tile.special === 'bomb' ? '✹' : GLYPHS[tile.type];
        candy.title = tile.special === 'bomb' ? 'Color bomb' : tile.special ? 'Striped candy' : TYPE_NAMES[tile.type];
        cell.append(candy);

        const previous = oldRects.get(tile.id);
        if (previous && !isNew) {
          const current = candy.getBoundingClientRect();
          const deltaX = previous.left - current.left;
          const deltaY = previous.top - current.top;
          if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
            candy.animate([
              { transform: `translate(${deltaX}px, ${deltaY}px)` },
              { transform: 'translate(0, 0)' }
            ], { duration: 190, easing: 'cubic-bezier(.2,.8,.2,1)' });
          }
        } else if (isNew) {
          candy.classList.add('is-new');
          setTimeout(() => candy.classList.remove('is-new'), 340);
        }
      }
    }

    for (const [id, element] of tileElements) {
      if (!present.has(id)) {
        element.remove();
        tileElements.delete(id);
      }
    }
    updateCellLabels();
  }

  function updateCellLabels() {
    for (let row = 0; row < SIZE; row += 1) {
      for (let column = 0; column < SIZE; column += 1) {
        const tile = state.board[row][column];
        const description = tile.special === 'bomb' ? 'color bomb' : tile.special ? 'striped candy' : TYPE_NAMES[tile.type];
        cells[cellIndex(row, column)].setAttribute('aria-label', `${description}, row ${row + 1}, column ${column + 1}`);
      }
    }
  }

  function findMatches() {
    const matches = [];
    for (let row = 0; row < SIZE; row += 1) {
      let start = 0;
      while (start < SIZE) {
        const tile = state.board[row][start];
        if (!tile) { start += 1; continue; }
        let end = start + 1;
        while (end < SIZE && state.board[row][end]?.type === tile.type) end += 1;
        if (end - start >= 3) matches.push({ direction: 'row', length: end - start, positions: Array.from({ length: end - start }, (_, offset) => [row, start + offset]) });
        start = end;
      }
    }
    for (let column = 0; column < SIZE; column += 1) {
      let start = 0;
      while (start < SIZE) {
        const tile = state.board[start][column];
        if (!tile) { start += 1; continue; }
        let end = start + 1;
        while (end < SIZE && state.board[end][column]?.type === tile.type) end += 1;
        if (end - start >= 3) matches.push({ direction: 'column', length: end - start, positions: Array.from({ length: end - start }, (_, offset) => [start + offset, column]) });
        start = end;
      }
    }
    return matches;
  }

  function hasAvailableMove() {
    for (let row = 0; row < SIZE; row += 1) {
      for (let column = 0; column < SIZE; column += 1) {
        for (const [nextRow, nextColumn] of [[row, column + 1], [row + 1, column]]) {
          if (!isInside(nextRow, nextColumn)) continue;
          const first = state.board[row][column];
          const second = state.board[nextRow][nextColumn];
          if (!first || !second) continue;
          if (first.special || second.special) return true;
          state.board[row][column] = second;
          state.board[nextRow][nextColumn] = first;
          const createsMatch = findMatches().length > 0;
          state.board[row][column] = first;
          state.board[nextRow][nextColumn] = second;
          if (createsMatch) return true;
        }
      }
    }
    return false;
  }

  function selectCell(row, column) {
    if (state.busy || state.paused || state.finished) return;
    if (!state.selected) {
      state.selected = [row, column];
    } else if (state.selected[0] === row && state.selected[1] === column) {
      state.selected = null;
    } else if (areAdjacent(state.selected, [row, column])) {
      const from = state.selected;
      state.selected = null;
      void swapCandies(from, [row, column]);
    } else {
      state.selected = [row, column];
    }
    updateSelection();
  }

  function areAdjacent(first, second) {
    return Math.abs(first[0] - second[0]) + Math.abs(first[1] - second[1]) === 1;
  }

  function updateSelection() {
    cells.forEach((cell) => cell.classList.remove('is-selected'));
    if (state.selected) cells[cellIndex(...state.selected)].classList.add('is-selected');
  }

  function onPointerDown(event) {
    const cell = event.target.closest('.cell');
    if (!cell || state.busy || state.paused || state.finished) return;
    event.preventDefault();
    state.pointerStart = [Number(cell.dataset.row), Number(cell.dataset.column)];
  }

  function onPointerUp(event) {
    if (!state.pointerStart) return;
    const from = state.pointerStart;
    state.pointerStart = null;
    const underPointer = document.elementFromPoint(event.clientX, event.clientY)?.closest('.cell');
    if (!underPointer) return;
    const to = [Number(underPointer.dataset.row), Number(underPointer.dataset.column)];
    if (from[0] !== to[0] || from[1] !== to[1]) {
      if (areAdjacent(from, to)) {
        state.selected = null;
        updateSelection();
        void swapCandies(from, to);
      } else {
        state.selected = to;
        updateSelection();
      }
    } else {
      selectCell(to[0], to[1]);
    }
  }

  function onBoardKeyDown(event) {
    const cell = event.target.closest('.cell');
    if (!cell) return;
    const row = Number(cell.dataset.row);
    const column = Number(cell.dataset.column);
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (moves[event.key]) {
      event.preventDefault();
      const [rowStep, columnStep] = moves[event.key];
      const nextRow = Math.max(0, Math.min(SIZE - 1, row + rowStep));
      const nextColumn = Math.max(0, Math.min(SIZE - 1, column + columnStep));
      cells[cellIndex(row, column)].tabIndex = -1;
      cells[cellIndex(nextRow, nextColumn)].tabIndex = 0;
      cells[cellIndex(nextRow, nextColumn)].focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectCell(row, column);
    }
  }

  async function swapCandies(from, to) {
    if (state.busy || state.paused || state.finished || state.moves <= 0 || !areAdjacent(from, to)) return;
    const first = state.board[from[0]][from[1]];
    const second = state.board[to[0]][to[1]];
    if (!first || !second) return;
    state.busy = true;
    swapTiles(from, to);
    renderBoard();
    await wait(195);

    const forcedSpecialSwap = Boolean(first.special || second.special);
    if (!forcedSpecialSwap && findMatches().length === 0) {
      swapTiles(from, to);
      renderBoard();
      playSound('invalid');
      state.busy = false;
      return;
    }

    state.moves -= 1;
    updateHud();
    playSound('swap');
    const initialSpecials = forcedSpecialSwap ? [first, second] : [];
    await resolveBoard(initialSpecials);
    if (!state.finished && state.moves > 0 && !hasAvailableMove()) {
      reshuffleBoard();
      setBadge('FRESH BOARD', false);
    }
    state.busy = false;
    if (state.level > LEVEL_TARGETS.length) {
      finishGame(true);
    } else if (state.moves <= 0) {
      finishGame(false);
    }
  }

  function swapTiles(first, second) {
    [state.board[first[0]][first[1]], state.board[second[0]][second[1]]] =
      [state.board[second[0]][second[1]], state.board[first[0]][first[1]]];
  }

  async function resolveBoard(initialSpecials = []) {
    let combo = 0;
    let forced = initialSpecials;
    let safety = 0;
    while (safety < 30) {
      safety += 1;
      const runs = findMatches();
      if (!runs.length && !forced.length) break;
      combo += 1;
      const matched = new Set();
      const protectedIds = new Set();
      const scoreRuns = [];

      for (const run of runs) {
        scoreRuns.push(run.length >= 5 ? 500 : run.length === 4 ? 250 : 100);
        for (const [row, column] of run.positions) matched.add(state.board[row][column].id);
      }

      for (const run of runs) {
        if (run.length < 4) continue;
        const positions = run.positions;
        let pivot = positions.find(([row, column]) => forced.some((tile) => tile.id === state.board[row][column]?.id));
        if (!pivot) pivot = positions[Math.floor(positions.length / 2)];
        let tile = state.board[pivot[0]][pivot[1]];
        if (protectedIds.has(tile.id)) {
          const alternative = positions.find(([row, column]) => !protectedIds.has(state.board[row][column].id));
          if (!alternative) continue;
          pivot = alternative;
          tile = state.board[pivot[0]][pivot[1]];
        }
        tile.special = run.length >= 5 ? 'bomb' : run.direction;
        protectedIds.add(tile.id);
      }

      const clear = new Set(matched);
      const specialQueue = [];
      for (const tile of forced) {
        clear.add(tile.id);
        if (tile.special) specialQueue.push(tile);
      }
      for (const id of matched) {
        const tile = findTile(id);
        if (tile?.special && !protectedIds.has(id)) specialQueue.push(tile);
      }

      const triggered = new Set();
      while (specialQueue.length) {
        const tile = specialQueue.pop();
        if (!tile || triggered.has(tile.id) || protectedIds.has(tile.id)) continue;
        triggered.add(tile.id);
        if (tile.special === 'bomb') {
          const pairedTile = forced.find((candidate) => candidate.id !== tile.id && !candidate.special);
          const targetType = pairedTile?.type ?? tile.type;
          for (const row of state.board) for (const candidate of row) {
            if (candidate?.type === targetType) addToClear(candidate);
          }
        } else if (tile.special === 'row' || tile.special === 'column') {
          const position = findTilePosition(tile.id);
          if (!position) continue;
          for (let offset = 0; offset < SIZE; offset += 1) {
            const row = tile.special === 'row' ? position[0] : offset;
            const column = tile.special === 'row' ? offset : position[1];
            const candidate = state.board[row][column];
            if (candidate) addToClear(candidate);
          }
        }
      }

      function addToClear(tile) {
        if (protectedIds.has(tile.id)) return;
        if (!clear.has(tile.id)) clear.add(tile.id);
        if (tile.special && !triggered.has(tile.id)) specialQueue.push(tile);
      }

      const removable = [...clear].filter((id) => !protectedIds.has(id)).map(findTile).filter(Boolean);
      if (!removable.length) break;
      const basePoints = scoreRuns.length
        ? scoreRuns.reduce((total, points) => total + points, 0)
        : Math.max(100, Math.floor(removable.length / 3) * 100);
      const earned = basePoints * combo;
      setBadge(combo > 1 ? `COMBO ×${combo}` : `${removable.length} SWEET!`, combo > 1);
      addScore(earned);
      playSound(combo > 1 ? 'combo' : 'match');
      for (const tile of removable) tileElements.get(tile.id)?.classList.add('is-clearing');
      makeParticles(removable);
      await wait(230);

      for (let row = 0; row < SIZE; row += 1) {
        for (let column = 0; column < SIZE; column += 1) {
          if (state.board[row][column] && clear.has(state.board[row][column].id) && !protectedIds.has(state.board[row][column].id)) {
            state.board[row][column] = null;
          }
        }
      }
      applyGravity();
      renderBoard();
      forced = [];
      await wait(205);
      if (state.level > LEVEL_TARGETS.length) break;
    }
    setBadge(combo > 1 ? `×${combo} CASCADE` : 'READY!', combo > 1);
  }

  function findTile(id) {
    for (const row of state.board) for (const tile of row) if (tile?.id === id) return tile;
    return null;
  }

  function findTilePosition(id) {
    for (let row = 0; row < SIZE; row += 1) {
      for (let column = 0; column < SIZE; column += 1) {
        if (state.board[row][column]?.id === id) return [row, column];
      }
    }
    return null;
  }

  function applyGravity() {
    for (let column = 0; column < SIZE; column += 1) {
      const survivors = [];
      for (let row = SIZE - 1; row >= 0; row -= 1) {
        if (state.board[row][column]) survivors.push(state.board[row][column]);
      }
      for (let row = SIZE - 1; row >= 0; row -= 1) {
        state.board[row][column] = survivors[SIZE - 1 - row] ?? makeTile();
      }
    }
  }

  function addScore(points) {
    state.score += points;
    state.levelScore += points;
    if (state.score > state.highScore) {
      state.highScore = state.score;
      writeHighScore();
    }
    while (state.level <= LEVEL_TARGETS.length && state.levelScore >= LEVEL_TARGETS[state.level - 1]) {
      state.levelScore -= LEVEL_TARGETS[state.level - 1];
      state.level += 1;
      if (state.level <= LEVEL_TARGETS.length) {
        state.moves = STARTING_MOVES[state.level - 1];
        playSound('level');
        setBadge(`LEVEL ${state.level}!`, true);
      }
    }
    updateHud();
  }

  function updateHud() {
    $('#scoreValue').textContent = state.score.toLocaleString();
    $('#highScoreValue').textContent = state.highScore.toLocaleString();
    $('#movesValue').textContent = String(state.moves);
    const levelIndex = Math.min(state.level - 1, LEVEL_TARGETS.length - 1);
    const target = LEVEL_TARGETS[levelIndex];
    $('#levelNumber').textContent = String(Math.min(state.level, LEVEL_TARGETS.length));
    $('#goalValue').textContent = target.toLocaleString();
    $('#progressCurrent').textContent = Math.min(state.levelScore, target).toLocaleString();
    $('#progressTarget').textContent = target.toLocaleString();
    $('#progressFill').style.width = `${Math.min(100, (state.levelScore / target) * 100)}%`;
  }

  function setBadge(text, hot) {
    const badge = $('#comboBadge');
    badge.textContent = text;
    badge.classList.toggle('is-hot', hot);
  }

  function makeParticles(tiles) {
    const burst = tiles.length >= 4 ? Math.min(36, tiles.length * 3) : Math.min(12, tiles.length * 2);
    for (const tile of tiles) {
      const position = findTilePosition(tile.id);
      if (!position) continue;
      const cellRect = cells[cellIndex(...position)].getBoundingClientRect();
      const boardRect = boardElement.getBoundingClientRect();
      const x = cellRect.left - boardRect.left + cellRect.width / 2;
      const y = cellRect.top - boardRect.top + cellRect.height / 2;
      const amount = tiles.length >= 4 ? Math.ceil(burst / tiles.length) : 2;
      for (let index = 0; index < amount; index += 1) {
        const particle = document.createElement('i');
        const angle = Math.random() * Math.PI * 2;
        const distance = 18 + Math.random() * 48;
        particle.className = 'particle';
        particle.style.setProperty('--x', `${x}px`);
        particle.style.setProperty('--y', `${y}px`);
        particle.style.setProperty('--size', `${3 + Math.random() * 5}px`);
        particle.style.setProperty('--color', TYPE_COLORS[tile.type]);
        particle.style.setProperty('--tx', `${Math.cos(angle) * distance}px`);
        particle.style.setProperty('--ty', `${Math.sin(angle) * distance}px`);
        $('#boardFlash').append(particle);
        setTimeout(() => particle.remove(), 650);
      }
    }
  }

  function reshuffleBoard() {
    const tiles = state.board.flat().filter(Boolean);
    for (let attempt = 0; attempt < 80; attempt += 1) {
      for (let index = tiles.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [tiles[index], tiles[swapIndex]] = [tiles[swapIndex], tiles[index]];
      }
      state.board = Array.from({ length: SIZE }, (_, row) => tiles.slice(row * SIZE, (row + 1) * SIZE));
      if (findMatches().length === 0 && hasAvailableMove()) break;
    }
    renderBoard();
  }

  function openModal({ icon, kicker, title, copy, button, action }) {
    $('#modalIcon').textContent = icon;
    $('#modalKicker').textContent = kicker;
    $('#modalTitle').textContent = title;
    $('#modalCopy').textContent = copy;
    modalButton.innerHTML = `${button} <span aria-hidden="true">→</span>`;
    state.modalAction = action;
    modal.classList.remove('is-hidden');
  }

  function closeModal() { modal.classList.add('is-hidden'); }

  function finishGame(won) {
    state.finished = true;
    state.paused = false;
    if (won) {
      playSound('level');
      openModal({
        icon: '✦', kicker: 'A PERFECT LITTLE ADVENTURE', title: 'You did it!',
        copy: `You scored ${state.score.toLocaleString()} points and completed every level.`,
        button: 'Play again', action: restartGame
      });
    } else {
      openModal({
        icon: '✧', kicker: 'THAT WAS SWEET', title: 'Out of moves!',
        copy: `You scored ${state.score.toLocaleString()} points. Your next run is just a little sweeter.`,
        button: 'Try again', action: restartGame
      });
    }
  }

  function restartGame() {
    if (state.busy) return;
    closeModal();
    state.score = 0;
    state.levelScore = 0;
    state.level = 1;
    state.moves = STARTING_MOVES[0];
    state.selected = null;
    state.pointerStart = null;
    state.busy = false;
    state.paused = false;
    state.finished = false;
    state.nextId = 1;
    setBadge('READY?', false);
    createInitialBoard();
    renderBoard();
    updateHud();
    boardElement.focus({ preventScroll: true });
  }

  function pauseGame() {
    if (state.busy || state.finished) return;
    state.paused = true;
    openModal({
      icon: 'Ⅱ', kicker: 'TAKE YOUR TIME', title: 'Game paused',
      copy: 'Your candy garden will be right here when you are ready.',
      button: 'Resume game', action: () => { state.paused = false; closeModal(); }
    });
  }

  function toggleTheme() {
    const dark = document.body.classList.toggle('dark-mode');
    $('#themeButton').setAttribute('aria-pressed', String(dark));
    $('#themeButton').setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    try { localStorage.setItem('sugar-rush-dark-mode', String(dark)); }
    catch { /* Theme preference is optional. */ }
  }

  function getAudio() {
    if (!state.audio) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      state.audio = new AudioContextClass();
    }
    if (state.audio.state === 'suspended') void state.audio.resume();
    return state.audio;
  }

  function tone(frequency, duration, waveform = 'sine', volume = 0.035, delay = 0) {
    const audio = getAudio();
    if (!audio) return;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const start = audio.currentTime + delay;
    oscillator.type = waveform;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  function playSound(kind) {
    if (!state.soundOn) return;
    if (kind === 'swap') tone(560, 0.09, 'triangle', 0.025);
    if (kind === 'invalid') tone(180, 0.13, 'sine', 0.018);
    if (kind === 'match') { tone(660, 0.12, 'sine'); tone(880, 0.17, 'sine', 0.028, 0.06); }
    if (kind === 'combo') { tone(660, 0.16, 'triangle'); tone(880, 0.16, 'triangle', 0.035, 0.07); tone(1100, 0.2, 'triangle', 0.035, 0.14); }
    if (kind === 'level') { [523, 659, 784, 1047].forEach((note, index) => tone(note, 0.3, 'sine', 0.035, index * 0.11)); }
  }

  function playMusicNote() {
    if (!state.musicOn) return;
    const melody = [392, 523, 659, 523, 440, 587, 698, 587];
    tone(melody[state.musicStep % melody.length], 0.38, 'sine', 0.009);
    state.musicStep += 1;
  }

  function toggleSound() {
    state.soundOn = !state.soundOn;
    const button = $('#soundButton');
    button.setAttribute('aria-pressed', String(state.soundOn));
    button.setAttribute('aria-label', state.soundOn ? 'Turn sound effects off' : 'Turn sound effects on');
    button.title = state.soundOn ? 'Sound effects on' : 'Sound effects off';
    if (state.soundOn) playSound('swap');
  }

  function toggleMusic() {
    state.musicOn = !state.musicOn;
    const button = $('#musicButton');
    button.setAttribute('aria-pressed', String(state.musicOn));
    button.setAttribute('aria-label', state.musicOn ? 'Turn music off' : 'Turn music on');
    button.title = state.musicOn ? 'Music on' : 'Music off';
    if (state.musicOn) {
      getAudio();
      playMusicNote();
      state.musicTimer = setInterval(playMusicNote, 520);
    } else {
      clearInterval(state.musicTimer);
    }
  }

  $('#restartButton').addEventListener('click', restartGame);
  $('#pauseButton').addEventListener('click', pauseGame);
  $('#themeButton').addEventListener('click', toggleTheme);
  $('#soundButton').addEventListener('click', toggleSound);
  $('#musicButton').addEventListener('click', toggleMusic);
  modalButton.addEventListener('click', () => state.modalAction?.());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.paused) {
      state.paused = false;
      closeModal();
    }
  });

  try {
    if (localStorage.getItem('sugar-rush-dark-mode') === 'true') document.body.classList.add('dark-mode');
  } catch { /* Theme preference is optional. */ }

  buildBoardCells();
  createInitialBoard();
  renderBoard();
  updateHud();
})();

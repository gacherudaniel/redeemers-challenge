/*
 * The game hub: the participant menu, navigation between games, and the shared header
 * (title, sound, settings). Each game lives in games/; the session rules in shared/.
 *
 * Routes: #/ (menu) and #/play/<game-id>. A game that is hidden, disabled or unknown is
 * never mounted: the route shows "not available" instead. In the Apps Script version the
 * route comes from the page URL (?game=…) because the app runs inside a Google frame.
 */
(function (root) {
  'use strict';

  const U = root.HubUtil;
  const Store = root.HubStore;
  const Prefs = root.HubPrefs;
  const $ = U.$;

  const INFO = {
    'gleaners-rush': { kind: 'Arcade', icon: 'i-stalk', meta: (s) => s.roundSec + ' s · ' + U.plural(s.lives, 'life', 'lives'), action: 'Play' },
    'redeemers-challenge': { kind: 'Quiz', icon: 'i-book', meta: () => '8 questions on Ruth 4', action: 'Play' },
    'road-to-bethlehem': { kind: 'Puzzle', icon: 'i-road', meta: (s) => (s.timerMode === 'total' ? U.formatClock(s.totalSec * 1000) + ' round' : s.perLevelSec + ' s per level'), action: 'Play' },
    'team-showdown': { kind: 'Team game show', icon: 'i-buzz', meta: (s) => s.teamCount + ' teams · buzzers', action: 'Join' },
  };
  const REASONS = {
    open: 'Open',
    waiting: 'Waiting for the facilitator',
    paused: 'Paused',
    ended: 'Finished',
    preview: 'Preview',
  };

  const ds = document.body.dataset;
  const query = new URLSearchParams(root.location.search);
  const isGas = !!(root.google && root.google.script && root.google.script.run);
  const wantsPreview = ds.preview === '1' || query.get('preview') === '1';

  let route = { name: 'hub', game: null };
  let mountedId = null;
  let leaveArmedUntil = 0;
  let lastLive = null;

  // ───────────── Header ─────────────

  function renderSoundButton() {
    const on = Prefs.sound();
    const btn = $('soundBtn');
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? 'Sound effects on' : 'Sound effects off');
    btn.querySelector('use').setAttribute('href', on ? '#i-sound-on' : '#i-sound-off');
    $('soundCheck').checked = on;
  }

  function setSound(on) {
    Prefs.set({ sound: !!on });
    renderSoundButton();
    if (on) {
      root.HubSfx.unlock();
      root.HubSfx.play('catch');
    }
  }

  $('soundBtn').addEventListener('click', () => {
    setSound(!Prefs.sound());
    U.toast(Prefs.sound() ? 'Sound effects on' : 'Sound effects off', 1600);
  });
  $('soundCheck').addEventListener('change', (e) => setSound(e.target.checked));

  $('settingsBtn').addEventListener('click', () => {
    $('themeSelect').value = Prefs.get().theme;
    $('soundCheck').checked = Prefs.sound();
    const dialog = $('settingsDialog');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  });
  $('settingsDialog').addEventListener('submit', () => {
    const dialog = $('settingsDialog');
    if (typeof dialog.showModal !== 'function') dialog.removeAttribute('open');
  });
  $('themeSelect').addEventListener('change', (e) => Prefs.set({ theme: e.target.value }));

  function busy() {
    if (route.name !== 'play') return false;
    if (route.game === 'redeemers-challenge') return root.RedeemerGame.isBusy();
    const g = root.HubGames[route.game];
    return !!(g && g.isBusy());
  }

  /** Leaving mid-game needs a second tap, so a stray touch on a projector doesn't end a round. */
  function goHomeGuarded() {
    if (busy() && Date.now() > leaveArmedUntil) {
      leaveArmedUntil = Date.now() + 3000;
      U.toast('Tap again to leave this game.');
      return;
    }
    navigate({ name: 'hub' });
  }
  $('brandBtn').addEventListener('click', goHomeGuarded);
  $('hubBackBtn').addEventListener('click', goHomeGuarded);
  $('blockedBack').addEventListener('click', () => navigate({ name: 'hub' }));

  // ───────────── Routing ─────────────

  function parseHash() {
    const m = /^#\/play\/([a-z-]+)/.exec(root.location.hash || '');
    return m ? { name: 'play', game: m[1] } : { name: 'hub' };
  }

  function initialRoute() {
    if (ds.game) return { name: 'play', game: ds.game };
    if (query.get('game')) return { name: 'play', game: query.get('game') };
    return parseHash();
  }

  function navigate(next) {
    if (!isGas) {
      const hash = next.name === 'play' ? '#/play/' + next.game : '#/';
      if (root.location.hash !== hash) {
        root.location.hash = hash; // triggers hashchange → apply()
        return;
      }
    }
    route = next;
    apply();
  }

  root.addEventListener('hashchange', () => {
    if (isGas) return;
    route = parseHash();
    apply();
  });

  function unmountCurrent() {
    if (!mountedId) return;
    if (mountedId === 'redeemers-challenge') {
      root.RedeemerGame.leave();
      $('redeemer-root').hidden = true;
    } else if (root.HubGames[mountedId]) root.HubGames[mountedId].unmount();
    mountedId = null;
    $('gameRoot').textContent = '';
  }

  function showScreen(name) {
    $('screen-hub').hidden = name !== 'hub';
    $('screen-play').hidden = name !== 'play';
    $('screen-blocked').hidden = name !== 'blocked';
    $('redeemer-root').hidden = name !== 'redeemer';
    $('hubBackBtn').hidden = name === 'hub';
  }

  async function apply() {
    $('previewRibbon').hidden = !Store.preview;
    if (route.name === 'hub') {
      unmountCurrent();
      showScreen('hub');
      renderHub();
      document.title = sessionTitle();
      root.scrollTo(0, 0);
      return;
    }
    const id = route.game;
    const g = Store.game(id);
    if (!g) return blocked('This game isn’t available right now. The facilitator may have hidden it, or it isn’t part of this session.');
    if (id === 'redeemers-challenge' && !g.playable) return blocked(REASONS[g.reason] ? REASONS[g.reason] + '. The Redeemer’s Challenge will open when the facilitator is ready.' : 'Not available right now.');
    if (mountedId === id) return;
    unmountCurrent();
    mountedId = id;
    document.title = g.title + ' · ' + sessionTitle();
    if (id === 'redeemers-challenge') {
      showScreen('redeemer');
      try {
        await Store.redeemerContent();
      } catch (e) {
        mountedId = null;
        return blocked('Couldn’t load the quiz: ' + e.message);
      }
      if (mountedId !== id) return;
      root.RedeemerGame.enter();
      return;
    }
    showScreen('play');
    const ctx = {
      store: Store,
      identity: {
        get: () => ({ nickname: Prefs.get().nickname, team: Prefs.get().team }),
        set: (patch) => Prefs.set(patch),
      },
      exit: () => navigate({ name: 'hub' }),
    };
    root.HubGames[id].mount($('gameRoot'), ctx);
    root.scrollTo(0, 0);
  }

  function blocked(message) {
    unmountCurrent();
    showScreen('blocked');
    $('blockedText').textContent = message;
    $('blockedTitle').focus({ preventScroll: true });
  }

  // ───────────── Menu ─────────────

  function sessionTitle() {
    const st = Store.state();
    return st ? st.session.title : 'Ruth 4 Game Night';
  }

  function renderHub() {
    const st = Store.state();
    if (!st) return;
    $('brandName').textContent = st.session.title;
    $('hubTitle').textContent = st.session.title;
    $('hubWelcome').textContent = st.session.welcome;
    $('previewRibbon').hidden = !Store.preview;
    const mode = $('hubMode');
    mode.textContent = '';
    const dot = U.el('span', 'dot' + (Store.mode === 'shared' ? ' ok' : ''));
    mode.append(dot, document.createTextNode(Store.mode === 'shared' ? 'Connected to the session' : 'Playing on this device'));
    renderNickname();

    const list = $('gameList');
    list.textContent = '';
    if (!st.games.length) {
      list.appendChild(U.el('p', 'empty-note', 'No games are open yet. Hang tight: the facilitator will open the first one soon.'));
    }
    st.games.forEach((g, i) => {
      const info = INFO[g.id];
      const card = U.el('article', 'game-card' + (g.live ? ' is-live' : '') + (g.playable ? '' : ' is-locked'));
      const icon = U.el('div', 'game-card-icon');
      icon.appendChild(U.svg(info.icon));
      const body = U.el('div', 'game-card-body');
      body.appendChild(U.el('p', 'eyebrow', 'Game ' + (i + 1) + ' · ' + info.kind));
      body.appendChild(U.el('h3', null, g.title));
      body.appendChild(U.el('p', 'game-card-desc', g.description));
      const chips = U.el('div', 'chips');
      if (g.live) chips.appendChild(U.el('span', 'chip chip-live', 'Live now'));
      chips.appendChild(U.el('span', 'chip chip-' + g.reason, REASONS[g.reason] || g.reason));
      if (info.meta) chips.appendChild(U.el('span', 'chip', info.meta(g.settings || {})));
      body.appendChild(chips);
      const btn = U.button(g.playable || g.id !== 'redeemers-challenge' ? info.action : 'Not open yet', 'btn ' + (g.live ? 'btn-primary' : 'btn-ghost'), () => navigate({ name: 'play', game: g.id }));
      if (!g.playable && g.id === 'redeemers-challenge') btn.disabled = true;
      btn.setAttribute('aria-label', info.action + ': ' + g.title);
      card.append(icon, body, btn);
      list.appendChild(card);
    });

    const banner = $('liveBanner');
    const liveGame = st.games.find((g) => g.live);
    banner.hidden = !liveGame;
    if (liveGame) {
      $('liveName').textContent = liveGame.title;
      $('liveJoin').onclick = () => navigate({ name: 'play', game: liveGame.id });
    }
  }

  function renderNickname() {
    const nick = Prefs.get().nickname;
    const box = $('hubNick');
    box.textContent = '';
    if (nick) {
      box.append(document.createTextNode('Playing as '), U.el('strong', null, nick), document.createTextNode(' · '));
      box.appendChild(U.button('change', 'btn btn-link btn-inline', editNickname));
    } else {
      box.appendChild(U.button('Choose a nickname', 'btn btn-link btn-inline', editNickname));
    }
  }

  function editNickname() {
    const box = $('hubNick');
    box.textContent = '';
    const form = U.el('form', 'inline-field');
    form.noValidate = true;
    const input = U.el('input', 'input');
    input.maxLength = 20;
    input.value = Prefs.get().nickname;
    input.setAttribute('aria-label', 'Your nickname');
    const save = U.el('button', 'btn btn-primary', 'Save');
    save.type = 'submit';
    form.append(input, save);
    box.appendChild(form);
    input.focus();
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const n = root.RedeemerEngine.validateNickname(input.value);
      if (!n.ok) {
        U.toast(n.error);
        return;
      }
      Prefs.set({ nickname: n.value });
      renderNickname();
    });
  }

  // ───────────── Live updates ─────────────

  function onStoreChange() {
    const st = Store.state();
    if (!st) return;
    $('brandName').textContent = st.session.title;
    if (st.liveGame && st.liveGame !== lastLive && lastLive !== undefined && route.game !== st.liveGame) {
      const g = st.games.find((x) => x.id === st.liveGame);
      if (g) U.toast('Now live: ' + g.title, 4000);
    }
    lastLive = st.liveGame;
    if (route.name === 'hub') {
      renderHub();
      return;
    }
    if (route.name !== 'play') return;
    const g = Store.game(route.game);
    if (!g) {
      // The facilitator hid this game. Running games finish their round first.
      if (mountedId && mountedId !== 'redeemers-challenge' && root.HubGames[mountedId]) root.HubGames[mountedId].update();
      if (!busy()) blocked('The facilitator has closed this game for now.');
      return;
    }
    if (mountedId && mountedId !== 'redeemers-challenge' && root.HubGames[mountedId]) root.HubGames[mountedId].update();
  }

  // ───────────── Start ─────────────

  renderSoundButton();
  Store.init({ role: 'participant', preview: wantsPreview })
    .then(() => {
      lastLive = Store.state() ? Store.state().liveGame : null;
      Store.subscribe(onStoreChange);
      $('hubLoading').hidden = true;
      route = initialRoute();
      apply();
    })
    .catch((e) => {
      console.error(e);
      $('hubLoading').textContent = 'Something went wrong while loading. Please refresh the page.';
    });
})(window);

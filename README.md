# Ruth 4 Game Night

Four games in one app for a Bible study on **Ruth 4**, built for a room of mostly twenty-somethings with phones and one projector. There's an admin dashboard to run the evening.

| # | Game | Kind | When | Bible knowledge? |
|---|---|---|---|---|
| 1 | **Gleaner’s Rush** | Canvas arcade game: catch barley, dodge hazards | Before the teaching (icebreaker) | None |
| 2 | **The Redeemer’s Challenge** | The original 8-question Ruth 4 quiz (unchanged) | After the teaching | Yes (Ruth 4) |
| 3 | **Road to Bethlehem** | Canvas puzzle: rotate tiles to connect a road, against the clock | After the quiz | None |
| 4 | **Team Showdown** | Team game show: buzzers, steals, streaks, final wager | Finale | None (optional Ruth bonus round) |

The admin can reorder the games, show or hide each one, configure every setting and question, and run the session (start, pause, reveal, next, scores, tie-breakers) without editing code.

> **Deployment status:** nothing has been deployed. Everything was built and tested locally. That includes running the real Apps Script server code in Node against stand-ins for Google’s services, plus browser checks at phone and desktop sizes. See [§11](#11-what-was-tested-and-what-wasnt) for what still needs checking on real Google infrastructure and real phones.

---

## Contents

1. [Three ways to host it](#1-three-ways-to-host-it)
2. [Try it now](#2-try-it-now)
3. [Running the evening](#3-running-the-evening)
4. [The games](#4-the-games)
5. [The admin dashboard](#5-the-admin-dashboard)
6. [Deploy to GitHub Pages](#6-deploy-to-github-pages)
7. [Deploy with Google Apps Script](#7-deploy-with-google-apps-script)
8. [Connect GitHub Pages to the Apps Script back end](#8-connect-github-pages-to-the-apps-script-back-end)
9. [Admin access and security](#9-admin-access-and-security)
10. [Customising and maintaining](#10-customising-and-maintaining)
11. [What was tested, and what wasn’t](#11-what-was-tested-and-what-wasnt)
12. [Known limitations](#12-known-limitations)
13. [Troubleshooting](#13-troubleshooting)
14. [Project files](#14-project-files)

Manual test checklist: **[TESTING.md](TESTING.md)**

---

## 1. Three ways to host it

| | **A. GitHub Pages only** (local mode) | **B. GitHub Pages + Apps Script back end** | **C. Apps Script web app** (recommended for a live session) |
|---|---|---|---|
| Setup | ~5 min | ~20 min | ~15 min |
| All four games playable | ✅ | ✅ | ✅ |
| Admin dashboard | Changes **this browser only** | ✅ shared, server-authorised (admin key) | ✅ shared, server-authorised (Google account or admin key) |
| Hide/show games for everyone | ❌ (this device only) | ✅ | ✅ |
| Shared leaderboards across phones | ❌ | ✅ | ✅ |
| Team Showdown phone buzzers | ❌ (teams shout, facilitator taps) | ✅ | ✅ |
| Facilitator start/pause/end reaching phones | ❌ | ✅ (within ~3–6 s) | ✅ (within ~3–6 s) |
| Synchronised “everyone starts now” rounds | ❌ | ✅ | ✅ |
| Hidden game content kept off phones | ❌ every file is public | ⚠️ menus, links and scores are blocked, but the static files are still public | ✅ quiz content is only sent while the quiz is visible; Team Showdown answers never reach phones |
| Paid services or API keys | None | None | None |

**Local mode** is still useful on its own. On one laptop, open the admin dashboard in one tab and the participant view (or Team Showdown host screen) in another, and they stay in sync instantly. Everyone else plays on their own phones with leaderboards kept on each phone.

Every game also works on its own if the back end can’t be reached: scores fall back to the device, and the player is told.

---

## 2. Try it now

**Local mode.** Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
```

Participants: <http://localhost:8000> · Admin: <http://localhost:8000/admin.html>

**Shared mode without a Google account.** This runs the real Apps Script code (`apps-script/*.gs`) in Node with simulated Google services and a simulated 250 ms network delay. Data is kept in memory.

```bash
npm run dev
```

The terminal prints the participant URL (including one for phones on the same Wi-Fi), the admin URL and an **admin key** to sign in with. This is the best way to rehearse buzzers and leaderboards with a few phones before the real night. It needs [Node.js](https://nodejs.org) 18+, with no packages to install.

---

## 3. Running the evening

Suggested running order (the defaults):

**Before the teaching: Gleaner’s Rush (5–10 min).**
- Show the **Welcome & join screen** (Admin → Present) so people can open the link on their phones.
- Say: “Catch the barley, dodge the stones and thorns, chain catches for a multiplier.”
- Everyone gets several attempts, and their best counts.
- For one big simultaneous round, turn on **Facilitator Showdown** in the game’s settings. Then Control → Start launches a round that begins on every phone 8 seconds later.
- Put the **live leaderboard** on the projector.

**The teaching.**

**After the teaching: The Redeemer’s Challenge (5–8 min).**
- Exactly as before: individual on phones, or Group mode on the projector with teams.
- It ends on the results and leaderboard screen.

**Road to Bethlehem (5 min).**
- Everyone races the same sequence of levels (same seed).
- In Team mode, scores add up per team.
- Put its live leaderboard on the projector.
- If two players tie for first, Admin → Scores → **Run a tie-breaker** gives them one sudden-death level, and the fastest solve wins.

**Finale: Team Showdown (10–15 min).**
1. Admin → Present → **Team Showdown host screen**.
2. With the back end, each team opens Team Showdown on one phone and enters the 4-digit code shown on the big screen. Without it, teams shout their name and you tap who was first.
3. The rules card explains everything in under a minute.

Keyboard shortcuts on the host screen:

| Key | Action |
|---|---|
| **N** | Next |
| **1–4** | The team that buzzed |
| **C** | Correct |
| **X** | Wrong |
| **R** | Reveal |
| **P** | Pause |
| **A** | Peek at the answer (it stays hidden from the projector otherwise) |

**Tip:** you can hide games you aren’t playing yet (Admin → Games), so the phone menu shows only what’s relevant. Mark the current one **Live** so it’s highlighted at the top of every phone.

---

## 4. The games

### Gleaner’s Rush (arcade)

- **Play:** catch sheaves (+10) and rare golden sheaves (+50, they fall faster). Avoid stones and thorns: each one caught costs a life.
- **Combo multiplier:** 5 catches in a row gives ×2, 10 gives ×3, and so on up to ×5. Missing a sheaf or hitting a hazard resets it.
- **Power-ups**, each switchable: *Wide Basket* (8 s), *Slow Wind* (everything falls at half speed for 5 s), *Shield* (absorbs one hazard).
- **Round:** 60 s or until lives run out (default 3 lives). Speed, spawn rate and the share of hazards rise continuously.
- **Controls:** drag on touch screens, move the mouse, or use ← → / A D. P or Esc pauses. Scrolling and pinch-zoom are blocked while playing, and the game pauses itself if the tab loses focus.
- **Fairness:** the playfield has the same shape on every device. What falls, when and where depends only on the session **seed**, so everyone faces the same pattern.
- **Visuals:** drawn entirely in code (canvas), with no image files and no engine.
- **Settings:** round length, lives, starting speed, difficulty ramp, items per second, hazard ratio, golden-sheaf frequency, each power-up on/off, attempts per player, Facilitator Showdown mode. The seed is set in the Control tab.

### The Redeemer’s Challenge (quiz)

The original game, with its questions, answers, references, explanations, timer and scoring untouched. The only changes were to fit it into the hub and to drop the closing reflection screen:

- it opens from the hub menu;
- theme and sound use the hub’s shared settings (sound is now off by default, as for every game);
- it pre-fills your hub nickname and the session code.

Its content stays in `questions.js`.

### Road to Bethlehem (puzzle)

- **Play:** tap a tile to turn it 90° and connect a road from **Moab** (top) to **Bethlehem** (bottom). The part of the road already connected to Moab glows gold. When it reaches Bethlehem, a traveller walks the route and the next level loads.
- **Difficulty:**

  | Levels | Grid | What’s added |
  |---|---|---|
  | 1–2 | 4×4 | – |
  | 3–5 | 5×5 | Decoy junctions on the route |
  | 4 onwards | – | Locked tiles (if enabled) |
  | 5 onwards | – | A well checkpoint the road must pass (if enabled) |
  | 6–8 | 6×6 | – |
  | 7 onwards | – | A field checkpoint too |
  | 9+ | up to the maximum size (default 7×7) | – |

- **Always solvable:** each level is built by first carving a random winding path from start to end, then giving each path cell a tile that fits it, then filling every other cell with decoys. Every unlocked tile is rotated randomly, and the level is re-scrambled if it happens to start solved. The tests generate 5,760 levels across settings and confirm every one is solvable and none starts solved.
- **Scoring** (explained on the start screen):

  | Part | Points |
  |---|---|
  | Base | points × size² ÷ 16 (100 for a 4×4) |
  | Time bonus | up to 50, if you beat size² × 1.5 s |
  | Efficiency bonus | up to 30, minus 3 per turn beyond the minimum |
  | Hint | −25 each |

  The leaderboard ranks by levels cleared, then score.
- **Clock:** 3 minutes for the whole round, or a clock per level. The last 10 seconds pulse red with a tick.
- **Controls:** tap or click; arrow keys move a cursor, Space/Enter turns, H uses a hint, P pauses. Pausing hides the board, so nobody plans while the clock is stopped.
- **Settings:** timer type, round or level time, start and maximum grid size, levels per round, decoy density, locked tiles, checkpoints, points per level, time bonus and its target, efficiency bonus, hints on/off and their cost, attempts, team mode, facilitator-started rounds. The seed is set in the Control tab.

### Team Showdown (game show)

- **2–4 teams** with editable names. A scoreboard with rank-change animations stays on screen.
- **Rounds** (all editable in Admin → Games → Team Showdown):

  | Round | Format |
  |---|---|
  | A · Cracked Word | Buzzer |
  | B · Scramble Sprint | Buzzer |
  | C · Brain Benders | Buzzer |
  | D · General Knowledge Lightning | Buzzer, double points by default |
  | E · Name Five | Facilitator-judged, 30 s per team, repeats don’t count |
  | F · Ruth Deep Cuts | Optional, off by default |

  Then the **Final Wager** and, if needed, a sudden-death **tie-breaker**.
- **Rules** (all configurable):
  - Correct answer: points. Wrong: −50, and the other teams may **steal** for 50%.
  - **Streak:** 3 correct in a row earns +50 on each further correct answer.
  - A wrong answer or an early buzz **locks** that team’s buzzer for 3 s.
  - **Final Wager:** each team secretly bets up to its score (max 500). Wagers are revealed together, then the answer.
- **Scoring:** the facilitator judges spoken answers, and the engine applies points, penalties, steals, streaks, doubles and wagers automatically. Typed Final Wager answers from phones are auto-checked against the answer and its accepted alternatives, and the facilitator can override.
- **Questions:** every default question has one defensible answer. Cracked words and scrambles are checked letter by letter in the tests. The bat-and-ball, sequence, clock-angle and percentage answers are checked arithmetically.

---

## 5. The admin dashboard

Open `admin.html` (GitHub Pages or local) or `…/exec?page=admin` (Apps Script). The dark header and the “Admin” badge make it clearly different from the participant pages.

| Tab | What you can do |
|---|---|
| **Session** | Title, welcome message, session code, how games start (*automatically when visible* or *only when I press Start*), game order (drag or arrows), preview the participant view with unsaved changes, restore defaults. |
| **Games** | For each game: status label, **Visible to participants** switch, **Part of this session** switch, **Preview** (works for hidden games), **Configure** (text, settings and, for Team Showdown, every round and question), **Reset data**. |
| **Control** | Start · Pause · Resume · End game · Next round · Generate or set seed · Mark as live · Show/Hide · Reset. Team Showdown also has Next question, Reveal answer and the host screen. |
| **Scores** | Best-per-player leaderboard, team totals, every entry with **Edit** (recorded as “adjusted”), **Export CSV**, **Reset leaderboard**, **Run a tie-breaker** when first place is shared, and **Reset entire session** (type RESET to confirm). |
| **Present** | Full-screen projector views: welcome and join screen, Team Showdown host, and live leaderboards for Gleaner’s Rush and Road to Bethlehem. |
| **Access** | Who you are signed in as, how admin access is checked, and how to add admins. |

How the controls behave:
- **Hiding is not deleting.** A hidden game keeps its settings, questions and results.
- **Hidden really means hidden.** A hidden or disabled game is removed from the data phones receive. A phone that has it open is told “The facilitator has closed this game.” A direct link shows “Not available”. The server refuses its scores and runs.
- **Visibility switches apply instantly.** Text, settings, order and questions apply when you press **Save**. Show/hide is never undone by saving an older draft.
- **Resets keep a record.** A reset starts a new “reset round”: earlier results stay in the Sheet and in CSV exports but stop counting.

---

## 6. Deploy to GitHub Pages

1. Create a public repository at <https://github.com/new> (for example `ruth4-game-night`).
2. Upload the project folder. In the browser: **uploading an existing file** → drag everything in → **Commit**. Or with Git:
   ```bash
   git init && git add . && git commit -m "Ruth 4 Game Night"
   ```
   ```bash
   git branch -M main && git remote add origin https://github.com/YOUR-NAME/ruth4-game-night.git && git push -u origin main
   ```
3. Go to **Settings → Pages → Build and deployment**, set **Source** to *Deploy from a branch*, choose branch `main` and folder `/ (root)`, then **Save**.
4. After a minute or two the site is at `https://YOUR-NAME.github.io/ruth4-game-night/`, with the admin dashboard at `…/admin.html`.

Without a back end this is **local mode** (§1, column A). For shared features, add §7 and §8.

**Updating:** upload or push the changed files. The site updates within a couple of minutes.

---

## 7. Deploy with Google Apps Script

### 7.1 Create the project inside a Google Sheet

1. Create a Sheet at <https://sheets.new> and name it, for example *Ruth 4 Game Night*. Scores are stored here.
2. Open **Extensions → Apps Script**. A script bound to the Sheet is what lets the server write to it.

### 7.2 Add the files

The `apps-script/` folder is ready to use. Most files are generated by `npm run build:gas`.

| In the editor | Type | Copy from |
|---|---|---|
| `Code` | Script | `apps-script/Code.gs` (replace the starter code) |
| `Hub` | Script | `apps-script/Hub.gs` |
| `Shared` | Script | `apps-script/Shared.gs` |
| `Content` | Script | `apps-script/Content.gs` |
| `Index` | HTML | `apps-script/Index.html` |
| `Admin` | HTML | `apps-script/Admin.html` |
| `Styles` | HTML | `apps-script/Styles.html` |
| `AdminStyles` | HTML | `apps-script/AdminStyles.html` |
| `Client` | HTML | `apps-script/Client.html` |
| `AdminClient` | HTML | `apps-script/AdminClient.html` |

Click **+** next to *Files*, choose Script or HTML, and type the name without the extension. Paste the contents and **Save**.

**Upgrading from the single-game version:** delete the old `AnswerKey`, `Config`, `Questions`, `Engine`, `Backend` and `Game` files.

**Faster alternative with [clasp](https://github.com/google/clasp):**
1. Turn on the Apps Script API at <https://script.google.com/home/usersettings>.
2. Copy the **Script ID** from Project Settings.
3. Create a file `.clasp.json` in the project folder:
   ```json
   {"scriptId": "PASTE-SCRIPT-ID", "rootDir": "apps-script"}
   ```
4. Push the files. This also uploads `appsscript.json` with the web-app settings:
   ```bash
   npx @google/clasp login
   ```
   ```bash
   npx @google/clasp push
   ```

### 7.3 Run `setup` once

In the editor, choose **setup** in the function menu and click **Run**, then allow the permissions.

- The `@OnlyCurrentDoc` line limits the script to **this one Sheet**.
- “Google hasn’t verified this app” is normal for your own scripts: choose **Advanced → Go to (project)**.

This creates the **Scores** and **Results** tabs and the default session.

### 7.4 Deploy as a web app

1. Go to **Deploy → New deployment**, click the gear, and choose **Web app**.
2. Set **Execute as: Me** and **Who has access: Anyone**. Then click **Deploy** and copy the URL that ends in `/exec`.
3. Use these addresses:

| Who | URL |
|---|---|
| Participants | `…/exec` |
| Admin | `…/exec?page=admin` |
| Straight to a game | `…/exec?game=road-to-bethlehem` |

**What “Anyone” means:**
- Anyone with the link can play and submit scores without signing in. They can’t see your Sheet, your Drive or anything else.
- They can only do what the server code allows: read the public game state, send runs and buzzes (each checked), and join a Team Showdown team with that team’s code.
- Every admin action is refused unless the server recognises an admin (§9).
- Google shows a small “created by a Google Apps Script user” banner.

**Updating after a change:** saving the code does **not** change the live app. Go to **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. The URL stays the same.

### 7.5 Set up admin access

The script owner is an admin automatically. Open `…/exec?page=admin` while signed in to that Google account. Use a browser profile or private window with only that account signed in, because Apps Script often fails when several Google accounts are signed in.

To add co-facilitators, or if Google doesn’t identify you, see §9.

---

## 8. Connect GitHub Pages to the Apps Script back end

1. Complete §7, using a deployment with **Anyone** access.
2. In `config.js`, set `apiUrl: 'https://script.google.com/macros/s/…/exec'` and upload the file.
3. Create an **admin key**: in the Apps Script editor run **createAdminKey** and copy the key from the execution log. Only its fingerprint is stored, so keep the key somewhere safe.
4. Open `…github.io/…/admin.html`, enter the key, and tick “Remember on this device” if it’s your own device.

**How cross-origin requests work:** GitHub Pages and Apps Script are different origins. Apps Script can’t answer a CORS preflight, so `backend.js` sends `POST` requests with a `text/plain` body. That counts as a *simple* request, so the browser sends no preflight. Apps Script replies through a redirect to `script.googleusercontent.com`, which allows any origin. The page sends no cookies or custom headers. The admin key travels inside the request body over HTTPS, and the server checks it on every admin request.

**Limitations of this path:**
- It only works with **Anyone** access. With sign-in required, the redirect goes to Google’s sign-in page and requests fail.
- The first request after a quiet period can take 1–3 s.
- Hiding a game blocks it from menus, links and the server, but its JavaScript files are still public on GitHub Pages (§12).

**Buzzer latency:** expect roughly **0.5–2 s** for a buzz to reach Apps Script and **1–1.5 s** for the host screen to show it (it polls every second). Buzzes are ordered by the time the server receives them. The host screen shows later buzzes with the gap (“Wheat +0.40s”), and **Give to …** lets the facilitator award a close call to another team. For very fast rooms, “shout your team name and the facilitator taps” is just as fair.

---

## 9. Admin access and security

**Two ways an admin is recognised, both checked on the server for every admin request:**

1. **Google account.** The server compares `Session.getActiveUser()` with the owner plus the `ADMIN_EMAILS` script property (Project Settings → Script properties → `ADMIN_EMAILS` = `you@x.com, helper@y.com`).
   - **Limitation:** with *Execute as: Me*, Google only tells the script who’s visiting when it’s the **owner** or someone in the **same Google Workspace domain**. Ordinary `@gmail.com` co-facilitators will appear anonymous.
   - For them, use the admin key. (A deployment set to *Execute as: user accessing* would identify everyone, but it would make every player sign in and need edit access to the Sheet, which is impractical for a room of phones.)
2. **Admin key.** Run `createAdminKey` in the editor. Only its SHA-256 fingerprint is stored in script properties, and the comparison takes the same time whatever the input.
   - After 20 wrong keys, key sign-in is locked for 10 minutes.
   - `removeAdminKey` turns the key off; `showAdminSetup` prints who has access.

**What’s never exposed to participants:**
- spreadsheet identifiers;
- device IDs of other players;
- the admin key;
- Team Showdown join codes (they’re only on the host screen);
- answers before they’re revealed, and wagers before the wager reveal;
- hidden games.

The admin page itself can be opened by anyone, but it contains no secrets and shows nothing until the server confirms the visitor.

**GitHub Pages only (local mode):** the admin dashboard is **not access-controlled**, because it only changes that browser’s own storage and affects no one else. A password check in static JavaScript would protect nothing, so none was added. For real control over a shared session, use the Apps Script back end.

**Score plausibility (arcade and puzzle):**
- **Registered runs:** a run must be registered with the server before it starts (`startRun`, which also checks the seed, round and attempt limits).
- **Real elapsed time:** when the result arrives, the server time since registration must cover the play time the result claims.
- **Gleaner’s Rush:** the server regenerates the falling pattern from the seed and rejects any score above the best score that pattern allows, or with more catches than items, more hazards than lives, and so on.
- **Road to Bethlehem:** the server regenerates every level from the seed and **recomputes the score itself**. It rejects levels out of order, solves faster than humanly possible, runs longer than the clock, and hints when hints are off.
- **Limits:** attempts per player, one submission per device every 4 s, and a cap on entries.

**Honest limits:** client-side games can’t be made fully cheat-proof. A determined person could script a near-perfect game within these bounds, or clear their browser data to get fresh attempts. The checks stop casual tampering and impossible scores. Admins can correct or remove anything (Scores → Edit; or edit the Sheet).

---

## 10. Customising and maintaining

| To change… | Where |
|---|---|
| Titles, messages, order, start mode, game settings, Team Showdown questions | Admin dashboard. No code needed. |
| The Redeemer’s Challenge content | `questions.js` (kept as written; see the original README notes in the file) |
| Default settings and Team Showdown defaults | `shared/defaults.js`, `games/showdown-questions.js` |
| Colours and fonts | `styles.css` (`:root` variables); admin look in `admin.css` |
| Rush and Road rules | `games/rush-core.js`, `games/road-core.js` (shared with the server, so scores stay consistent) |

**After editing code:**
1. Run `npm run build:gas`, which regenerates the Apps Script files.
2. Run `npm test`.
3. Upload or push. On Apps Script, deploy a **New version**.

**Clearing data:** use Admin → Scores → **Reset leaderboard** or **Reset entire session**, which keeps a record. To delete permanently, remove rows from the *Results* and *Scores* tabs of the Sheet.

---

## 11. What was tested, and what wasn’t

**Automated (`npm test`, 67 tests, Node 18+, no installs):**

| File | Covers |
|---|---|
| `tests/engine.test.js` | The original quiz rules (unchanged). |
| `tests/backend.test.js` | The quiz’s server leaderboard, plus the hub’s effect on it (hidden quiz refuses scores; reset clears it). |
| `tests/hub-core.test.js` | Seeds and configuration validation; hidden games absent from the public state; start, pause, end and grace period; rounds; tie-breakers; ranking and teams. Rush: pattern determinism, difficulty ramp, bot play never exceeding the server maximum, tampered results rejected. Road: **5,760 generated levels all solvable and none pre-solved**, minimum rotations exact, hints, scoring, server re-scoring. Team Showdown: buzz, wrong answer, steal, streak, lockout, false start, timeout, double points, Name Five, secret wagers, auto-checked answers, tie-breaker, pause. |
| `tests/server-hub.test.js` | The real `Hub.gs` and `Code.gs`: admin by Google account, by `ADMIN_EMAILS` and by key (fingerprint only, lockout); hidden games refusing state, runs, boards and content; settings validation and chunked storage; run registration, real-time checks, maximum-score checks, attempt and rate limits, resets voiding runs; Road re-scoring and team totals; facilitator start mode and synchronised rounds; tie-breakers; score corrections; team join codes, server buzzes, buzz order with gaps, answers and wagers kept secret, join-code throttling; full session reset. |

**In a browser (Chrome, desktop and a 375 px phone viewport):**
- Hub menu.
- Gleaner’s Rush: play, pause during the countdown, resume, game over, results.
- Road to Bethlehem: solving levels with real taps, keyboard, hint, pause veil, results.
- Hiding a game in admin closes it in another tab and blocks its direct link; admin preview still opens it.
- Team Showdown host flow, locally and in shared mode with a phone tab buzzing through the server.
- Shared leaderboards and The Redeemer’s Challenge inside the hub.
- The generated Apps Script pages, rendered as HtmlService would with a `google.script.run` stand-in.
- No horizontal scrolling at phone width.

**Not yet tested (please use [TESTING.md](TESTING.md) before the night):**
- A real Apps Script deployment: `google.script.run`, `Session.getActiveUser()` identification of the owner, CacheService and LockService under load.
- The GitHub Pages ↔ Apps Script connection.
- Physical phones, especially a **mid-range Android** for frame rate (the games use a fixed-timestep loop, pre-drawn sprites, at most 140 particles and a pixel-density cap of 2 to stay light).
- A real projector.

---

## 12. Known limitations

- **Content on GitHub Pages is public.** Hiding a game removes it from menus and links and the server refuses its scores, but anyone can read the static JavaScript, including the quiz content and the default Team Showdown questions. Host on Apps Script if that matters.
- **Phones follow the facilitator by polling**, every 6 s on the menu and every 1.5–3 s inside a game. Pauses and starts reach phones within a few seconds, not instantly.
- **Apps Script limits:** roughly 30 requests can run at once per script. A room of 60 phones is fine at these polling rates. Very large groups may see an occasional “server is busy”; the games retry or fall back to the device.
- **Synchronised rounds** start on each phone using the server’s clock, adjusted for network delay. Expect phones to start within about half a second of each other.
- **The Redeemer’s Challenge Group mode** controls (reveal, next) are on the device running it, as before. Its shared leaderboard uses the session code.
- **Tie-breakers** for Rush and Road are played by the tied players on their own phones. Team Showdown’s tie-breaker runs on the host screen.
- **Name Five** is judged by the facilitator. Spoken answers in buzzer rounds are judged by the facilitator, with the answer available via “Peek”.

---

## 13. Troubleshooting

| Symptom | Fix |
|---|---|
| Admin page asks for a key even though you own the script | Use a private window or profile signed in only to the owner account. If it still asks, use `createAdminKey` (§9). |
| “Not available” on a phone | The game is hidden, disabled, or not part of the session. Check Admin → Games. |
| Phones still show an old setting | They refresh every few seconds. On Apps Script, make sure you deployed a **New version** after code changes (settings changes made in the dashboard don’t need a redeploy). |
| GitHub Pages says “Playing on this device” although `apiUrl` is set | Check that the URL ends in `/exec` and the deployment allows **Anyone**. Open the URL plus `?action=ping` in a browser: it should show `"hub":true`. |
| “Score not accepted: …” | The server judged the run impossible (for example, the facilitator changed settings or reset mid-run). The score is kept on the device; play again. |
| “You’ve used all N attempts” | Raise the limit in the game’s settings, or reset the leaderboard. |
| A team phone says “Please join your team again” | Team Showdown was reset or the device was replaced. Enter the code from the lobby screen again. |
| No sound | Sound is off by default. Use the speaker icon (top right) on each device. |
| The CSV download doesn’t start in Apps Script | Apps Script pages run in a sandbox. Copy the CSV text shown under the table, or use the Sheet directly. |

---

## 14. Project files

```
index.html               Participant hub (menu, game screens, the quiz's original screens)
admin.html, admin.js     Admin dashboard and projector views
admin.css                Admin and projector styles
styles.css               Shared styles (palette, hub, games)
game.js                  Hub navigation, header, blocked routes
config.js                GitHub Pages settings (apiUrl, quiz timer)
backend.js               Talks to Apps Script (google.script.run or text/plain POST)
questions.js, engine.js  The Redeemer's Challenge content and rules (unchanged)

shared/
  rng.js                 Seeded random numbers
  defaults.js            Configuration model, settings schema, validation
  session-core.js        Live state, facilitator controls, visibility, leaderboards
  store.js               Local vs shared state, scores, admin actions
  util.js, prefs.js, sfx.js, loop.js, confetti.js, leaderboard.js

games/
  gleaners-rush.js       + rush-core.js       Game 1
  redeemers-challenge.js                      Game 2 (the original UI)
  road-to-bethlehem.js   + road-core.js       Game 3
  team-showdown.js       (team phones), showdown-host.js (projector),
  showdown-core.js       (rules), showdown-questions.js (default questions)   Game 4

apps-script/             Ready for Apps Script: Code.gs and Hub.gs (hand-written), the rest generated
scripts/build-gas.js     Builds apps-script/ from the files above
dev/server.js, dev/fake-gas.js   Local shared-mode server and test stand-ins for Google services
tests/                   Automated tests
TESTING.md               Manual checklist
```

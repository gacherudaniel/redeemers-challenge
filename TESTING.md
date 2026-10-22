# Testing checklist

Run `npm test` first. All tests should pass, including 5,760 generated Road to Bethlehem levels being solvable. Then work through this list on the real devices and the real deployment. Allow 30–40 minutes, ideally with two or three helpers holding phones.

To rehearse shared mode without Google, run `npm run dev` and use the admin key it prints.

## 1. Hidden games can't be launched by participants
- [ ] Admin → Games: switch **Road to Bethlehem** off under “Visible to participants”.
- [ ] On a phone, within ~6 s it disappears from the menu.
- [ ] A phone that had it open shows “The facilitator has closed this game for now” (a run in progress finishes first).
- [ ] Typing the direct link (`#/play/road-to-bethlehem`, or `?game=road-to-bethlehem` on Apps Script) shows “Not available” and the game does not load.
- [ ] Admin → Games → **Preview** still opens it, with the blue preview banner, and no score is saved.
- [ ] Switch it back on: it reappears with its settings unchanged.
- [ ] Repeat for The Redeemer’s Challenge. On Apps Script, the quiz must not open while hidden.

## 2. Admin settings persist as designed
- [ ] Change the session title, the game order and a Gleaner’s Rush setting (for example 45 s rounds), then **Save**.
- [ ] Phones show the new title, order and “45 s” chip within a few seconds.
- [ ] Reload the admin page: the changes are still there. On Apps Script, they survive a new deployment version too.
- [ ] Edit a Team Showdown question, save, and check it appears on the host screen.
- [ ] **Restore defaults** brings back the originals without changing which games are visible.
- [ ] Local mode only: the changes apply to this browser. Another device is unaffected, as documented.

## 3. Admin security (Apps Script)
- [ ] In a private window with no Google account: `…/exec?page=admin` shows the sign-in screen and nothing else.
- [ ] Signed in as the script owner: the dashboard opens and Access says “Signed in as …”. If it doesn’t, use the admin key and note it.
- [ ] A wrong admin key is refused. The correct key from `createAdminKey` works.
- [ ] A participant phone cannot reach any admin action. Every admin action returns “Administrator access is required” without credentials (covered by the automated tests; spot-check one).

## 4. Scores behave correctly
- [ ] Gleaner’s Rush: catching gives +10 (+50 golden); the multiplier reaches ×2 after 5 catches in a row; a hazard costs a life and resets the multiplier; Shield blocks one hazard.
- [ ] The round ends at the time limit or at zero lives, and the summary shows score, best combo and accuracy.
- [ ] Shared mode: “Saved! You’re #N”. The leaderboard keeps each player’s best attempt, and the attempt limit is enforced.
- [ ] Road to Bethlehem: the points per level match the breakdown banner, and a hint costs the hint price. The leaderboard sorts by levels, then score. With team mode on, team totals add up.
- [ ] Admin → Scores → **Edit** a score: it updates on the leaderboard and is marked “adjusted”. **Export CSV** downloads (or shows the text on Apps Script).
- [ ] **Reset leaderboard** empties the board, and earlier entries show as “before reset”.
- [ ] Tie-breaker: create a tie for first. **Run a tie-breaker** shows a tie-breaker button only to those players, and their results appear in the tie-breaker table.
- [ ] Team Showdown:
  - [ ] right +points; wrong −50, then the steal gives 50%;
  - [ ] the third correct answer in a row adds the streak bonus;
  - [ ] Lightning round answers are doubled;
  - [ ] Name Five awards per item plus the bonus for five;
  - [ ] wagers stay hidden until revealed, then add or subtract;
  - [ ] a tie offers a sudden-death tie-breaker.

## 5. Every generated Road to Bethlehem level is solvable
- [ ] `npm test` passes the “every generated level is solvable and never starts solved” test (5,760 levels across settings).
- [ ] Play at least 8 levels by hand: each one connects, none starts solved, and grids grow from 4×4 to 5×5 to 6×6.
- [ ] Locked tiles (from level 4) don’t turn, and checkpoints (from level 5) must be on the connected road.

## 6. Graphical games run smoothly on mobile
- [ ] On a **mid-range Android phone** (Chrome) and an **iPhone** (Safari), play a full 60 s Gleaner’s Rush. It stays smooth, dragging tracks your finger, and the page doesn’t scroll or zoom.
- [ ] Rotate the phone mid-game: the field resizes without breaking.
- [ ] Switch apps mid-game: it pauses itself; Resume continues.
- [ ] Road to Bethlehem: tiles are easy to tap and turn exactly once per tap. On a 7×7 grid tiles are still at least ~44 px.
- [ ] With “Reduce motion” turned on in the phone’s settings: no screen shake, no confetti, and no traveller walk.
- [ ] Sound is off by default, the speaker icon turns it on, and nothing plays until it’s on.

## 7. All four games on phones, laptops and a projector
- [ ] Phone (portrait): menu, all four games, the results screens, and the Team Showdown buzzer screen fit without sideways scrolling.
- [ ] Laptop: mouse and keyboard controls work (Rush ← →; Road arrows + Space; quiz 1–4; host N/1–4/C/X/R/P/A).
- [ ] Projector: Present → Welcome screen, the live leaderboards and the Team Showdown host are readable from the back. The answer stays hidden until **Peek** (A).
- [ ] The Redeemer’s Challenge plays exactly as before (questions, timer, scoring, reflection, Ruth 4:14–17, transition).

## 8. Facilitator controls
- [ ] Session → “Only when I press Start”: phones show “Waiting for the facilitator”.
- [ ] Control → **Start**: the game opens and becomes **Live now** at the top of every phone.
- [ ] **Pause**: a run in progress shows “Paused by the facilitator” within a few seconds. **Resume** continues it.
- [ ] **End game**: runs in progress stop and submit, and new runs can’t start.
- [ ] Gleaner’s Rush with **Facilitator Showdown** on: **Start** or **Next round** makes every phone on the game screen count down and start together.
- [ ] **Generate new seed**: new runs get a different pattern.

## 9. Deployment
- [ ] GitHub Pages: `https://…github.io/…/` and `/admin.html` load over mobile data (not only Wi-Fi), with no console errors.
- [ ] Apps Script: `…/exec` loads in a private window without signing in; `…/exec?page=admin` loads for the owner.
- [ ] After a code change, **Manage deployments → New version** was done and the change is visible at the same URL.
- [ ] GitHub Pages + back end: `…/exec?action=ping` shows `"hub":true`, and the GitHub Pages menu says “Connected to the session”.
- [ ] Before the real session: Admin → Scores → **Reset entire session** to clear rehearsal data.

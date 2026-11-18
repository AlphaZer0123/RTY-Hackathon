# 🚀 Buildathon: Make Wednesdays Great Again

**Masters' Union · For AI Developers · Winner gets Rs. 25,000**

> **Every team must build in a fork of this repository.** Projects not built in a fork of this repo won't be judged.

| | |
|---|---|
| **Date** | Wednesday, 18 November 2026 |
| **Hacking** | **3:00 PM – 7:00 PM IST** (code freeze at 7:00 PM sharp) |
| **Venue** | CDS Audi, 8th floor |
| **Prize** | Rs. 25,000 to the winning team |
| **Register your fork** | 👉 **[https://forms.gle/ZJUYKwTYjsMsVB2b9](https://forms.gle/ZJUYKwTYjsMsVB2b9)** (**deadline 3:30 PM IST**) |
| **Final submission** | Your fork as it stands at **7:00 PM IST**. There's nothing else to submit. |

> 🤖 **Using an AI coding agent?** Point it at [`AGENTS.md`](AGENTS.md). It has the full event brief, tracks, judging and rules in a form agents can read directly. Claude Code loads it automatically through `CLAUDE.md`, and Codex reads `AGENTS.md` natively.

---

## 🎯 Pick one build track

| # | Track | Brief |
|---|---|---|
| **01** | **Build for the Physical World** | Make a real-world task easier, faster or more reliable. Show it in a realistic scenario. |
| **02** | **Build for AI Agents** | Find something an agent struggles with. Build the tool that fixes it, then demo the agent using it. |
| **03** | **Build in Your Area of Expertise** | Pick a field you know firsthand. Ship a working product that improves how people handle it today. |

## ⚖️ How you'll be judged (each criterion is ⅓ of your score)

| Criterion | The question judges ask |
|---|---|
| **Working product** | Does it do what you say it does? Show the core workflow in your demo. |
| **Problem insight** | Who faces this problem, and why does it happen? |
| **Depth of execution** | How well did you solve the hardest part of the build? |

---

## Why fork this repo?

Everyone starts from the same commit (the **genesis commit**) at the same time. Organizers can then check that:
- all code was written **during** the Buildathon and not brought in from an earlier project,
- teams commit steadily instead of pasting in one huge AI-generated dump at the end,
- every repo stays public and visible while you build.

The organizers track every fork automatically: commits, timing and activity. Read [RULES.md](RULES.md) before you write any code.

---

## ✅ Setup (about 5 minutes, do it at 3:00 PM)

**In short:** fork → register your fork in the form **by 3:30 PM** → build → push before 7:00 PM.

### 1. Fork this repo
Click **Fork** (top right). On the fork screen:
- **Owner:** one team member's personal account. Only **one fork per team**.
- **Repository name:** `buildathon-<team-name>`, for example `buildathon-byte-bandits`
- Click **Create fork**.

> ⚠️ Don't download a ZIP or copy the files into a new repo. **It has to be a real GitHub fork**, or the tracker can't see you.

### 2. Keep it public
Forks of a public repo are public. **Don't make it private, archive it, or delete it** until judging is over.

### 3. Add your teammates
In your fork: **Settings → Collaborators → Add people**. Add each teammate's GitHub account so their commits count toward the team.

### 4. Enable Actions
Open the **Actions** tab of your fork and click **"I understand my workflows, go ahead and enable them"**. This runs the automatic check on every push.

### 5. Make your registration commit (your first commit)
Fill in [`team.json`](team.json). `track` must be one of `physical-world`, `ai-agents` or `area-of-expertise`. Then:

```bash
git clone https://github.com/<your-username>/buildathon-<team-name>.git
cd buildathon-<team-name>
# edit team.json
git add team.json
git commit -m "register: <team name>"
git push
```

The **Hackathon check** in the Actions tab should go green ✅. If it's red, open the run to see what's wrong in `team.json`.

### 6. Register your fork (deadline: 3:30 PM IST)
👉 **[https://forms.gle/ZJUYKwTYjsMsVB2b9](https://forms.gle/ZJUYKwTYjsMsVB2b9)**

It's a 4-question Google Form: team name, fork link, track, team members. It connects your repo to the organizers' live tracker.

- Fill it in **once per team**, right after forking, and **no later than 3:30 PM IST**. **Teams that don't register can't be tracked.**
- Paste your **fork's** URL (`https://github.com/<you>/buildathon-<team-name>`), not this starter repo's.
- Need to change something? Use the **"Edit your response"** link on the confirmation page. Don't fill it in twice.
- **Final submission is automatic.** Whatever is pushed to your fork at 7:00 PM IST is what gets judged.

---

## 🛠 While you build (3:00 – 7:00 PM)

- Put your code anywhere in the repo (`app/`, `src/`, `frontend/`, `backend/`…). There's no required layout.
- **Commit early, commit often**, at least every 30 minutes of real work, with messages that say what changed.
- **Push regularly.** Commits you never push don't exist to the tracker.
- AI coding tools (Claude Code, Codex, Cursor, Copilot…) are **allowed and encouraged**. Keep `AGENTS.md` and `CLAUDE.md` in the repo; they keep your agent within the rules.
- Before 7:00 PM, replace the "Your project" section below with your project's README.

## 🧊 Code freeze: 7:00 PM IST

At 7:00 PM the tracker takes a snapshot of every fork. **Commits pushed after code freeze are ignored.** Judges look at your last commit before 7:00 PM.

## ❌ Things that get you flagged

- Rewriting history (`git push --force`, rebasing away the genesis commit, squashing everything into one commit)
- Commits dated before 3:00 PM
- One or two giant commits containing most of the project
- A repo that isn't a fork of this one, or that's private or deleted

See [RULES.md](RULES.md) for the full list.

---

## Your project

**Roomline** · banana boyzz · Physical World

A student who needs a campus room for a group meeting has to open each room to check their exact start time. CoWork’s daily availability count does not show whether that time, or the full meeting window, is free. Roomline checks the loaded rooms and puts verified options first.

Roomline is a local Chrome extension. It uses the signed-in CoWork interface to search and book, and the signed-in Masters’ Union Gmail interface to verify each reservation. A 60-minute meeting uses two consecutive 30-minute requests. The second is sent only after the first is confirmed by email. The hard part is preventing a repeated or wrong request when a slot, browser tab, or email result changes.

### Install and use

1. In desktop Chrome, open `chrome://extensions` and turn on **Developer mode**.
2. Select **Load unpacked** and choose this repository’s `app` folder.
3. Open CoWork and Masters’ Union Gmail in the same Chrome profile. Reload both tabs if they were already open. Keep both tabs open when booking.
4. Open **Roomline** on the CoWork dashboard. Enter the meeting details in IST and choose **Search rooms**.
5. Choose a room from **Available**. Review the room, date, title, and each interval. Choose **Book this room** only when ready to send.
6. If the receipt says **Pending confirmation**, open the candidate booking email in Gmail if needed, then choose **Check email again**. This check only reads email evidence.

Roomline checks the room cards loaded in the current CoWork view and shows the active filters. Change the filters in CoWork for a different view. The extension supports one date and either a 30- or 60-minute meeting. Use **My Bookings** in CoWork for cancellation. A reload keeps pending and confirmed intervals in local extension storage.

### Test

Requires Node.js 22 and Playwright’s bundled Chromium.

```sh
npm install --package-lock=false
npx playwright-core install chromium
npm test
npm run test:browser
```

The browser suite loads the actual extension in an isolated profile and supplies synthetic CoWork and Gmail pages. It checks the interface and every portal submit click. Live CoWork and Gmail network requests are blocked in that profile. For a visible run on macOS, use `ROOMLINE_HEADED=1 npm run test:browser`.

### Judge walkthrough

1. Start with an exact meeting window and explain that the portal’s daily count does not say whether that window is free.
2. Search for 60 minutes. Show why a room with only the first interval free is unavailable, then choose a room with both intervals free.
3. Review the room and both intervals. Show the first confirmed by Gmail before Roomline sends the second.
4. Show the partial-result test as the fallback example. The first interval remains confirmed when the second becomes unavailable. Refreshing or checking email again sends nothing.

### Verification status

The release check passed 8 rule tests and 16 browser tests, including two end-to-end rehearsals. These checks exercise 30- and 60-minute bookings, exact room selection, date changes, competing tabs, reload recovery, storage failure, and partial results. In live Chrome, the CoWork dashboard date was changed and two room forms were checked manually. The work profile’s Gmail showed the observed booking sender and stable message metadata. The Roomline scan and live booking still require verification in the installed work profile. No real booking was submitted by Roomline. The extension uses standard desktop Chrome APIs. The Windows browser path has not been smoke-tested.

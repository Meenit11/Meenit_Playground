# 🎮 Meenit's Playground

**Mobile-first party games for unforgettable game nights!**

Play three exciting party games with your friends: **Odd One In**, **Undercover**, and **Mafia**. Built with pure HTML, CSS, and vanilla JavaScript - no frameworks, no dependencies, just pure fun!

---

## 🎯 Games

### 🎲 Odd One In
**Players:** 3-20  
**Duration:** Quick rounds (10 seconds each)  
**Description:** Answer questions in 10 seconds! The Game Master eliminates players withthe oddest answers. Last one standing wins!

**How to Play:**
1. GM creates a room and shares the code
2. Players join and enter their names
3. Each round, everyone answers a question in 10 seconds
4. GM sees all answers sorted alphabetically (blanks first)
5. GM eliminates the odd ones out
6. Last player remaining wins!

---

### 🕵️ Undercover
**Players:** 4-12  
**Duration:** 15-30 minutes  
**Description:** Agents vs Spies! Everyone gets a word - except Mr. White. Find the imposters before they find you!

**How to Play:**
1. GM sets player count and role distribution
2. Players view their roles and words secretly (pass-phone)
3. Each round, players speak in random order describing their word
4. Vote to eliminate suspicious players
5. **Win Conditions:**
   - **Agents win:** All Spies + Mr. Whites eliminated
   - **Spies/Mr. White win:** Outnumber Agents
   - **Mr. White solo win:** Correctly guesses both words

---

### 🔫 Mafia
**Players:** 5-15  
**Duration:** 20-45 minutes  
**Description:** The classic social deduction game! Civilians hunt the Mafia during the day, while Mafia strikes at night.

**Roles:**
- **God:** Game Master who sees everything
- **Mafia:** Eliminate civilians at night
- **Civilian:** Find and vote out the Mafia
- **Detective:** Investigate one player each night
- **Jester:** Win by getting voted out!
- **Suicide Bomber:** Take someone with you when eliminated
- **Lovers:** If one dies, both die

**How to Play:**
1. GM assigns roles (randomized pass-phone viewing)
2. **Night Phase:** GM reads instructions aloud (Mafia chooses target, Detective investigates)
3. **Day Phase:** Players discuss and vote to eliminate someone
4. Repeat until win condition is met

**Win Conditions:**
- **Civilians win:** All Mafia eliminated
- **Mafia wins:** Mafia count ≥ remaining civilians
- **Jester wins:** Voted out during day phase

---

## 🚀 Quick Start

### Local Play
1. Download or clone this repository
2. **Run a local server** (so CSS and assets load correctly):
   ```bash
   cd Playground
   python3 -m http.server 8000
   ```
   Then open **http://localhost:8000** in your browser.
3. Or open `index.html` directly (some browsers may block CSS when using `file://`).

**No build step, no npm required!**

---

## 🌐 Deploy to Render.com

1. Push this repository to GitHub
2. Go to [Render.com](https://render.com) and create a new **Static Site**
3. Connect your GitHub repository
4. Set the following:
   - **Build Command:** (leave empty)
   - **Publish Directory:** `.` (root directory)
5. Click "Create Static Site"
6. Share the generated URL with your friends!

---

## 📂 Project Structure

```
Playground/
├── index.html                 # Landing page
├── css/
│   ├── global.css            # Shared styles & animations
│   ├── home.css              # Landing page styles
│   ├── odd-one-in.css        # Odd One In styles
│   ├── undercover.css        # Undercover styles
│   └── mafia.css             # Mafia styles
├── js/
│   ├── utils.js              # Shared utilities
│   ├── odd-one-in.js         # Odd One In logic
│   ├── undercover.js         # Undercover logic
│   └── mafia.js              # Mafia logic
├── games/
│   ├── odd-one-in.html
│   ├── undercover.html
│   └── mafia.html
├── images/
│   └── [game logos and role images]
├── data/
│   ├── questions.json        # Questions for Odd One In
│   └── words.json            # Word pairs for Undercover
└── README.md
```

---

## 💻 Tech Stack

- **HTML5** - Structure
- **CSS3** - Styling with custom properties & animations
- **Vanilla JavaScript (ES6+)** - Game logic
- **LocalStorage** - Game state persistence
- **Google Fonts** - Poppins font family

**Zero external dependencies!**

---

## 📱 Mobile-First Design

- Optimized for **375px - 428px** (mobile screens)
- Touch-friendly buttons (minimum 44px height)
- Smooth animations using `transform` and `opacity`
- Works offline after first load
- Responsive up to desktop sizes

---

## ✨ Features

- 🎨 **Rich Animations:** Confetti, card flips, shake effects, pulse animations
- 📲 **Pass-and-Play:** Single device, pass between players
- 💾 **Auto-Save:** Games save to LocalStorage (resume anytime)
- 🎭 **Role Reveals:** Animated card flips with randomized viewing order
- ⏱️ **Timer System:** Pause/resume/reset functionality (Odd One In)
- 🔀 **Drag-to-Reorder:** Touch-friendly player reordering (Undercover)
- 🎯 **Smart Question Selection:** Tiered questions based on player count

---

## 🎨 Design Philosophy

- **Vibrant Colors:** Purple, pink, orange gradients
- **Glassmorphism:** Frosted glass effects for modern look
- **Floating Shapes:** Animated background elements
- **Instant Feedback:** Every tap has visual response
- **Smooth Transitions:** 60fps animations

---

## 🧠 Game Data

### Odd One In Questions
- **Tier 1 (10+ players):** Broad questions (250+ options)
- **Tier 2 (5-9 players):** Medium difficulty (60+ options)
- **Tier 3 (2-4 players):** Trivia-style questions

### Undercover Words
- 100+ Indian-themed word pairs
- Bollywood, food, culture, tech references
- Easily customizable or use manual input

---

## 🤝 Contributing

This is a personal project, but feel free to:
- Fork and customize for your group
- Add new questions to `questions.json`
- Add new word pairs to `words.json`
- Translate to other languages

---

## 📄 License

Free to use for personal and educational purposes.

---

## 🎉 Credits

**Created with 💜 for game nights**

- Design & Development: AI-assisted creation
- Inspiration: Classic party games
- Special thanks to all playtester friends!

---

## 🐛 Known Limitations

- **Single Device:** Designed for pass-and-play (not networked multiplayer)
- **Browser Only:** Requires modern browser (Chrome, Safari, Firefox)
- **LocalStorage:** Limited to ~5MB (sufficient for normal gameplay)

---

## 📞 Support

Having issues?
1. Check browser console for errors
2. Clear LocalStorage and refresh (`localStorage.clear()` in console)
3. Ensure you're using a modern browser
4. Try incognito/private mode

---

**Ready to play? Open `index.html` and let the games begin! 🎮**

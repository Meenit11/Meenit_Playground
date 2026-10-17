# Putting the game online (simple version)

You do this once. After that, every change is one command.

## Part 1: save the code on GitHub (once)

1. Make a free account at github.com and sign in.
2. Click the green "New" button, name the repository `playground`, leave everything else, click "Create repository".
3. On your computer open a terminal inside the `Meenit_Playground-main` folder and run these lines one by one
   (replace YOUR-NAME with your GitHub username):

```
git init
git add .
git commit -m "first version"
git branch -M main
git remote add origin https://github.com/YOUR-NAME/playground.git
git push -u origin main
```

GitHub may ask you to sign in in the browser the first time. When it finishes, refresh the GitHub page and you will see your files.

## Part 2: put it online with Render (once)

1. Make a free account at render.com. Sign in with your GitHub account, that is the easiest.
2. Click "New" at the top, then "Blueprint".
3. Pick your `playground` repository and click "Connect". Render reads the `render.yaml` file
   in the project and shows one service called `meenits-playground`. Click "Apply".
4. Wait two or three minutes. When it says "Live", click the link at the top. It looks like
   `https://meenits-playground.onrender.com`. That link is your game.

That link works on any phone anywhere. Share it in WhatsApp. Nobody has to change any settings.

## Part 3: keep it from falling asleep (once, optional but recommended)

A free Render service goes to sleep after 15 minutes without visitors and takes up to a minute to wake.

1. Make a free account at cron-job.org.
2. Create a job with the address `https://meenits-playground.onrender.com/api/health` and set it to run every 10 minutes.

Now the game is always ready.

## Every time you change something

In the terminal, inside the project folder:

```
git add .
git commit -m "what you changed"
git push
```

Render notices the push and updates the game by itself in about two minutes. Nothing else to do.

## Start, stop, check

- **Is it running?** Open the game link, or open `https://meenits-playground.onrender.com/api/health`.
  If you see `"ok": true` it is running.
- **Stop it:** in Render open the service, click "Settings", scroll down, click "Suspend". The link stops working.
- **Start it again:** same page, click "Resume".
- **Something broke after a change:** in Render open the service and click "Logs" to see the error,
  or click "Manual Deploy" then "Deploy latest commit" to try again.
- **Delete everything:** Render service, "Settings", "Delete Web Service". The GitHub code stays.

## Testing on your own computer (optional)

```
cd server
npm install
PORT=8080 PG_STATIC_DIR=.. node server.js
```

Then open `localhost:8080` in a browser. Press Ctrl+C in the terminal to stop it.

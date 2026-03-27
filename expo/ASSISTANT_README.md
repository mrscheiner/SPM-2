This repo includes a few helper shortcuts to reach the assistant quickly.

1) Open ChatGPT in your browser (one-key from VS Code)
   - Press Cmd+Shift+I in VS Code (runs the "Open ChatGPT" task).
   - The task runs `npm run assistant:open`, which opens https://chat.openai.com in your default browser.

2) CLI assistant (terminal)
   - Usage: set your OpenAI API key and run a prompt from the terminal:
     ```bash
     export OPENAI_API_KEY=sk-...
     npm run assistant:cli -- "Explain how to add a new screen"
     ```
   - The CLI (`scripts/assistant-cli.js`) sends the prompt to the OpenAI Chat API (gpt-3.5-turbo) and prints the response.

3) Recommended VS Code extensions
   - The workspace recommends installing GitHub Copilot and a ChatGPT extension. Open the Extensions view and accept the recommendations.

Security notes
- Do not commit your `OPENAI_API_KEY`. Store it in your environment or a local-only `.env` file (and add `.env` to .gitignore if you create one).

Customizing
- Change the keybinding in `.vscode/keybindings.json` if Cmd+Shift+I conflicts with your setup.
- Change the CLI model in `scripts/assistant-cli.js` if you prefer a different OpenAI model.

4) Open a saved Chrome bookmark by name
   - If you have ChatGPT saved as a bookmark in Google Chrome, you can open it by name:
      ```bash
      npm run assistant:open-bookmark -- "ChatGPT"
      # or whatever the bookmark title is in Chrome
      ```
   - The helper reads your Chrome Bookmarks JSON for the Default profile and opens the first matching bookmark name in Chrome.
   - Note: this works on macOS and assumes Chrome stores bookmarks at ~/Library/Application Support/Google/Chrome/Default/Bookmarks

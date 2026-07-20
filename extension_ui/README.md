# Browser-Use Chrome Extension UI

This project provides a Chrome Extension sidebar interface (left/right side panel) that connects to a local Python backend. You can enter natural language prompts in the chat box, and the AI agent will control your browser in real-time while streaming its step-by-step logs/decisions directly to the sidebar.

---

## Setup Instructions

### 1. Launch Chrome with Remote Debugging Enabled

The agent needs to connect to your active Chrome browser. To allow this, Chrome must be launched with remote debugging open on port `9222`.

1. **Close all open Chrome windows first.**
2. Open PowerShell or Command Prompt.
3. Run the following command (adjust the path if Chrome is installed elsewhere):

**Windows (PowerShell):**
```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
```
**Windows (CMD):**
```cmd
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
```
**macOS:**
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

---

### 2. Load the Extension in Chrome

1. In your remote-debugged Chrome window, go to **`chrome://extensions/`**.
2. Enable **Developer mode** by toggling the switch in the top-right corner.
3. Click **Load unpacked** in the top-left corner.
4. Select the folder: `d:\project files\browser-use\extension_ui\extension`

---

### 3. Run the Backend Server

Open your terminal in `d:\project files\browser-use` and start the FastAPI backend:

```powershell
& .venv\Scripts\python extension_ui/backend.py
```

You should see the FastAPI server start on `http://127.0.0.1:8000`.

---

## How to Use It

1. Click the **Browser-Use Sidebar Assistant** icon in your Chrome toolbar.
2. The side panel chat box will slide open.
3. Verify the status at the top says **Connected** (meaning both the backend and Chrome CDP are active).
4. Enter any prompt (e.g. *"Go to wikipedia.org and search for SpaceX"*).
5. Watch the agent control your browser tabs live, while showing its step-by-step thinking, evaluations, and actions directly in the sidebar chat list!

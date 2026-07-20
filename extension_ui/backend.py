import asyncio
import logging
import os
import re

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

# Load browser-use modules
from browser_use import Agent, Browser, ChatOpenAI

load_dotenv()

import socket

import httpx


def autodetect_antigravity_credentials() -> tuple[str, str] | tuple[None, None]:
    """Inspect running processes to find active Antigravity language server address & CSRF token."""
    import re
    import subprocess
    import sys
    
    cmd_lines = []
    if sys.platform == "win32":
        try:
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            out = subprocess.check_output(
                ['wmic', 'process', 'where', 'name like \'%language_server%\'', 'get', 'CommandLine'],
                text=True,
                startupinfo=startupinfo
            )
            cmd_lines = out.splitlines()
        except Exception:
            pass
    else:
        for cmd in [['ps', 'aux'], ['ps', '-ef']]:
            try:
                out = subprocess.check_output(cmd, text=True)
                cmd_lines = out.splitlines()
                break
            except Exception:
                continue

    candidates = []
    csrf_pattern = re.compile(r'--csrf_token\s+([^\s]+)')
    port_pattern = re.compile(r'--extension_server_port\s+(\d+)')
    
    for line in cmd_lines:
        if not line.strip() or 'language_server' not in line.lower():
            continue
        csrf_match = csrf_pattern.search(line)
        port_match = port_pattern.search(line)
        if csrf_match and port_match:
            try:
                csrf_token = csrf_match.group(1).strip()
                ext_port = int(port_match.group(1).strip())
                ls_port = ext_port + 3
                candidates.append((f"localhost:{ls_port}", csrf_token))
            except Exception:
                pass
                
    # Verify each candidate
    for addr, token in candidates:
        try:
            headers = {
                "x-codeium-csrf-token": token,
                "Connect-Protocol-Version": "1",
                "Content-Type": "application/json",
            }
            r = httpx.post(
                f"http://{addr}/exa.language_server_pb.LanguageServerService/GetAvailableModels",
                headers=headers, json={}, timeout=1.0
            )
            if r.status_code == 200:
                return addr, token
        except Exception:
            pass
            
    return None, None


def save_antigravity_credentials(addr: str, token: str):
    """Save active credentials to .env file and environment."""
    os.environ["ANTIGRAVITY_LS_ADDRESS"] = addr
    os.environ["ANTIGRAVITY_CSRF_TOKEN"] = token
    
    try:
        from pathlib import Path
        project_root = Path(__file__).resolve().parent.parent
        env_path = project_root / ".env"
        existing = {
            "ANTIGRAVITY_LS_ADDRESS": addr,
            "ANTIGRAVITY_CSRF_TOKEN": token
        }
        
        env_content = []
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                if line.startswith("#") or not line.strip() or "=" not in line:
                    env_content.append(line)
                else:
                    k, _ = line.split("=", 1)
                    k = k.strip()
                    if k in existing:
                        env_content.append(f"{k}={existing[k]}")
                        del existing[k]
                    else:
                        env_content.append(line)
                        
        for k, v in existing.items():
            env_content.append(f"{k}={v}")
            
        env_path.write_text("\n".join(env_content) + "\n")
    except Exception:
        pass


# 18:
def scan_local_models():
    scanned_models = []
    
    # 1. Scan Ollama
    ollama_host = os.getenv("OLLAMA_HOST", "http://localhost:11434")
    try:
        from urllib.parse import urlparse
        parsed_url = urlparse(ollama_host)
        hostname = parsed_url.hostname or "127.0.0.1"
        port = parsed_url.port or 11434
        
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.2)
        if s.connect_ex((hostname, port)) == 0:
            r = httpx.get(f"{ollama_host}/api/tags", timeout=1.0)
            if r.status_code == 200:
                data = r.json()
                for m in data.get("models", []):
                    name = m.get("name")
                    scanned_models.append({
                        "provider": "ollama",
                        "name": name,
                        "model_id": name,
                        "label": f"Ollama - {name}"
                    })
        s.close()
    except Exception:
        pass

    # 2. Scan Antigravity IDE models
    ls_address = os.getenv("ANTIGRAVITY_LS_ADDRESS")
    csrf_token = os.getenv("ANTIGRAVITY_CSRF_TOKEN")
    
    success = False
    if ls_address and csrf_token:
        try:
            if ":" in ls_address:
                host, port_str = ls_address.split(":")
                port = int(port_str)
            else:
                host = ls_address
                port = 22004
            
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(0.2)
            if s.connect_ex((host, port)) == 0:
                headers = {
                    "x-codeium-csrf-token": csrf_token,
                    "Connect-Protocol-Version": "1",
                    "Content-Type": "application/json"
                }
                r = httpx.post(f"http://{ls_address}/exa.language_server_pb.LanguageServerService/GetAvailableModels", headers=headers, json={}, timeout=1.0)
                if r.status_code == 200:
                    data = r.json()
                    models = data.get("response", {}).get("models", {})
                    for key, val in models.items():
                        model_enum = val.get("model")
                        if model_enum:
                            label = key
                            if "gemini" in key.lower():
                                label = f"Gemini - {key}"
                            elif "claude" in key.lower():
                                label = f"Claude - {key}"
                            elif "gpt" in key.lower():
                                label = f"GPT - {key}"
                            scanned_models.append({
                                "provider": "antigravity",
                                "name": key,
                                "model_id": model_enum,
                                "label": f"Antigravity - {label}"
                            })
                    success = True
            s.close()
        except Exception:
            pass
            
    if not success:
        addr, token = autodetect_antigravity_credentials()
        if addr and token:
            save_antigravity_credentials(addr, token)
            try:
                if ":" in addr:
                    host, port_str = addr.split(":")
                    port = int(port_str)
                else:
                    host = addr
                    port = 22004
                
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.settimeout(0.2)
                if s.connect_ex((host, port)) == 0:
                    headers = {
                        "x-codeium-csrf-token": token,
                        "Connect-Protocol-Version": "1",
                        "Content-Type": "application/json"
                    }
                    r = httpx.post(f"http://{addr}/exa.language_server_pb.LanguageServerService/GetAvailableModels", headers=headers, json={}, timeout=1.0)
                    if r.status_code == 200:
                        data = r.json()
                        models = data.get("response", {}).get("models", {})
                        for key, val in models.items():
                            model_enum = val.get("model")
                            if model_enum:
                                label = key
                                if "gemini" in key.lower():
                                    label = f"Gemini - {key}"
                                elif "claude" in key.lower():
                                    label = f"Claude - {key}"
                                elif "gpt" in key.lower():
                                    label = f"GPT - {key}"
                                scanned_models.append({
                                    "provider": "antigravity",
                                    "name": key,
                                    "model_id": model_enum,
                                    "label": f"Antigravity - {label}"
                                })
                s.close()
            except Exception:
                pass

            
    # 3. Add API models if configured
    bu_key = os.getenv("BROWSER_USE_API_KEY")
    or_key = os.getenv("OPENROUTER_API_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")
    google_key = os.getenv("GOOGLE_API_KEY")
    
    if bu_key and bu_key != "your_bu_api_key_here":
        scanned_models.append({"provider": "browser_use", "name": "ChatBrowserUse", "model_id": "ChatBrowserUse", "label": "Browser-Use Cloud (Recommended)"})
    if or_key and or_key != "your_openrouter_key_here":
        scanned_models.append({"provider": "openrouter", "name": "google/gemini-2.5-flash", "model_id": "google/gemini-2.5-flash", "label": "OpenRouter - Gemini 2.5 Flash"})
    if openai_key and openai_key != "your_openai_api_key_here":
        scanned_models.append({"provider": "openai", "name": "gpt-4o-mini", "model_id": "gpt-4o-mini", "label": "OpenAI - GPT-4o Mini"})
    if google_key and google_key != "your_google_api_key_here":
        scanned_models.append({"provider": "google", "name": "gemini-2.5-flash", "model_id": "gemini-2.5-flash", "label": "Google - Gemini 2.5 Flash"})
        
    return scanned_models

app = FastAPI(title="Browser-Use Extension Backend")

# Enable CORS for the Chrome Extension
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
async def health():
    """Check if the backend is running and can connect to Chrome on port 9222"""
    import socket
    chrome_running = False
    try:
        # Quick TCP connection check to see if remote debugging port is open
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(1.0)
        s.connect(("127.0.0.1", 9222))
        s.close()
        chrome_running = True
    except Exception:
        pass
    
    bu_key = os.getenv("BROWSER_USE_API_KEY")
    or_key = os.getenv("OPENROUTER_API_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")
    google_key = os.getenv("GOOGLE_API_KEY")
    ollama_model = os.getenv("OLLAMA_MODEL")
    local_api_base = os.getenv("LOCAL_API_BASE_URL")
    
    models_list = scan_local_models()
    
    llm_configured = (
        (bu_key and bu_key != "your_bu_api_key_here") or
        (or_key and or_key != "your_openrouter_key_here") or
        (openai_key and openai_key != "your_openai_api_key_here") or
        (google_key and google_key != "your_google_api_key_here") or
        bool(ollama_model) or
        bool(local_api_base) or
        len(models_list) > 0
    )
    
    return {
        "status": "healthy",
        "chrome_cdp_connected": chrome_running,
        "llm_key_configured": bool(llm_configured),
        "openrouter_api_key_configured": bool(or_key and or_key != "your_openrouter_key_here"),
        "local_ai_configured": bool(ollama_model or local_api_base or any(m['provider'] in ('ollama', 'antigravity') for m in models_list)),
        "models": models_list
    }

@app.get("/api/run")
async def run_task(task: str, model: str = None):
    """Run the browser-use agent and stream the progress logs back to the extension"""
    
    async def event_generator():
        queue = asyncio.Queue()
        
        # Define a custom logging handler to capture agent progress
        class AgentLogHandler(logging.Handler):
            def emit(self, record):
                msg = self.format(record)
                # Clean up ANSI color codes from terminal logs
                msg_clean = re.sub(r'\x1b\[[0-9;]*m', '', msg)
                queue.put_nowait(msg_clean)
        
        handler = AgentLogHandler()
        handler.setFormatter(logging.Formatter('%(message)s'))
        
        # Attach the handler to the browser_use logger
        bu_logger = logging.getLogger('browser_use')
        bu_logger.addHandler(handler)
        # Set level to INFO to get all main events
        bu_logger.setLevel(logging.INFO)
        
        async def run_agent():
            try:
                # Connect to the user's running Chrome instance
                browser = Browser(
                    cdp_url="http://localhost:9222"
                )
                
                # Configure the LLM dynamically based on user selection or environment variables
                llm = None
                
                if model and model != "auto":
                    if ":" in model:
                        provider, model_id = model.split(":", 1)
                    else:
                        provider = "antigravity" if model.startswith("MODEL_") else "ollama"
                        model_id = model
                    
                    if provider == "antigravity":
                        from browser_use.llm.antigravity.chat import ChatAntigravity
                        ls_address = os.getenv("ANTIGRAVITY_LS_ADDRESS", "localhost:22004")
                        csrf_token = os.getenv("ANTIGRAVITY_CSRF_TOKEN")
                        llm = ChatAntigravity(model=model_id, ls_address=ls_address, csrf_token=csrf_token)
                    elif provider == "ollama":
                        from browser_use import ChatOllama
                        ollama_host = os.getenv('OLLAMA_HOST')
                        ollama_num_ctx = int(os.getenv('OLLAMA_NUM_CTX', '32000'))
                        llm = ChatOllama(
                            model=model_id,
                            host=ollama_host,
                            ollama_options={'num_ctx': ollama_num_ctx}
                        )
                    elif provider == "openrouter":
                        openrouter_key = os.getenv('OPENROUTER_API_KEY')
                        llm = ChatOpenAI(
                            model=model_id,
                            base_url='https://openrouter.ai/api/v1',
                            api_key=openrouter_key,
                        )
                    elif provider == "openai":
                        openai_key = os.getenv('OPENAI_API_KEY')
                        llm = ChatOpenAI(model=model_id, api_key=openai_key)
                    elif provider == "google":
                        from browser_use import ChatGoogle
                        google_key = os.getenv('GOOGLE_API_KEY')
                        llm = ChatGoogle(model=model_id, api_key=google_key)
                    elif provider == "browser_use":
                        from browser_use import ChatBrowserUse
                        bu_api_key = os.getenv('BROWSER_USE_API_KEY')
                        llm = ChatBrowserUse(api_key=bu_api_key)
                
                # Fallback to standard environment variable config
                if llm is None:
                    bu_api_key = os.getenv('BROWSER_USE_API_KEY')
                    openrouter_key = os.getenv('OPENROUTER_API_KEY')
                    openai_key = os.getenv('OPENAI_API_KEY')
                    google_key = os.getenv('GOOGLE_API_KEY')
                    ollama_model = os.getenv('OLLAMA_MODEL')
                    local_api_base = os.getenv('LOCAL_API_BASE_URL')
                    
                    if bu_api_key and bu_api_key != 'your_bu_api_key_here':
                        from browser_use import ChatBrowserUse
                        llm = ChatBrowserUse(api_key=bu_api_key)
                    elif openrouter_key and openrouter_key != 'your_openrouter_key_here':
                        llm = ChatOpenAI(
                            model='google/gemini-2.5-flash',
                            base_url='https://openrouter.ai/api/v1',
                            api_key=openrouter_key,
                        )
                    elif openai_key and openai_key != 'your_openai_api_key_here':
                        llm = ChatOpenAI(model='gpt-4o-mini', api_key=openai_key)
                    elif google_key and google_key != 'your_google_api_key_here':
                        from browser_use import ChatGoogle
                        llm = ChatGoogle(model='gemini-2.5-flash', api_key=google_key)
                    elif ollama_model:
                        from browser_use import ChatOllama
                        ollama_host = os.getenv('OLLAMA_HOST')
                        ollama_num_ctx = int(os.getenv('OLLAMA_NUM_CTX', '32000'))
                        llm = ChatOllama(
                            model=ollama_model,
                            host=ollama_host,
                            ollama_options={'num_ctx': ollama_num_ctx}
                        )
                    elif local_api_base:
                        local_model = os.getenv('LOCAL_MODEL_NAME', 'local-model')
                        local_api_key = os.getenv('LOCAL_API_KEY', 'local-key')
                        llm = ChatOpenAI(
                            model=local_model,
                            base_url=local_api_base,
                            api_key=local_api_key
                        )
                    else:
                        raise ValueError(
                            "No valid LLM API key or Local LLM configured in .env! "
                            "Please configure BROWSER_USE_API_KEY, OPENROUTER_API_KEY, "
                            "OPENAI_API_KEY, GOOGLE_API_KEY, OLLAMA_MODEL, or LOCAL_API_BASE_URL."
                        )
                
                # Create and run the agent
                agent = Agent(
                    task=task,
                    browser=browser,
                    llm=llm,
                    use_vision=True,
                    extend_system_message=(
                        "You must follow these strict rules to ensure robust browser automation:\n"
                        "1. DO NOT PANIC IF A PAGE IS TEMPORARILY BLANK, DARK, OR LOADING:\n"
                        "   - When clicking links or submitting forms, the browser page might temporarily appear blank or loading during transition.\n"
                        "   - Do NOT immediately declare failure or assume the page is broken.\n"
                        "   - Instead, wait a moment, use a scroll action, refresh the page, or go back to the previous page using the browser back button.\n"
                        "2. ADHERE STRICTLY TO THE USER'S PAGE BOUNDARIES:\n"
                        "   - If the task asks you to play, click, extract, or interact with a song, video, link, or item 'on the present page', 'on the current page', or 'this page', you must NEVER navigate away to search engines or other websites (such as navigating to google.com or a fresh youtube.com search) to find it.\n"
                        "   - You must search and interact only within the current viewport and page content. If you cannot find it, scroll up/down, or check the DOM carefully.\n"
                        "3. PREFER ROBUST INTERACTION METHODS:\n"
                        "   - If a normal click on an element does not work, try clicking a parent/child container of that element.\n"
                        "   - If clicking via coordinates/indices still fails or element geometry is missing, you can use keyboard navigation (e.g. using send_keys action with 'Tab', 'ArrowDown', 'Enter') to select and activate the element."
                    )
                )
                
                history = await agent.run()
                
                if history.is_successful():
                    await queue.put("SYSTEM: [SUCCESS] Task completed successfully!")
                else:
                    # Find the last error to print in the log
                    errors = history.errors()
                    last_error = next((err for err in reversed(errors) if err is not None), "Task stopped due to agent execution errors or limits")
                    await queue.put(f"SYSTEM: [ERROR] Task stopped. Reason: {last_error}")
            except Exception as e:
                await queue.put(f"SYSTEM: [ERROR] {str(e)}")
            finally:
                # Remove handler to avoid leaks
                bu_logger.removeHandler(handler)
                await queue.put("SYSTEM: [DONE]")
        
        # Start running agent in background
        agent_task = asyncio.create_task(run_agent())
        
        # Yield logs to client as Server-Sent Events
        while True:
            try:
                item = await asyncio.wait_for(queue.get(), timeout=1.0)
                yield f"data: {item}\n\n"
                if "SYSTEM: [DONE]" in item:
                    break
            except asyncio.TimeoutError:
                if agent_task.done():
                    break
                # Keep-alive ping
                yield "data: [PING]\n\n"


    return StreamingResponse(event_generator(), media_type="text/event-stream")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend:app", host="127.0.0.1", port=8000, reload=True)

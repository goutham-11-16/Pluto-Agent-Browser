"""
Pluto Agent Browser — Backend Server
FastAPI backend with model scanning, agent execution, direct chat, and settings.
Evolved from extension_ui/backend.py.
"""

import asyncio
import json
import logging
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

# ── Add parent directory to sys.path for browser-use imports ──
project_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(project_root))

load_dotenv(dotenv_path=project_root / '.env')

import httpx
from pydantic import BaseModel, Field

from browser_use import Agent, Browser, ChatOpenAI, Controller
from browser_use.agent.views import ActionResult

# ── Dynamic CDP Port (passed from Electron via environment) ──
CDP_PORT = int(os.environ.get('PLUTO_CDP_PORT', '9222'))
CDP_BASE = f'http://127.0.0.1:{CDP_PORT}'
print(f'[backend] Using CDP port: {CDP_PORT} (base: {CDP_BASE})')

# Monkeypatch BrowserSession.on_NavigateToUrlEvent to route navigation through Electron IPC.
# This prevents Chromium-only background navigation and ensures pages render in the BrowserView.
from browser_use.browser.session import BrowserSession

_original_on_navigate = BrowserSession.on_NavigateToUrlEvent


async def on_NavigateToUrlEvent(self, event):
	self.logger.info(f'[patched_navigate] Intercepting navigation to: {event.url} (new_tab={event.new_tab})')
	try:
		# 1. Query devtools target list to find the shell window (renderer/index.html)
		import httpx as _httpx

		resp = _httpx.get(f'{CDP_BASE}/json/list', timeout=3.0)  # noqa: ASYNC210
		targets = resp.json()

		shell_target = None
		for t in targets:
			if t.get('type') == 'page' and 'renderer/index.html' in t.get('url', ''):
				shell_target = t
				break

		if shell_target:
			shell_target_id = shell_target['id']
			# Connect to shell window session (focus=False so we don't switch the agent's focus away)
			session = await self.get_or_create_cdp_session(shell_target_id, focus=False)

			if event.new_tab:
				self.logger.info('[patched_navigate] Creating new tab in Electron via IPC')
				expr = f"(async () => {{ await window.plutoAPI.createTab({json.dumps(event.url)}); return 'ok'; }})()"
			else:
				self.logger.info('[patched_navigate] Navigating active tab in Electron via IPC')
				expr = f"(async () => {{ await window.plutoAPI.navigateTo({json.dumps(event.url)}); return 'ok'; }})()"

			# Await the IPC evaluate to complete
			try:
				await session.cdp_client.send.Runtime.evaluate(
					params={
						'expression': expr,
						'returnByValue': True,
						'awaitPromise': True,
					},
					session_id=session.session_id,
				)
			except Exception as eval_err:
				self.logger.warning(f'[patched_navigate] Runtime.evaluate failed: {eval_err}. Falling back.')
				await _original_on_navigate(self, event)
				return

			if not event.new_tab:
				# OPTIMIZATION: For same-tab navigation, the target ID does not change.
				# Just sleep a tiny bit for the navigation load to initiate, then let agent's
				# watchdog handle waiting.
				await asyncio.sleep(0.8)
				self.logger.info(f'[patched_navigate] Same-tab navigation initiated for: {event.url}')
				return

			# For new tab, wait 1.5s for the new target to be created and register in CDP
			await asyncio.sleep(1.5)

			# Find the new target ID
			try:
				resp2 = _httpx.get(f'{CDP_BASE}/json/list', timeout=3.0)  # noqa: ASYNC210
				targets2 = resp2.json()
				page_targets = [t for t in targets2 if t.get('type') == 'page']

				new_best_id = None
				for t in page_targets:
					t_url = t.get('url', '')
					if 'renderer/index.html' in t_url:
						continue
					if t_url.startswith('devtools://') or t_url.startswith('chrome-extension://'):
						continue
					if event.url in t_url or t_url in event.url or 'newtab' in t_url:
						new_best_id = t.get('id')
						break

				if not new_best_id and page_targets:
					# Fallback to the latest non-shell page target
					for t in reversed(page_targets):
						t_url = t.get('url', '')
						if 'renderer/index.html' not in t_url and not t_url.startswith('devtools://'):
							new_best_id = t.get('id')
							break

				if new_best_id:
					self.agent_focus_target_id = new_best_id
					await self.get_or_create_cdp_session(new_best_id, focus=True)
					self.logger.info(f'[patched_navigate] Focus switched to new tab target: {new_best_id[:8]}...')
			except Exception as target_err:
				self.logger.warning(f'[patched_navigate] Focus update failed: {target_err}')
			return
	except Exception as e:
		self.logger.warning(f'[patched_navigate] Electron IPC navigation failed: {e}. Falling back to standard CDP navigation.')

	await _original_on_navigate(self, event)


BrowserSession.on_NavigateToUrlEvent = on_NavigateToUrlEvent

controller = Controller()


class WriteCodeToEditorParams(BaseModel):
	code: str = Field(
		...,
		description='The complete, fully completed code program (including all variables, print statements, and correct indentation) to write inside the Monaco web IDE editor.',
	)


@controller.action(
	'Write the complete completed code block into the Monaco web IDE editor, replacing all its contents. Use this action whenever you need to fill in blanks or write/update code in the web IDE.',
	param_model=WriteCodeToEditorParams,
)
async def write_code_to_editor(params: WriteCodeToEditorParams, browser_session: Browser) -> ActionResult:
	try:
		code = params.code
		page = await browser_session.get_current_page()
		# Try setting it via Monaco or Ace API injection with recursive frame traversal
		js_code = f"""
        () => {{
            function findAndSetMonaco(win, codeVal) {{
                try {{
                    if (win.monaco && win.monaco.editor) {{
                        const models = win.monaco.editor.getModels();
                        if (models && models.length > 0) {{
                            models.forEach(m => m.setValue(codeVal));
                            return true;
                        }}
                    }}
                }} catch (e) {{}}
                try {{
                    for (let i = 0; i < win.frames.length; i++) {{
                        if (findAndSetMonaco(win.frames[i], codeVal)) {{
                            return true;
                        }}
                    }}
                }} catch (e) {{}}
                return false;
            }}
            function findAndSetAce(win, codeVal) {{
                try {{
                    const el = win.document.querySelector('.ace_editor');
                    if (el && el.env && el.env.editor) {{
                        el.env.editor.setValue(codeVal, -1);
                        el.env.editor.focus();
                        return true;
                    }}
                }} catch (e) {{}}
                try {{
                    for (let i = 0; i < win.frames.length; i++) {{
                        if (findAndSetAce(win.frames[i], codeVal)) {{
                            return true;
                        }}
                    }}
                }} catch (e) {{}}
                return false;
            }}
            const val = {json.dumps(code)};
            if (findAndSetMonaco(window, val)) return "monaco_success";
            if (findAndSetAce(window, val)) return "ace_success";
            return "not_found";
        }}
        """
		res = await page.evaluate(js_code)
		if res in ['monaco_success', 'ace_success']:
			# Trigger React state updates by typing a space and backspace on page.keyboard
			await asyncio.sleep(0.3)
			await page.keyboard.press('Space')
			await asyncio.sleep(0.1)
			await page.keyboard.press('Backspace')
			await asyncio.sleep(0.2)
			return ActionResult(
				is_done=False,
				extracted_content=f'Successfully injected code into {res} editor and triggered state synchronization.',
			)

		# Fallback: focus editor and type via page.press/JS
		focused = await page.evaluate("""
        () => {
            const el = document.querySelector('.ace_text-input, .ace_editor, .monaco-editor, textarea');
            if (el) {
                el.focus();
                return true;
            }
            return false;
        }
        """)
		if focused:
			# Clear editor using Ctrl+A and Backspace
			await asyncio.sleep(0.2)
			await page.keyboard.press('Control+A')
			await asyncio.sleep(0.1)
			await page.keyboard.press('Backspace')
			await asyncio.sleep(0.1)

			# Since we can't type a long string key-by-key easily, we inject it via document.activeElement
			await page.evaluate(f"""
            () => {{
                const el = document.activeElement;
                if (el) {{
                    el.value = {json.dumps(code)};
                    el.dispatchEvent(new Event('input', {{ bubbles: true }}));
                    el.dispatchEvent(new Event('change', {{ bubbles: true }}));
                }}
            }}
            """)
			return ActionResult(is_done=False, extracted_content='Wrote code using DOM activeElement fallback.')

		raise Exception(
			'Could not find any editor element to focus (tried .ace_text-input, .ace_editor, .monaco-editor, textarea).'
		)
	except Exception as e:
		return ActionResult(is_done=False, error=str(e))


class LoginParams(BaseModel):
	username: str = Field(..., description='The username/email to log in with.')
	password: str = Field(..., description='The password to log in with.')


@controller.action(
	'Log in to CodeChef using credentials. This action navigates to the login page, enters credentials, submits, and waits for the session to stabilize.',
	param_model=LoginParams,
)
async def login_to_codechef(params: LoginParams, browser_session: Browser) -> ActionResult:
	try:
		page = await browser_session.get_current_page()
		# Navigate to login page
		await page.goto('https://www.codechef.com/login')
		await asyncio.sleep(4)

		# Inject credentials and click submit
		js_login = f"""
        () => {{
            const userField = document.querySelector("#edit-name, input[name='name']");
            const passField = document.querySelector("#edit-pass, input[name='pass']");
            const submitBtn = document.querySelector("#edit-submit-button[value='Log in'], #edit-submit-button[value='Login'], input[type='submit'][value='Log in'], input[type='submit'][value='Login']");
            
            if (!userField || !passField || !submitBtn) {{
                return "elements_not_found";
            }}
            
            userField.value = {json.dumps(params.username)};
            passField.value = {json.dumps(params.password)};
            
            // Dispatch input and change events so React/Vue registers the values
            userField.dispatchEvent(new Event('input', {{ bubbles: true }}));
            userField.dispatchEvent(new Event('change', {{ bubbles: true }}));
            passField.dispatchEvent(new Event('input', {{ bubbles: true }}));
            passField.dispatchEvent(new Event('change', {{ bubbles: true }}));
            
            submitBtn.click();
            return "success";
        }}
        """
		res = await page.evaluate(js_login)
		if res == 'elements_not_found':
			return ActionResult(is_done=False, error='Login elements not found on the page.')

		# Wait 8 seconds for cookies and session to stabilize
		await asyncio.sleep(8)

		# Navigate back to course page to prepare resume
		await page.goto('https://www.codechef.com/learn/course/kare-cse3301-daa-2026')
		await asyncio.sleep(6)

		return ActionResult(
			is_done=False, extracted_content='Logged in to CodeChef successfully and navigated back to the DAA course page.'
		)
	except Exception as e:
		return ActionResult(is_done=False, error=f'Login failed: {str(e)}')


# ── App State ──────────────────────────────────────────────────
PLUTO_PORT = int(os.getenv('PLUTO_PORT', '18420'))
SETTINGS_FILE = Path(__file__).parent / 'pluto_settings.json'
active_agent_tasks = {}

# ── Model Cache (prevents event-loop blocking on every /api/health poll) ──
import time as _time

_model_cache: list[dict] = []
_model_cache_ts: float = 0.0
_MODEL_CACHE_TTL = 30.0  # seconds

# ── Persistent Browser Session Pool ──────────────────────────────────────
# Eliminates the ~10s browser.start() overhead on every task by reusing
# a pre-connected Browser instance across runs.
_browser_pool: dict = {'browser': None, 'fast_mode': None}


def autodetect_antigravity_credentials() -> tuple[str, str] | tuple[None, None]:
	"""Inspect running processes to find active Antigravity language server address & CSRF token."""
	import re
	import subprocess
	import sys

	import httpx

	if sys.platform == 'win32':
		try:
			startupinfo = subprocess.STARTUPINFO()
			startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
			out = subprocess.check_output(
				['wmic', 'process', 'where', "name like '%language_server%'", 'get', 'ProcessId,CommandLine'],
				text=True,
				startupinfo=startupinfo,
			)
			cmd_lines = out.splitlines()
		except Exception:
			return None, None

		csrf_pattern = re.compile(r'--csrf_token\s+([^\s]+)')
		pid_pattern = re.compile(r'\s+(\d+)\s*$')
		proc_info = []
		for line in cmd_lines:
			if not line.strip() or 'processid' in line.lower() or 'commandline' in line.lower():
				continue
			csrf_match = csrf_pattern.search(line)
			pid_match = pid_pattern.search(line)
			if csrf_match and pid_match:
				try:
					token = csrf_match.group(1).strip()
					pid = int(pid_match.group(1).strip())
					proc_info.append((pid, token))
				except Exception:
					pass

		if not proc_info:
			return None, None

		try:
			startupinfo = subprocess.STARTUPINFO()
			startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
			netstat_out = subprocess.check_output(['netstat', '-ano', '-p', 'TCP'], text=True, startupinfo=startupinfo)
			netstat_lines = netstat_out.splitlines()
		except Exception:
			return None, None

		pid_to_ports = {}
		for line in netstat_lines:
			if 'LISTENING' not in line:
				continue
			parts = line.strip().split()
			if len(parts) >= 5:
				try:
					pid = int(parts[-1])
					local_addr = parts[1]
					port_match = re.search(r':(\d+)$', local_addr)
					if port_match:
						port = int(port_match.group(1))
						pid_to_ports.setdefault(pid, set()).add(port)
				except ValueError:
					continue

		for pid, token in proc_info:
			ports = pid_to_ports.get(pid, [])
			for port in ports:
				addr = f'localhost:{port}'
				try:
					headers = {
						'x-codeium-csrf-token': token,
						'Connect-Protocol-Version': '1',
						'Content-Type': 'application/json',
					}
					r = httpx.post(
						f'http://{addr}/exa.language_server_pb.LanguageServerService/GetAvailableModels',
						headers=headers,
						json={},
						timeout=1.0,
					)
					if r.status_code == 200:
						return addr, token
				except Exception:
					pass
		return None, None
	else:
		# Fallback for Linux/macOS
		cmd_lines = []
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
					candidates.append((f'localhost:{ls_port}', csrf_token))
				except Exception:
					pass
		for addr, token in candidates:
			try:
				headers = {
					'x-codeium-csrf-token': token,
					'Connect-Protocol-Version': '1',
					'Content-Type': 'application/json',
				}
				r = httpx.post(
					f'http://{addr}/exa.language_server_pb.LanguageServerService/GetAvailableModels',
					headers=headers,
					json={},
					timeout=1.0,
				)
				if r.status_code == 200:
					return addr, token
			except Exception:
				pass
		return None, None


def save_antigravity_credentials(addr: str, token: str):
	"""Save active credentials to .env file and environment."""
	os.environ['ANTIGRAVITY_LS_ADDRESS'] = addr
	os.environ['ANTIGRAVITY_CSRF_TOKEN'] = token

	try:
		env_path = project_root / '.env'
		existing = {'ANTIGRAVITY_LS_ADDRESS': addr, 'ANTIGRAVITY_CSRF_TOKEN': token}

		env_content = []
		if env_path.exists():
			for line in env_path.read_text().splitlines():
				if line.startswith('#') or not line.strip() or '=' not in line:
					env_content.append(line)
				else:
					k, _ = line.split('=', 1)
					k = k.strip()
					if k in existing:
						env_content.append(f'{k}={existing[k]}')
						del existing[k]
					else:
						env_content.append(line)

		for k, v in existing.items():
			env_content.append(f'{k}={v}')

		env_path.write_text('\n'.join(env_content) + '\n')
	except Exception:
		pass


# ── Model Scanning (from extension_ui/backend.py) ─────────────
def scan_local_models() -> list[dict]:
	"""Scan for locally available models: Ollama, Antigravity IDE, and API-configured models."""
	scanned_models = []

	# 1. Scan Ollama
	ollama_host = os.getenv('OLLAMA_HOST', 'http://localhost:11434')
	try:
		r = httpx.get(f'{ollama_host}/api/tags', timeout=1.5)
		if r.status_code == 200:
			data = r.json()
			for m in data.get('models', []):
				name = m.get('name', '')
				scanned_models.append(
					{
						'provider': 'Ollama',
						'name': name,
						'id': f'ollama:{name}',
					}
				)
	except Exception:
		pass

	# 2. Scan Antigravity IDE models
	ls_address = os.getenv('ANTIGRAVITY_LS_ADDRESS')
	csrf_token = os.getenv('ANTIGRAVITY_CSRF_TOKEN')

	success = False
	if ls_address and csrf_token:
		try:
			headers = {
				'x-codeium-csrf-token': csrf_token,
				'Connect-Protocol-Version': '1',
				'Content-Type': 'application/json',
			}
			r = httpx.post(
				f'http://{ls_address}/exa.language_server_pb.LanguageServerService/GetAvailableModels',
				headers=headers,
				json={},
				timeout=1.5,
			)
			if r.status_code == 200:
				data = r.json()
				models = data.get('response', {}).get('models', {})
				for key, val in models.items():
					model_enum = val.get('model')
					if model_enum:
						scanned_models.append(
							{
								'provider': 'Antigravity',
								'name': key,
								'id': f'antigravity:{model_enum}',
							}
						)
				success = True
		except Exception:
			pass

	if not success:
		addr, token = autodetect_antigravity_credentials()
		if addr and token:
			save_antigravity_credentials(addr, token)
			try:
				headers = {
					'x-codeium-csrf-token': token,
					'Connect-Protocol-Version': '1',
					'Content-Type': 'application/json',
				}
				r = httpx.post(
					f'http://{addr}/exa.language_server_pb.LanguageServerService/GetAvailableModels',
					headers=headers,
					json={},
					timeout=1.5,
				)
				if r.status_code == 200:
					data = r.json()
					models = data.get('response', {}).get('models', {})
					for key, val in models.items():
						model_enum = val.get('model')
						if model_enum:
							scanned_models.append(
								{
									'provider': 'Antigravity',
									'name': key,
									'id': f'antigravity:{model_enum}',
								}
							)
			except Exception:
				pass

	# 3. API-configured models
	api_models = [
		('BROWSER_USE_API_KEY', 'Browser Use', 'ChatBrowserUse', 'browser_use:ChatBrowserUse'),
		('OPENAI_API_KEY', 'OpenAI', 'gpt-4o-mini', 'openai:gpt-4o-mini'),
		('GOOGLE_API_KEY', 'Google', 'gemini-2.5-flash', 'google:gemini-2.5-flash'),
		('ANTHROPIC_API_KEY', 'Anthropic', 'claude-sonnet-4-0', 'anthropic:claude-sonnet-4-0'),
		('OPENROUTER_API_KEY', 'OpenRouter', 'google/gemini-2.5-flash', 'openrouter:google/gemini-2.5-flash'),
	]
	for env_key, provider, name, model_id in api_models:
		val = os.getenv(env_key, '')
		if val and not val.startswith('your_'):
			scanned_models.append({'provider': provider, 'name': name, 'id': model_id})

	return scanned_models


def resolve_llm(model_spec: str | None):
	"""Resolve a model spec string like 'ollama:llama3' into an LLM instance."""
	if model_spec and ':' in model_spec:
		provider, model_id = model_spec.split(':', 1)
	elif model_spec:
		provider, model_id = 'auto', model_spec
	else:
		provider, model_id = 'auto', ''

	if provider == 'antigravity':
		from browser_use.llm.antigravity.chat import ChatAntigravity

		ls_address = os.getenv('ANTIGRAVITY_LS_ADDRESS', 'localhost:22004')
		csrf_token = os.getenv('ANTIGRAVITY_CSRF_TOKEN')
		return ChatAntigravity(model=model_id, ls_address=ls_address, csrf_token=csrf_token)

	if provider == 'ollama':
		from browser_use import ChatOllama

		return ChatOllama(
			model=model_id,
			host=os.getenv('OLLAMA_HOST'),
			ollama_options={'num_ctx': int(os.getenv('OLLAMA_NUM_CTX', '32000'))},
		)

	if provider == 'openrouter':
		return ChatOpenAI(
			model=model_id,
			base_url='https://openrouter.ai/api/v1',
			api_key=os.getenv('OPENROUTER_API_KEY'),
			max_completion_tokens=int(os.getenv('OPENROUTER_MAX_TOKENS', '2048')),
		)

	if provider == 'openai':
		return ChatOpenAI(model=model_id, api_key=os.getenv('OPENAI_API_KEY'))

	if provider == 'google':
		from browser_use import ChatGoogle

		return ChatGoogle(model=model_id, api_key=os.getenv('GOOGLE_API_KEY'))

	if provider == 'browser_use':
		from browser_use import ChatBrowserUse

		return ChatBrowserUse(api_key=os.getenv('BROWSER_USE_API_KEY'))

	if provider == 'anthropic':
		from browser_use import ChatAnthropic

		return ChatAnthropic(model=model_id, api_key=os.getenv('ANTHROPIC_API_KEY'))

	# Auto-detect fallback
	for key, factory in [
		(
			'ANTIGRAVITY_LS_ADDRESS',
			lambda: __import__('browser_use.llm.antigravity.chat', fromlist=['ChatAntigravity']).ChatAntigravity(
				model='MODEL_GOOGLE_GEMINI_2_5_FLASH',
				ls_address=os.getenv('ANTIGRAVITY_LS_ADDRESS'),
				csrf_token=os.getenv('ANTIGRAVITY_CSRF_TOKEN'),
			),
		),
		('BROWSER_USE_API_KEY', lambda: __import__('browser_use', fromlist=['ChatBrowserUse']).ChatBrowserUse()),
		('OPENAI_API_KEY', lambda: ChatOpenAI(model='gpt-4o-mini')),
		('GOOGLE_API_KEY', lambda: __import__('browser_use', fromlist=['ChatGoogle']).ChatGoogle(model='gemini-2.5-flash')),
		(
			'OPENROUTER_API_KEY',
			lambda: ChatOpenAI(
				model='google/gemini-2.5-flash',
				base_url='https://openrouter.ai/api/v1',
				api_key=os.getenv('OPENROUTER_API_KEY'),
				max_completion_tokens=int(os.getenv('OPENROUTER_MAX_TOKENS', '2048')),
			),
		),
		(
			'ANTHROPIC_API_KEY',
			lambda: __import__('browser_use', fromlist=['ChatAnthropic']).ChatAnthropic(
				model='claude-sonnet-4-0', api_key=os.getenv('ANTHROPIC_API_KEY')
			),
		),
	]:
		val = os.getenv(key, '')
		if val and not val.startswith('your_'):
			return factory()

	# Check scanned local/API models
	models = scan_local_models()
	if models:
		return resolve_llm(models[0]['id'])

	raise ValueError('No LLM configured. Add API keys or start a local model server.')


# ── FastAPI App ────────────────────────────────────────────────
app = FastAPI(title='Pluto Agent Browser Backend')

app.add_middleware(
	CORSMiddleware,
	allow_origins=['*'],
	allow_credentials=True,
	allow_methods=['*'],
	allow_headers=['*'],
)


@app.get('/api/health')
async def health():
	"""Instant health check — returns cached models, NEVER blocks event loop."""
	global _model_cache
	return {
		'status': 'healthy',
		'models': _model_cache,
	}


@app.get('/api/models/scan')
async def models_scan():
	"""Scan models in a background thread to avoid blocking the event loop."""
	global _model_cache, _model_cache_ts
	now = _time.monotonic()
	if now - _model_cache_ts < _MODEL_CACHE_TTL and _model_cache:
		return {'models': _model_cache}
	# Run synchronous scan in a thread so it doesn't block async operations
	loop = asyncio.get_event_loop()
	models_list = await loop.run_in_executor(None, scan_local_models)
	_model_cache = models_list
	_model_cache_ts = now
	return {'models': models_list}


@app.on_event('startup')
async def startup_scan_models():
	"""Pre-populate model cache on startup in a background thread."""
	global _model_cache, _model_cache_ts
	loop = asyncio.get_event_loop()
	try:
		_model_cache = await loop.run_in_executor(None, scan_local_models)
		_model_cache_ts = _time.monotonic()
	except Exception:
		pass


def load_custom_skills() -> str:
	"""Load custom skill instructions from the .agents/skills directory."""
	skills_text = ''
	try:
		skills_dir = Path(__file__).resolve().parent.parent / '.agents' / 'skills'
		if skills_dir.exists():
			for folder in skills_dir.iterdir():
				if folder.is_dir():
					skill_file = folder / 'SKILL.md'
					if skill_file.exists():
						content = skill_file.read_text(encoding='utf-8')
						if content.startswith('---'):
							parts = content.split('---', 2)
							if len(parts) >= 3:
								content = parts[2]
						skills_text += f'\n\n=== Custom Skill Guide: {folder.name} ===\n{content.strip()}\n'
	except Exception as e:
		print(f'[skills load error] {e}')
	return skills_text


@app.get('/api/run')
async def run_task(task: str, model: str = None, url: str = None):
	"""Run the browser-use agent and stream progress as SSE."""

	async def event_generator():
		queue: asyncio.Queue[str] = asyncio.Queue()

		class AgentLogHandler(logging.Handler):
			def emit(self, record):
				msg = self.format(record)
				msg_clean = re.sub(r'\x1b\[[0-9;]*m', '', msg)
				queue.put_nowait(json.dumps({'type': 'step', 'content': msg_clean}))

		handler = AgentLogHandler()
		handler.setFormatter(logging.Formatter('%(message)s'))

		bu_logger = logging.getLogger('browser_use')
		bu_logger.addHandler(handler)
		bu_logger.setLevel(logging.INFO)

		async def run_agent():
			try:
				# Read settings first to apply user preferences to Browser instantiation
				prefs = {}
				if SETTINGS_FILE.exists():
					try:
						prefs = json.loads(SETTINGS_FILE.read_text())
					except Exception:
						pass

				fast_mode = prefs.get('toggle-agent-fast-mode', False)
				max_steps = int(prefs.get('agent-max-steps', 25))

				# ── Pre-flight + browser connection ──────────────────────
				# Pre-flight: verify CDP port is alive with retry loop
				# Uses stdlib urllib (not httpx, which can fail in PyInstaller frozen binaries)
				import urllib.request as _urllib_req

				import httpx as _httpx

				t0 = _time.monotonic()
				cdp_ok = False
				last_err = None
				for attempt in range(15):  # 15 attempts, ~15s total
					try:
						req = _urllib_req.Request(f'{CDP_BASE}/json/version')
						with _urllib_req.urlopen(req, timeout=1.0) as resp:  # noqa: ASYNC210
							if resp.status == 200:
								cdp_ok = True
								print(f'[agent] CDP pre-flight OK in {_time.monotonic() - t0:.3f}s (attempt {attempt + 1})')
								break
					except Exception as err:
						last_err = err
						print(f'[agent] CDP pre-flight attempt {attempt + 1} failed: {err}')
						await asyncio.sleep(0.8)

				if not cdp_ok:
					raise RuntimeError(
						f'CDP port {CDP_PORT} is not responding after {_time.monotonic() - t0:.1f}s ({last_err}). '
						f'Restart the browser or kill stale processes on port {CDP_PORT}.'
					)

				# Always create a fresh Browser() — it's instant (just sets config).
				# browser.start() reconnects via CDP.

				if fast_mode:
					browser = Browser(
						cdp_url=CDP_BASE,
						keep_alive=True,
						cross_origin_iframes=False,
						max_iframes=3,
						max_iframe_depth=1,
						minimum_wait_page_load_time=0.15,
						wait_for_network_idle_page_load_time=0.4,
						wait_between_actions=0.15,
					)
				else:
					browser = Browser(
						cdp_url=CDP_BASE,
						keep_alive=True,
					)

				llm = resolve_llm(model)
				custom_skills = load_custom_skills()

				# Target discovery: find the correct BrowserView tab to focus on
				best_target_id = None
				try:
					resp = _httpx.get(f'{CDP_BASE}/json/list', timeout=1.0)  # noqa: ASYNC210
					targets = resp.json()
					page_targets = [t for t in targets if t.get('type') == 'page']

					if url:
						for t in page_targets:
							t_url = t.get('url', '')
							if url in t_url or t_url in url:
								best_target_id = t.get('id')
								break

					if not best_target_id:
						for t in page_targets:
							t_url = t.get('url', '')
							if 'index.html' in t_url and 'renderer' in t_url:
								continue
							if t_url.startswith('devtools://') or t_url.startswith('chrome-extension://'):
								continue
							best_target_id = t.get('id')
							break
				except Exception as target_err:
					print(f'[agent] Target discovery failed (non-fatal): {target_err}')

				# Start browser + focus on correct tab
				t_start = _time.monotonic()
				await browser.start()
				print(f'[agent] browser.start() took {_time.monotonic() - t_start:.2f}s')
				await asyncio.sleep(0.2 if fast_mode else 0.5)

				if best_target_id:
					try:
						browser.agent_focus_target_id = best_target_id
						await browser.get_or_create_cdp_session(best_target_id, focus=True)
						print(f'[agent] Focused on target: {best_target_id[:8]}...')
					except Exception as focus_err:
						print(f'[agent] Could not focus target {best_target_id}: {focus_err}')

				# ── System prompt: short+fast vs full+detailed ─────────────
				# Fast Mode uses a minimal 3-rule prompt (60% fewer tokens = faster LLM calls).
				# Standard Mode uses the full detailed prompt with all 8 rules + custom skills.
				if fast_mode:
					system_prompt = (
						'You are a fast browser automation agent. Core rules:\n'
						'1. If a page is blank or loading, wait briefly before concluding failure.\n'
						"2. Navigate only within the user's requested page boundaries.\n"
						'3. If a click fails, try keyboard navigation (Tab/Enter/ArrowDown).\n'
						'4. Act decisively and complete tasks in the minimum number of steps.'
					)
				else:
					system_prompt = (
						'You must follow these strict rules to ensure robust browser automation:\n'
						'1. DO NOT PANIC IF A PAGE IS TEMPORARILY BLANK, DARK, OR LOADING:\n'
						'   - When clicking links or submitting forms, the browser page might temporarily appear blank or loading during transition.\n'
						'   - Do NOT immediately declare failure or assume the page is broken.\n'
						'   - Instead, wait a moment, use a scroll action, refresh the page, or go back to the previous page using the browser back button.\n'
						"2. ADHERE STRICTLY TO THE USER'S PAGE BOUNDARIES:\n"
						"   - If the task asks you to play, click, extract, or interact with a song, video, link, or item 'on the present page', 'on the current page', or 'this page', you must NEVER navigate away to search engines or other websites (such as navigating to google.com or a fresh youtube.com search) to find it.\n"
						'   - You must search and interact only within the current viewport and page content. If you cannot find it, scroll up/down, or check the DOM carefully.\n'
						'3. PREFER ROBUST INTERACTION METHODS:\n'
						'   - If a normal click on an element does not work, try clicking a parent/child container of that element.\n'
						"   - If clicking via coordinates/indices still fails or element geometry is missing, you can use keyboard navigation (e.g. using send_keys action with 'Tab', 'ArrowDown', 'Enter') to select and activate the element.\n"
						'4. STRICT ZERO-TRUST VISUAL VERIFICATION PROTOCOL (SCREENSHOT ANALYSIS):\n'
						'   - NEVER trust your own assumptions or assume that an action succeeded without objective visual proof.\n'
						'   - You must continuously analyze the browser screenshots to verify the actual rendering and text on the screen.\n'
						'   - On Coding challenges:\n'
						"     * You MUST ALWAYS use the 'write_code_to_editor' action to write, edit, or update code. NEVER click the editor canvas and try to type using default click + type or fill actions. Doing so will target the wrong inputs (like the 'Test Against common output' or 'Custom Input' box) and fail.\n"
						"     * Identify the main code editor box (which contains Monaco `.monaco-editor` or `.view-lines`). You must ONLY write your code in this editor using 'write_code_to_editor'.\n"
						"     * CRITICAL: Inspect the default template code. If the default template code has hardcoded variable definitions (e.g. `X = 30`) and print statements but does NOT read from `sys.stdin` or `input()`, it is a 'fill in the blanks' challenge. In this case, you MUST NOT clear the editor or write competitive programming template code. Instead, you must keep the template structure exactly as-is (including any comments or print statements) and only replace the `___` or `_____` placeholders with the correct variables or expressions.\n"
						"     * Do NOT type your code or write anything into the 'Test Against common output' or 'Custom Input' text box. That box is strictly for test inputs, not code.\n"
						"     * CRITICAL: Parse and read the 'Sample Input' and 'Sample Output' sections of the problem statement before writing code. Identify the exact formatting expected (e.g. space-separated values, newlines, brackets, commas, or specific message strings).\n"
						"     * CRITICAL STEP SEPARATION: Do NOT include 'write_code_to_editor' and clicking the 'Run' button in the same step/action list. After writing code, you must yield and wait 2 seconds (or use a separate step) to let the editor sync and allow React to enable the Run button. Only click 'Run' in a separate step.\n"
						"     * After clicking 'Run', you MUST wait 5-8 seconds (by putting a wait action AFTER the click action, never before) to let the execution finish. Verify that the 'Your Output' block matches the 'Expected Output' block character-for-character. If the console shows a stale error, click 'Run' again and wait 5 seconds. You must ONLY click the 'Submit' button if they match exactly. If there is any mismatch in formatting, values, or structure (such as brackets, spacing, or extra newlines), or if it shows compile/runtime errors, you must fix the code, click 'Run' again, and verify the match before submitting.\n"
						"     * After clicking 'Submit', you MUST wait 5-8 seconds (by putting a wait action AFTER the click action, never before) and verify in the screenshot that the submission was successful and shows 'Correct Answer' or 'Success'.\n"
						"     * ONLY click the 'Next' button AFTER the submission shows 'Correct Answer' or 'Success' on the screen. Never click 'Next' on a failed or unverified submission.\n"
						"   - Before calling the 'done' action, you MUST visually confirm in the current screenshot that the final state matches the target goal (e.g., the code is fully written, placeholders are completely gone, and tests/runs show 'Passed' or 'Correct').\n"
						"   - For multi-topic course modules (such as 'Pre-requisites' containing multiple sub-topics like 'Arrays Part-1', 'Arrays Part-2', 'Strings Part-1', etc.): the task is only complete when the entire parent module (all sub-topics) is 100% finished. If completing a sub-topic redirects you to the course outline, you must look under the parent module section, find the first incomplete sub-topic (which does NOT have a green checkmark next to it), click it to resume, and solve it. Loop through all sub-topics until all under the parent module are fully completed.\n"
						"   - If the screenshot shows that placeholders '___' remain or that the editor is blank/unmodified, you HAVE NOT completed the task. Continue interacting until the visual proof confirms completion.\n"
						'5. AUTHENTICATION COOKIE STABILIZATION:\n'
						'   - When navigating to the dashboard or courses list page, you MUST wait at least 8-10 seconds for the client-side React hydration and APIs to load the course lists before checking them.\n'
						'6. PREFER CLICK-BASED NAVIGATION AND WAIT FOR HYDRATION:\n'
						"   - NEVER use the 'navigate' action to move between slides, lessons, or back to the course. Doing so bypasses the SPA client router, resulting in blank/skeleton pages.\n"
						"   - ALWAYS use the 'Next' button, on-screen links, or breadcrumbs to navigate.\n"
						'   - When loading a new page or clicking a sub-chapter link, if the screen shows a blank, dark, or skeleton loader page, you MUST wait 5-8 seconds for hydration. Do NOT navigate away or call navigate; the elements will automatically render once React hydration completes.\n'
						'7. ACCURATELY IDENTIFY ACTIVE PROBLEM TITLE:\n'
						'   - NEVER read the problem title or description from the left sidebar course outline or syllabus grid. Those contain list entries of other chapters and problems.\n'
						'   - ALWAYS locate the main, largest heading H1/H2 in the left/center panel to find the active problem title.\n'
						"   - Inspect the active problem's text details carefully to write the correct logic, inputs, and outputs.\n"
						'8. FUNCTION CALL INVOCATION REQUIREMENT:\n'
						"   - CRITICAL: If you define your logic inside a function (e.g. `def solve():`), you MUST explicitly invoke that function at the bottom of the script (e.g., `solve()` or `if __name__ == '__main__': solve()`). Otherwise, the script will do nothing when run, causing the run to fail and the 'Submit' button to remain disabled."
						f'\n\n{custom_skills}'
					)

				if fast_mode:
					# ── FAST MODE (Antigravity-level speed) ───────────────────
					# Every parameter here reduces time complexity:
					# - max_history_items=6:      O(N) context → O(1), ~1-4s saved/step
					# - use_thinking=False:        skips CoT reasoning loop, ~0.5-2s saved/step
					# - use_judge=False:           skips evaluation LLM call, ~1-3s saved/step
					# - message_compaction=False:  no compression overhead
					# - llm_screenshot_size=(800,500): 4x fewer pixels → 4x fewer vision tokens
					# - max_failures=2:            fail fast, no long retry chains
					# - loop_detection_enabled=False: skip N² history scan overhead
					# - max_actions_per_step=5:    batch more actions per LLM call
					# - vision_detail_level='low': 65-token images vs 1000+ token high-detail
					agent = Agent(
						task=task,
						browser=browser,
						llm=llm,
						use_vision=False,
						flash_mode=True,
						use_thinking=False,
						use_judge=False,
						message_compaction=False,
						max_history_items=6,
						max_failures=2,
						max_actions_per_step=5,
						loop_detection_enabled=False,
						vision_detail_level='low',
						llm_screenshot_size=(800, 500),
						controller=controller,
						extend_system_message=system_prompt,
					)
				else:
					# ── STANDARD MODE (full thinking + verification) ──────────
					agent = Agent(
						task=task,
						browser=browser,
						llm=llm,
						use_vision=True,
						flash_mode=False,
						controller=controller,
						extend_system_message=system_prompt,
					)

				history = await agent.run(max_steps=max_steps)

				result = history.final_result() or 'Task completed.'

				# Compute performance summary metrics
				num_steps = history.number_of_steps()
				total_dur = history.total_duration_seconds()
				avg_dur = total_dur / num_steps if num_steps > 0 else 0

				perf_summary = (
					f'\n\n⚡ **Performance Metrics**:\n'
					f'- **Total Steps**: {num_steps}\n'
					f'- **Total Duration**: {total_dur:.2f}s\n'
					f'- **Average Time per Step**: {avg_dur:.2f}s\n'
					f'- **Mode**: {"Fast Mode (Flash Mode 🚀)" if fast_mode else "Standard Mode (Thinking 🧠)"}\n'
				)

				await queue.put(json.dumps({'type': 'result', 'content': result + perf_summary}))
			except asyncio.CancelledError:
				await queue.put(json.dumps({'type': 'error', 'content': 'Task stopped by user.'}))
				raise
			except Exception as e:
				await queue.put(json.dumps({'type': 'error', 'content': str(e)}))
			finally:
				bu_logger.removeHandler(handler)
				await queue.put(json.dumps({'type': 'done', 'content': ''}))

		agent_task = asyncio.create_task(run_agent())
		active_agent_tasks['current'] = agent_task

		while True:
			try:
				item = await asyncio.wait_for(queue.get(), timeout=1.0)
				yield f'data: {item}\n\n'
				if '"type": "done"' in item:
					break
			except asyncio.TimeoutError:
				if agent_task.done():
					break
				yield 'data: {}\n\n'  # keep-alive

	return StreamingResponse(event_generator(), media_type='text/event-stream')


@app.post('/api/chat')
async def chat(request: Request):
	"""Direct LLM chat (no browser automation). Streams response as SSE."""
	body = await request.json()
	message = body.get('message', '')
	model_spec = body.get('model')

	async def stream():
		try:
			llm = resolve_llm(model_spec)
			from browser_use.llm.messages import UserMessage

			response = await llm.ainvoke([UserMessage(content=message)])

			content = response.completion if hasattr(response, 'completion') else str(response)
			yield f'data: {json.dumps({"content": content})}\n\n'
			yield 'data: [DONE]\n\n'
		except Exception as e:
			yield f'data: {json.dumps({"content": f"Error: {e}"})}\n\n'
			yield 'data: [DONE]\n\n'

	return StreamingResponse(stream(), media_type='text/event-stream')


@app.post('/api/settings')
async def save_settings(request: Request):
	"""Save settings (API keys, preferences) to a local JSON file."""
	body = await request.json()

	# Persist API keys to .env file
	api_keys = body.get('api_keys', {})
	if api_keys:
		env_path = project_root / '.env'
		existing = {}
		if env_path.exists():
			for line in env_path.read_text().splitlines():
				if '=' in line and not line.startswith('#'):
					k, v = line.split('=', 1)
					existing[k.strip()] = v.strip()

		for k, v in api_keys.items():
			if v:  # only overwrite if non-empty
				existing[k] = v
				os.environ[k] = v

		env_path.write_text('\n'.join(f'{k}={v}' for k, v in existing.items()) + '\n')

	# Persist other settings to JSON
	settings = body.get('preferences', {})
	if settings:
		existing_settings = {}
		if SETTINGS_FILE.exists():
			existing_settings = json.loads(SETTINGS_FILE.read_text())
		existing_settings.update(settings)
		SETTINGS_FILE.write_text(json.dumps(existing_settings, indent=2))

	return {'status': 'saved'}


@app.get('/api/settings')
async def get_settings():
	"""Load saved settings."""
	preferences = {}
	if SETTINGS_FILE.exists():
		try:
			preferences = json.loads(SETTINGS_FILE.read_text())
		except Exception:
			pass

	# Check which API keys are set in the environment or .env file
	api_keys = {
		'BROWSER_USE_API_KEY': '••••••••' if os.getenv('BROWSER_USE_API_KEY') else '',
		'OPENAI_API_KEY': '••••••••' if os.getenv('OPENAI_API_KEY') else '',
		'ANTHROPIC_API_KEY': '••••••••' if os.getenv('ANTHROPIC_API_KEY') else '',
		'GOOGLE_API_KEY': '••••••••' if os.getenv('GOOGLE_API_KEY') else '',
		'OPENROUTER_API_KEY': '••••••••' if os.getenv('OPENROUTER_API_KEY') else '',
		'OLLAMA_HOST': os.getenv('OLLAMA_HOST') or '',
		'ANTIGRAVITY_LS_ADDRESS': os.getenv('ANTIGRAVITY_LS_ADDRESS') or '',
		'ANTIGRAVITY_CSRF_TOKEN': os.getenv('ANTIGRAVITY_CSRF_TOKEN') or '',
	}

	return {'preferences': preferences, 'api_keys': api_keys}


@app.post('/api/stop')
async def stop_agent():
	"""Cancel the active agent execution task."""
	task = active_agent_tasks.get('current')
	if task and not task.done():
		task.cancel()
		return {'status': 'cancelled'}
	return {'status': 'no_active_task'}


# ── Entrypoint ─────────────────────────────────────────────────
if __name__ == '__main__':
	import uvicorn

	uvicorn.run(app, host='127.0.0.1', port=PLUTO_PORT, log_level='info')

import os
from dataclasses import dataclass
from typing import Any, TypeVar, overload

import httpx
from pydantic import BaseModel

from browser_use.llm.base import BaseChatModel
from browser_use.llm.exceptions import ModelProviderError
from browser_use.llm.messages import BaseMessage
from browser_use.llm.views import ChatInvokeCompletion

T = TypeVar('T', bound=BaseModel)

@dataclass
class ChatAntigravity(BaseChatModel):
	"""
	A wrapper around the local Antigravity Language Server's model response API.
	"""

	model: str  # e.g., "MODEL_GOOGLE_GEMINI_2_5_FLASH"
	ls_address: str | None = None
	csrf_token: str | None = None

	@property
	def provider(self) -> str:
		return 'antigravity'

	@property
	def name(self) -> str:
		return self.model

	def _get_ls_address(self) -> str:
		if self.ls_address:
			return self.ls_address
		val = os.getenv("ANTIGRAVITY_LS_ADDRESS")
		if val:
			return val
		addr, token = self._autodetect_credentials()
		if addr:
			return addr
		return "localhost:22004"

	def _get_csrf_token(self) -> str:
		if self.csrf_token:
			return self.csrf_token
		val = os.getenv("ANTIGRAVITY_CSRF_TOKEN")
		if val:
			return val
		addr, token = self._autodetect_credentials()
		if token:
			return token
		return ""

	def _autodetect_credentials(self) -> tuple[str, str] | tuple[None, None]:
		"""Inspect running processes to find active Antigravity language server address & CSRF token, and save them."""
		import re
		import subprocess
		import sys
		import time
		
		last_time = getattr(self, "_last_autodetect_time", 0.0)
		if time.time() - last_time < 5.0:
			return None, None
		self._last_autodetect_time = time.time()

		if sys.platform == "win32":
			try:
				startupinfo = subprocess.STARTUPINFO()
				startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
				out = subprocess.check_output(
					['wmic', 'process', 'where', "name like '%language_server%'", 'get', 'ProcessId,CommandLine'],
					text=True,
					startupinfo=startupinfo
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
				netstat_out = subprocess.check_output(
					['netstat', '-ano', '-p', 'TCP'],
					text=True,
					startupinfo=startupinfo
				)
				netstat_lines = netstat_out.splitlines()
			except Exception:
				return None, None

			pid_to_ports = {}
			for line in netstat_lines:
				if "LISTENING" not in line:
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
					addr = f"localhost:{port}"
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
							os.environ["ANTIGRAVITY_LS_ADDRESS"] = addr
							os.environ["ANTIGRAVITY_CSRF_TOKEN"] = token
							self.ls_address = addr
							self.csrf_token = token
							
							try:
								from pathlib import Path
								project_root = Path(__file__).resolve().parent.parent.parent.parent
								env_path = project_root / ".env"
								existing = {
									"ANTIGRAVITY_LS_ADDRESS": addr,
									"ANTIGRAVITY_CSRF_TOKEN": token
								}
								env_content = []
								if env_path.exists():
									for el_line in env_path.read_text().splitlines():
										if el_line.startswith("#") or not el_line.strip() or "=" not in el_line:
											env_content.append(el_line)
										else:
											k, _ = el_line.split("=", 1)
											k = k.strip()
											if k in existing:
												env_content.append(f"{k}={existing[k]}")
												del existing[k]
											else:
												env_content.append(el_line)
								for k, v in existing.items():
									env_content.append(f"{k}={v}")
								env_path.write_text("\n".join(env_content) + "\n")
							except Exception:
								pass
								
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
						candidates.append((f"localhost:{ls_port}", csrf_token))
					except Exception:
						pass
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
						os.environ["ANTIGRAVITY_LS_ADDRESS"] = addr
						os.environ["ANTIGRAVITY_CSRF_TOKEN"] = token
						self.ls_address = addr
						self.csrf_token = token
						try:
							from pathlib import Path
							project_root = Path(__file__).resolve().parent.parent.parent.parent
							env_path = project_root / ".env"
							existing = {
								"ANTIGRAVITY_LS_ADDRESS": addr,
								"ANTIGRAVITY_CSRF_TOKEN": token
							}
							env_content = []
							if env_path.exists():
								for el_line in env_path.read_text().splitlines():
									if el_line.startswith("#") or not el_line.strip() or "=" not in el_line:
										env_content.append(el_line)
									else:
										k, _ = el_line.split("=", 1)
										k = k.strip()
										if k in existing:
											env_content.append(f"{k}={existing[k]}")
											del existing[k]
										else:
											env_content.append(el_line)
							for k, v in existing.items():
								env_content.append(f"{k}={v}")
							env_path.write_text("\n".join(env_content) + "\n")
						except Exception:
							pass
						return addr, token
				except Exception:
					pass
			return None, None

	@overload
	async def ainvoke(
		self, messages: list[BaseMessage], output_format: None = None, **kwargs: Any
	) -> ChatInvokeCompletion[str]: ...

	@overload
	async def ainvoke(self, messages: list[BaseMessage], output_format: type[T], **kwargs: Any) -> ChatInvokeCompletion[T]: ...

	async def ainvoke(
		self, messages: list[BaseMessage], output_format: type[T] | None = None, **kwargs: Any
	) -> ChatInvokeCompletion[T] | ChatInvokeCompletion[str]:
		# Compile conversation history into a single prompt for GetModelResponse
		prompt_parts = []
		for msg in messages:
			role = getattr(msg, 'role', 'user')
			
			# Prefer using the message's own .text property to get the full, untruncated text content
			if hasattr(msg, 'text') and msg.text:
				content = msg.text
			else:
				content = getattr(msg, 'content', '')
				# Handle multimodal/list content structure
				if isinstance(content, list):
					text_content = ""
					for part in content:
						if isinstance(part, dict):
							if part.get("type") == "text":
								text_content += part.get("text", "")
						elif hasattr(part, "type") and part.type == "text":
							text_content += getattr(part, "text", "")
						elif hasattr(part, "text"):
							text_content += getattr(part, "text", "")
						elif isinstance(part, str):
							text_content += part
						else:
							text_content += str(part)
					content = text_content
				
			prompt_parts.append(f"{role.upper()}: {content}")
		
		prompt = "\n".join(prompt_parts)
		
		# For structured output validation
		if output_format is not None:
			schema = output_format.model_json_schema()
			prompt += f"\n\nReturn the response ONLY as a valid JSON object matching this schema:\n{schema}"
		else:
			prompt += "\nASSISTANT:"

		headers = {
			"x-codeium-csrf-token": self._get_csrf_token(),
			"Connect-Protocol-Version": "1",
			"Content-Type": "application/json"
		}
		
		payload = {
			"prompt": prompt,
			"model": self.model
		}
		
		url = f"http://{self._get_ls_address()}/exa.language_server_pb.LanguageServerService/GetModelResponse"
		
		try:
			async with httpx.AsyncClient() as client:
				try:
					r = await client.post(url, headers=headers, json=payload, timeout=90.0)
					if r.status_code in (401, 403):
						r.raise_for_status()
				except (httpx.HTTPError, httpx.HTTPStatusError):
					addr, token = self._autodetect_credentials()
					if addr and token:
						headers["x-codeium-csrf-token"] = token
						url = f"http://{addr}/exa.language_server_pb.LanguageServerService/GetModelResponse"
						r = await client.post(url, headers=headers, json=payload, timeout=90.0)
					else:
						raise

				if r.status_code != 200:
					raise ModelProviderError(
						message=f"Antigravity server returned status {r.status_code}: {r.text}",
						model=self.model
					)
				
				data = r.json()
				completion = data.get("response", "")
				
				if output_format is not None:
					import re
					json_str = completion.strip()
					# Clean up potential markdown formatting codeblocks if returned
					if json_str.startswith("```"):
						json_str = re.sub(r"^```[a-zA-Z]*\n", "", json_str)
						json_str = re.sub(r"\n```$", "", json_str)
					parsed_obj = output_format.model_validate_json(json_str)
					return ChatInvokeCompletion(completion=parsed_obj, usage=None)
				else:
					return ChatInvokeCompletion(completion=completion, usage=None)
					
		except Exception as e:
			raise ModelProviderError(message=str(e), model=self.model) from e

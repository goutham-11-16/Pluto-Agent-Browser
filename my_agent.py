import asyncio
import os

from dotenv import load_dotenv

from browser_use import Agent, Browser, ChatOpenAI

# Load environment variables from the .env file (which contains your OPENROUTER_API_KEY)
load_dotenv()

async def main():
    # 1. Initialize the browser in visible/headful mode (headless=False)
    browser = Browser(
        headless=False,
    )

    # 2. Configure the LLM dynamically based on available keys or local configuration
    bu_api_key = os.getenv('BROWSER_USE_API_KEY')
    openrouter_key = os.getenv('OPENROUTER_API_KEY')
    openai_key = os.getenv('OPENAI_API_KEY')
    google_key = os.getenv('GOOGLE_API_KEY')
    antigravity_model = os.getenv('ANTIGRAVITY_MODEL')
    ollama_model = os.getenv('OLLAMA_MODEL')
    local_api_base = os.getenv('LOCAL_API_BASE_URL')
    
    if bu_api_key and bu_api_key != 'your_bu_api_key_here':
        from browser_use import ChatBrowserUse
        llm = ChatBrowserUse(api_key=bu_api_key)
    elif antigravity_model:
        from browser_use.llm.antigravity.chat import ChatAntigravity
        ls_address = os.getenv("ANTIGRAVITY_LS_ADDRESS", "localhost:22004")
        csrf_token = os.getenv("ANTIGRAVITY_CSRF_TOKEN")
        llm = ChatAntigravity(model=antigravity_model, ls_address=ls_address, csrf_token=csrf_token)
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
            "OPENAI_API_KEY, GOOGLE_API_KEY, ANTIGRAVITY_MODEL, OLLAMA_MODEL, or LOCAL_API_BASE_URL."
        )

    # 3. Create the agent
    agent = Agent(
        task='go and search for google',
        browser=browser,
        llm=llm,
        use_vision=True,  # Set to False if using a non-vision model
    )

    # 4. Run the agent
    await agent.run()

if __name__ == "__main__":
    asyncio.run(main())

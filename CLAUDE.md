# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A RAG chatbot that answers questions about course materials. FastAPI backend (`backend/`), vanilla HTML/JS frontend (`frontend/`, served by the backend), ChromaDB vector store, Anthropic Claude for generation. Course transcripts live in `docs/`.

## Commands

Dependencies are managed with `uv` (Python 3.13+):

```bash
uv sync                                              # install dependencies
./run.sh                                             # start server (http://localhost:8000, API docs at /docs)
cd backend && uv run uvicorn app:app --reload --port 8000   # same, manually
```

- The server **must be started from `backend/`**: `app.py` and `config.py` use paths relative to it (`../docs`, `../frontend`, `./chroma_db`).
- `ANTHROPIC_API_KEY` goes in `.env` at the repo root (see `.env.example`). Without it the server still starts and ingests documents; only `/api/query` fails.
- There is no test suite, linter, or formatter configured. To exercise backend pieces without an API key, import them directly, e.g. `cd backend && uv run python -c "from config import config; from rag_system import RAGSystem; print(RAGSystem(config).tool_manager.execute_tool('get_course_outline', course_name='MCP'))"`.

## Architecture

### Query flow (tool-based RAG)
`POST /api/query` → `RAGSystem.query()` (`rag_system.py`) → `AIGenerator.generate_response()` (`ai_generator.py`).

- Retrieval is **not** done up front. Claude is given tools and decides whether to call one; general-knowledge questions are answered without retrieval.
- Only **one round** of tool use is supported: if the first response has `stop_reason == "tool_use"`, tools are executed and a second API call is made **without tools** to produce the final answer.
- Conversation history (`session_manager.py`) is in-memory, capped at `MAX_HISTORY` exchanges, and injected into the **system prompt** rather than the `messages` list. It is lost on server restart; unknown session IDs are handled gracefully.

### Tools (`search_tools.py`)
- `search_course_content` (`CourseSearchTool`) — semantic search over content chunks, optional course/lesson filter.
- `get_course_outline` (`CourseOutlineTool`) — a course's title, link, instructor and lesson list.
- To add a tool: subclass `Tool`, register it in `RAGSystem.__init__`, and describe when to use it in `AIGenerator.SYSTEM_PROMPT`. Claude's tool input is splatted into `execute(**kwargs)`, so the `input_schema` must match the method signature exactly.
- **Sources are a side channel**: tools set `self.last_sources` (a list of `{"text", "url"}` dicts); `RAGSystem.query()` reads them via `ToolManager.get_last_sources()` and then resets them. The API returns them as `List[Source]` (`app.py`). This shared state is not safe under concurrent requests.

### Vector store (`vector_store.py`)
- Two Chroma collections: `course_catalog` (one doc per course; course title is the ID; lessons stored as a JSON string in `lessons_json`) and `course_content` (text chunks with `course_title` / `lesson_number` metadata).
- `_resolve_course_name()` maps a user-supplied name to a real course title: accepted if the embedding distance is ≤ `COURSE_MATCH_MAX_DISTANCE`, otherwise if a non-stopword of the name appears in exactly one course title (needed for acronyms like "MCP"), else `None`. The threshold was tuned on the current four courses — re-measure if the catalog or `EMBEDDING_MODEL` changes.

### Ingestion (`document_processor.py`, `RAGSystem.add_course_folder`)
- Runs on server startup over `../docs`. Courses whose title already exists in Chroma are **skipped**, so edits to an existing transcript are not picked up unless `backend/chroma_db/` is deleted (or `clear_existing=True` is used).
- Expected document format: first lines `Course Title:`, `Course Link:`, `Course Instructor:`, then `Lesson N: <title>` markers, each optionally followed by a `Lesson Link:` line. Text is chunked by sentence (`CHUNK_SIZE` / `CHUNK_OVERLAP` in `config.py`).

### Frontend (`frontend/script.js`)
- Multiple chats are kept client-side and persisted in `localStorage` under `courseChats`. `sendMessage()` captures the chat object at send time, so a reply lands in the chat that asked even if the user has switched chats.
- Sources may be objects (`{text, url}`, rendered as links) or plain strings (older saved chats); `renderSource()` handles both.
- `index.html` loads `style.css?v=N` / `script.js?v=N`; bump `N` when changing those files to bust browser caches.

## Configuration

All tunables (model name, embedding model, chunk sizes, `MAX_RESULTS`, `MAX_HISTORY`, Chroma path) are in `backend/config.py`.

## Git

- Remotes: `origin` is the upstream DeepLearning.AI course repo — **never push to it**; `mine` is the personal repo, and local `main` tracks `mine/main`. Pull course updates explicitly with `git pull origin main`.
- Workflow: do each feature on a `feature/...` branch, commit, fast-forward merge into `main`, then `git push mine main`.
- To undo a commit that has already been pushed, use `git revert`, not `git reset` + force push.

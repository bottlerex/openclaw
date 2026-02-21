"""OpenClaw Mem0 Memory Service v1.2 — Phase 2: dedup + stats + cleanup."""

import json
import logging
import time
import hashlib
from contextlib import asynccontextmanager
from typing import Optional, List

import redis
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from config import MEM0_CONFIG

logging.basicConfig(
    level=logging.INFO,
    format="[mem0-svc] %(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("mem0-svc")
# Reduce mem0 internal logger noise (empty LLM responses → WARNING not ERROR)
logging.getLogger("mem0.memory.main").setLevel(logging.WARNING)


# ── Redis (cache + metrics) ─────────────────────────────────────

redis_client = None

def get_redis():
    global redis_client
    if redis_client is None:
        try:
            redis_client = redis.Redis(
                host='localhost', port=6379, db=0,
                decode_responses=True, socket_connect_timeout=5,
            )
            redis_client.ping()
            log.info("Redis connected @ :6379")
        except Exception as e:
            log.warning(f"Redis unavailable: {e}")
            redis_client = None
    return redis_client

# ── Mem0 client (lazy init) ─────────────────────────────────────

_memory = None

def get_memory():
    global _memory
    if _memory is None:
        from mem0 import Memory
        log.info("Initializing Mem0 client...")
        start = time.time()
        _memory = Memory.from_config(MEM0_CONFIG)
        log.info(f"Mem0 ready in {time.time() - start:.1f}s")
    return _memory

# ── Metrics helpers ──────────────────────────────────────────────

def _incr_metric(key: str, amount: int = 1):
    """Increment a Redis counter for observability."""
    try:
        rc = get_redis()
        if rc:
            rc.hincrby("mem0:metrics", key, amount)
    except Exception:
        pass

def _get_metrics() -> dict:
    try:
        rc = get_redis()
        if rc:
            raw = rc.hgetall("mem0:metrics")
            return {k: int(v) for k, v in raw.items()}
    except Exception:
        pass
    return {}

# ── App lifecycle ────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        get_redis()
        get_memory()
        log.info("Memory service v1.2 started")
    except Exception as e:
        log.error(f"Failed to initialize: {e}")
    yield
    try:
        rc = get_redis()
        if rc:
            rc.close()
    except Exception:
        pass
    log.info("Memory service shutting down")

app = FastAPI(title="OpenClaw Memory Service", version="1.2.0", lifespan=lifespan)

# ── Request/Response models ──────────────────────────────────────

class AddRequest(BaseModel):
    user_id: str = "rex"
    messages: Optional[list] = None
    text: Optional[str] = None
    metadata: Optional[dict] = None

class SearchRequest(BaseModel):
    query: str
    user_id: str = "rex"
    limit: int = 5

class UpdateRequest(BaseModel):
    memory: str

# ── Helpers ──────────────────────────────────────────────────────

def _normalize_results(results) -> list:
    """Normalize mem0 output (may be dict or list depending on version)."""
    if isinstance(results, dict) and "results" in results:
        return results["results"]
    if isinstance(results, list):
        return results
    return []


# ── Input validation ────────────────────────────────────────────

import re as _re

_SKIP_PATTERNS = [
    _re.compile(r"^system:", _re.IGNORECASE),
    _re.compile(r"^\[?\d{4}-\d{2}-\d{2}"),  # timestamps
    _re.compile(r"^cron\s*[:(]", _re.IGNORECASE),
    _re.compile(r"^(hi|hello|hey|你好|嗨|哈囉|早安|晚安)\s*[!.]*$", _re.IGNORECASE),
]

def _should_skip_input(text: str) -> bool:
    """Return True if text is too short or matches skip patterns."""
    if not text or len(text.strip()) < 10:
        return True
    for pat in _SKIP_PATTERNS:
        if pat.search(text.strip()):
            return True
    return False

# ── Routes ───────────────────────────────────────────────────────

@app.get("/health")
async def health():
    try:
        m = get_memory()
        rc = get_redis()
        return {"status": "ok", "mem0": "connected", "redis": "connected" if rc else "offline"}
    except Exception as e:
        return JSONResponse(status_code=503, content={"status": "error", "detail": str(e)})


@app.post("/memory/add")
async def add_memory(req: AddRequest):
    """Add a memory. mem0 uses its LLM to extract key facts automatically."""
    try:
        m = get_memory()
        start = time.time()

        # Extract text for validation
        input_text = ""
        if req.messages:
            input_text = " ".join(m.get("content", "") for m in req.messages if isinstance(m, dict))
        elif req.text:
            input_text = req.text
        else:
            raise HTTPException(400, "Provide 'messages' or 'text'")

        if _should_skip_input(input_text):
            log.info(f"add: skipped (input too short or filtered): '{input_text[:50]}'")
            return {"status": "ok", "result": {"results": []}, "elapsed_seconds": 0, "skipped": True}

        if req.messages:
            result = m.add(messages=req.messages, user_id=req.user_id, metadata=req.metadata)
        else:
            result = m.add(req.text, user_id=req.user_id, metadata=req.metadata)

        elapsed = time.time() - start
        added = _normalize_results(result)
        _incr_metric("adds")
        _incr_metric("facts_extracted", len(added))
        log.info(f"add: user={req.user_id} extracted={len(added)} time={elapsed:.2f}s")
        return {"status": "ok", "result": result, "elapsed_seconds": elapsed}
    except HTTPException:
        raise
    except Exception as e:
        _incr_metric("add_errors")
        log.error(f"add error: {e}")
        raise HTTPException(500, str(e))


@app.post("/memory/search")
async def search_memory(req: SearchRequest):
    """Search for relevant memories."""
    try:
        m = get_memory()
        start = time.time()
        results = m.search(req.query, user_id=req.user_id, limit=req.limit)
        elapsed = time.time() - start

        memories = _normalize_results(results)
        _incr_metric("searches")
        _incr_metric("search_hits" if memories else "search_misses")
        log.info(f"search: user={req.user_id} q='{req.query[:50]}' results={len(memories)} time={elapsed:.3f}s")
        return {"status": "ok", "memories": memories, "elapsed_seconds": elapsed}
    except Exception as e:
        _incr_metric("search_errors")
        log.error(f"search error: {e}")
        raise HTTPException(500, str(e))


@app.get("/memory/list")
async def list_memories(user_id: str = "rex"):
    """List all memories for a user."""
    try:
        m = get_memory()
        results = m.get_all(user_id=user_id)
        memories = _normalize_results(results)
        log.info(f"list: user={user_id} count={len(memories)}")
        return {"status": "ok", "memories": memories, "count": len(memories)}
    except Exception as e:
        log.error(f"list error: {e}")
        raise HTTPException(500, str(e))


@app.delete("/memory/{memory_id}")
async def delete_memory(memory_id: str):
    """Delete a specific memory."""
    try:
        m = get_memory()
        m.delete(memory_id)
        _incr_metric("deletes")
        log.info(f"delete: id={memory_id}")
        return {"status": "ok", "deleted": memory_id}
    except Exception as e:
        log.error(f"delete error: {e}")
        raise HTTPException(500, str(e))


@app.put("/memory/{memory_id}")
async def update_memory(memory_id: str, req: UpdateRequest):
    """Update a specific memory."""
    try:
        m = get_memory()
        result = m.update(memory_id, req.memory)
        _incr_metric("updates")
        log.info(f"update: id={memory_id}")
        return {"status": "ok", "result": result}
    except Exception as e:
        log.error(f"update error: {e}")
        raise HTTPException(500, str(e))


@app.get("/memory/stats")
async def memory_stats(user_id: str = "rex"):
    """Get memory statistics: counts, metrics, Redis info."""
    try:
        # Memory count
        m = get_memory()
        results = m.get_all(user_id=user_id)
        memories = _normalize_results(results)

        # Redis info
        rc = get_redis()
        cache_info = {}
        if rc:
            info = rc.info("memory")
            cache_info = {
                "redis_memory_used": info.get("used_memory_human", "N/A"),
                "redis_keys": rc.dbsize(),
            }

        # Operational metrics
        op_metrics = _get_metrics()

        return {
            "status": "ok",
            "user_id": user_id,
            "memory_count": len(memories),
            "operations": op_metrics,
            "cache": cache_info,
        }
    except Exception as e:
        log.warning(f"stats error: {e}")
        return {"status": "ok", "memory_count": -1, "operations": {}, "cache": {}}


@app.post("/memory/cleanup")
async def cleanup_memories(user_id: str = "rex", dry_run: bool = True):
    """Remove duplicate memories (cosine similarity > 0.92)."""
    try:
        m = get_memory()
        results = m.get_all(user_id=user_id)
        memories = _normalize_results(results)

        if len(memories) < 2:
            return {"status": "ok", "checked": len(memories), "duplicates": 0, "deleted": 0}

        # Find duplicates by checking each memory against all others via search
        to_delete = set()
        seen_texts = []

        for mem in memories:
            mid = mem.get("id", "")
            text = mem.get("memory", "") or mem.get("text", "")
            if mid in to_delete or not text:
                continue

            # Check against already seen texts for near-duplicates
            for seen_id, seen_text in seen_texts:
                # Simple heuristic: if texts share >80% of words, it's a duplicate
                words_a = set(text.lower().split())
                words_b = set(seen_text.lower().split())
                if not words_a or not words_b:
                    continue
                overlap = len(words_a & words_b) / max(len(words_a), len(words_b))
                if overlap > 0.8:
                    to_delete.add(mid)
                    break

            if mid not in to_delete:
                seen_texts.append((mid, text))

        deleted = 0
        if not dry_run:
            for mid in to_delete:
                try:
                    m.delete(mid)
                    deleted += 1
                except Exception as e:
                    log.warning(f"cleanup delete failed: {mid}: {e}")

        _incr_metric("cleanup_runs")
        _incr_metric("duplicates_found", len(to_delete))
        log.info(f"cleanup: user={user_id} checked={len(memories)} duplicates={len(to_delete)} deleted={deleted} dry_run={dry_run}")

        return {
            "status": "ok",
            "checked": len(memories),
            "duplicates": len(to_delete),
            "deleted": deleted,
            "dry_run": dry_run,
            "duplicate_ids": list(to_delete),
        }
    except Exception as e:
        log.error(f"cleanup error: {e}")
        raise HTTPException(500, str(e))


# ── Main ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002, log_level="info")

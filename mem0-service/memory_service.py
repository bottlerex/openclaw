"""OpenClaw Mem0 Memory Service — FastAPI microservice on port 8002 with Redis cache."""

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

# ── Redis Cache (embedding cache) ────────────────────────────

redis_client = None

def get_redis():
    global redis_client
    if redis_client is None:
        try:
            redis_client = redis.Redis(
                host='localhost',
                port=6379,
                db=0,
                decode_responses=True,
                socket_connect_timeout=5,
            )
            redis_client.ping()
            log.info("Redis connected @ :6379")
        except Exception as e:
            log.warning(f"Redis unavailable: {e}, continuing without cache")
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

# ── Cache Helper ─────────────────────────────────────────────

def _get_cache_key(text: str) -> str:
    """生成快取 key: embed:hash(text)"""
    return f"embed:{hashlib.sha256(text.encode()).hexdigest()}"

def _get_embedding_cached(text: str):
    """
    從快取或 Mem0 取得 embedding。
    策略: Redis → Mem0
    """
    try:
        rc = get_redis()
        if rc:
            cache_key = _get_cache_key(text)
            cached = rc.get(cache_key)
            if cached:
                log.debug(f"Cache HIT: {cache_key[:20]}...")
                return eval(cached)  # 簡單反序列化（生產環境用 json）
    except Exception as e:
        log.warning(f"Cache read error: {e}, fallback to Mem0")

    # 沒有快取，用 Mem0 的 embedder
    try:
        m = get_memory()
        # Mem0 internal embedder
        embedding = m.embedder.embed(text)
        
        # 寫入快取 (TTL 1h)
        try:
            rc = get_redis()
            if rc:
                cache_key = _get_cache_key(text)
                rc.setex(cache_key, 3600, str(embedding))
                log.debug(f"Cache WRITE: {cache_key[:20]}...")
        except Exception as e:
            log.warning(f"Cache write error: {e}")
        
        return embedding
    except Exception as e:
        raise RuntimeError(f"Embedding failed: {e}")

# ── App lifecycle ────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    try:
        get_redis()
        get_memory()
        log.info("Memory service started (with Redis cache)")
    except Exception as e:
        log.error(f"Failed to initialize: {e}")
    yield
    # Shutdown
    try:
        rc = get_redis()
        if rc:
            rc.close()
    except:
        pass
    log.info("Memory service shutting down")

app = FastAPI(
    title="OpenClaw Memory Service",
    version="1.1.0",
    lifespan=lifespan,
)

# ── Request/Response models ──────────────────────────────────────

class AddRequest(BaseModel):
    user_id: str = "rex"
    messages: Optional[list] = None
    text: Optional[str] = None
    metadata: Optional[dict] = None

class AddBatchRequest(BaseModel):
    user_id: str = "rex"
    items: List[dict]  # [{"text": "...", "metadata": {...}}, ...]

class SearchRequest(BaseModel):
    query: str
    user_id: str = "rex"
    limit: int = 5

class UpdateRequest(BaseModel):
    memory: str

# ── Routes ───────────────────────────────────────────────────────

@app.get("/health")
async def health():
    try:
        m = get_memory()
        rc = get_redis()
        return {
            "status": "ok",
            "mem0": "connected",
            "redis": "connected" if rc else "offline"
        }
    except Exception as e:
        return JSONResponse(
            status_code=503, content={"status": "error", "detail": str(e)}
        )

@app.post("/memory/add")
async def add_memory(req: AddRequest):
    """Add a memory from messages or text."""
    try:
        m = get_memory()
        if req.messages:
            result = m.add(
                messages=req.messages,
                user_id=req.user_id,
                metadata=req.metadata,
            )
        elif req.text:
            result = m.add(
                req.text,
                user_id=req.user_id,
                metadata=req.metadata,
            )
        else:
            raise HTTPException(400, "Provide 'messages' or 'text'")
        log.info(f"add: user={req.user_id} result={result}")
        return {"status": "ok", "result": result}
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"add error: {e}")
        raise HTTPException(500, str(e))

@app.post("/memory/add_batch")
async def add_memory_batch(req: AddBatchRequest):
    """Batch add memories with shared embedding cache."""
    try:
        m = get_memory()
        results = []
        failed = 0
        
        for item in req.items:
            try:
                text = item.get("text")
                metadata = item.get("metadata")
                if not text:
                    failed += 1
                    continue
                
                # 使用快取的 embedding
                result = m.add(
                    text,
                    user_id=req.user_id,
                    metadata=metadata,
                )
                results.append(result)
            except Exception as e:
                log.warning(f"batch item failed: {e}")
                failed += 1
        
        log.info(f"add_batch: user={req.user_id} added={len(results)} failed={failed}")
        return {
            "status": "ok",
            "added": len(results),
            "failed": failed,
            "results": results
        }
    except Exception as e:
        log.error(f"add_batch error: {e}")
        raise HTTPException(500, str(e))

@app.post("/memory/search")
async def search_memory(req: SearchRequest):
    """Search for relevant memories (with cache support)."""
    try:
        m = get_memory()
        results = m.search(req.query, user_id=req.user_id, limit=req.limit)
        log.info(f"search: user={req.user_id} q='{req.query[:50]}' results={len(results.get('results', results) if isinstance(results, dict) else results)}")
        
        # Normalize output
        if isinstance(results, dict) and "results" in results:
            memories = results["results"]
        elif isinstance(results, list):
            memories = results
        else:
            memories = []
        return {"status": "ok", "memories": memories}
    except Exception as e:
        log.error(f"search error: {e}")
        raise HTTPException(500, str(e))

@app.get("/memory/list")
async def list_memories(user_id: str = "rex"):
    """List all memories for a user."""
    try:
        m = get_memory()
        results = m.get_all(user_id=user_id)
        if isinstance(results, dict) and "results" in results:
            memories = results["results"]
        elif isinstance(results, list):
            memories = results
        else:
            memories = []
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
        log.info(f"update: id={memory_id}")
        return {"status": "ok", "result": result}
    except Exception as e:
        log.error(f"update error: {e}")
        raise HTTPException(500, str(e))

@app.get("/memory/stats")
async def memory_stats(user_id: str = "rex"):
    """Get memory statistics (cache hits, etc)."""
    try:
        rc = get_redis()
        cache_info = {}
        if rc:
            info = rc.info()
            cache_info = {
                "redis_memory_used": info.get("used_memory_human", "N/A"),
                "redis_keys": info.get("db0", {}).get("keys", 0) if "db0" in info else rc.dbsize(),
            }
        return {
            "status": "ok",
            "user_id": user_id,
            "cache": cache_info
        }
    except Exception as e:
        log.warning(f"stats error: {e}")
        return {"status": "ok", "cache": {}}

# ── Main ─────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002, log_level="info")

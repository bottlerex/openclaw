#!/usr/bin/env node
// rag-search.mjs — query → Ollama embedding → cosine search → top-K 結果
// 用法: node scripts/rag-search.mjs "搜索內容" [--top-k 5] [--db data/rag-index.sqlite]

import { DatabaseSync } from "node:sqlite";
import { load } from "sqlite-vec";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const { values: args, positionals } = parseArgs({
  options: {
    db: { type: "string", default: "data/rag-index.sqlite" },
    "top-k": { type: "string", default: "5" },
    "ollama-url": { type: "string", default: "http://localhost:11434" },
    model: { type: "string", default: "nomic-embed-text" },
    json: { type: "boolean", default: false },
  },
  allowPositionals: true,
});

const query = positionals[0];
if (!query) {
  console.error('用法: node rag-search.mjs "搜索內容" [--top-k 5] [--db path] [--json]');
  process.exit(1);
}

const DB_PATH = resolve(args.db);
const TOP_K = parseInt(args["top-k"]);
const OLLAMA_URL = args["ollama-url"];
const MODEL = args.model;

function vecBuffer(values) {
  return Buffer.from(new Float32Array(values).buffer);
}

async function getEmbedding(text) {
  const resp = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, input: text }),
  });
  if (!resp.ok) {
    throw new Error(`Ollama embed failed: ${resp.status} ${await resp.text()}`);
  }
  const data = await resp.json();
  return data.embeddings[0];
}

async function main() {
  // 取得 query embedding
  const queryVec = await getEmbedding(query);

  // 開啟 DB
  const db = new DatabaseSync(DB_PATH, { allowExtension: true });
  load(db);

  // cosine search
  const rows = db.prepare(`
    SELECT
      v.id,
      vec_distance_cosine(v.embedding, ?) AS distance,
      m.source,
      m.text,
      m.chunk_index
    FROM chunks_vec v
    JOIN chunks_meta m ON v.id = m.id
    ORDER BY distance ASC
    LIMIT ?
  `).all(vecBuffer(queryVec), TOP_K);

  db.close();

  // 輸出結果
  const results = rows.map((row) => ({
    source: row.source,
    chunk_index: row.chunk_index,
    score: (1 - row.distance).toFixed(4),
    text: row.text.slice(0, 200) + (row.text.length > 200 ? "..." : ""),
  }));

  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    if (results.length === 0) {
      console.log("No results found.");
      return;
    }
    console.log(`Search: "${query}" → ${results.length} results\n`);
    for (const r of results) {
      console.log(`[${r.score}] ${r.source} (chunk #${r.chunk_index})`);
      console.log(`  ${r.text}\n`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

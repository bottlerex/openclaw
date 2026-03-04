#!/usr/bin/env node
// rag-index.mjs — 讀文件 → chunk → Ollama embedding → sqlite-vec 存儲
// 用法: node scripts/rag-index.mjs --dir <目錄> [--db data/rag-index.sqlite] [--chunk-size 500] [--overlap 100]

import { DatabaseSync } from "node:sqlite";
import { load } from "sqlite-vec";
import { readdir, readFile, stat, mkdir } from "node:fs/promises";
import { join, resolve, extname, relative, dirname } from "node:path";
import { parseArgs } from "node:util";

// === 參數解析 ===
const { values: args } = parseArgs({
  options: {
    dir: { type: "string" },
    db: { type: "string", default: "data/rag-index.sqlite" },
    "chunk-size": { type: "string", default: "500" },
    overlap: { type: "string", default: "100" },
    "ollama-url": { type: "string", default: "http://localhost:11434" },
    model: { type: "string", default: "nomic-embed-text" },
    clear: { type: "boolean", default: false },
  },
});

if (!args.dir) {
  console.error("用法: node rag-index.mjs --dir <目錄> [--db path] [--chunk-size N] [--overlap N] [--clear]");
  process.exit(1);
}

const DIR = resolve(args.dir);
const DB_PATH = resolve(args.db);
const CHUNK_SIZE = parseInt(args["chunk-size"]);
const OVERLAP = parseInt(args.overlap);
const OLLAMA_URL = args["ollama-url"];
const MODEL = args.model;
const EMBEDDING_DIM = 768; // nomic-embed-text 維度

// === 工具函數 ===
function chunkText(text, chunkSize, overlap) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    start += chunkSize - overlap;
    if (end === text.length) break;
  }
  return chunks;
}

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

async function collectFiles(dir, exts = [".md", ".txt"]) {
  const files = [];
  async function walk(d) {
    const entries = await readdir(d, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(d, entry.name);
      if (entry.isDirectory()) {
        // 跳過隱藏目錄和 node_modules
        if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
          await walk(fullPath);
        }
      } else if (exts.includes(extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  }
  await walk(dir);
  return files;
}

// === 主程式 ===
async function main() {
  // 確保 DB 目錄存在
  await mkdir(dirname(DB_PATH), { recursive: true });

  // 初始化 DB
  const db = new DatabaseSync(DB_PATH, { allowExtension: true });
  load(db);

  // 建表
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks_meta (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      text TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      indexed_at TEXT NOT NULL
    );
  `);

  // 檢查 vec 表是否存在
  const tableCheck = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_vec'"
  ).get();

  if (!tableCheck) {
    db.exec(`
      CREATE VIRTUAL TABLE chunks_vec USING vec0(
        id TEXT PRIMARY KEY,
        embedding FLOAT[${EMBEDDING_DIM}]
      );
    `);
  }

  // 清除舊數據 (如果 --clear)
  if (args.clear) {
    db.exec("DELETE FROM chunks_meta");
    db.exec("DELETE FROM chunks_vec");
    console.log("Cleared existing index");
  }

  // 收集文件
  const files = await collectFiles(DIR);
  console.log(`Found ${files.length} files in ${DIR}`);

  const insertMeta = db.prepare(
    "INSERT OR REPLACE INTO chunks_meta (id, source, text, chunk_index, indexed_at) VALUES (?, ?, ?, ?, ?)"
  );
  const insertVec = db.prepare(
    "INSERT OR REPLACE INTO chunks_vec (id, embedding) VALUES (?, ?)"
  );

  let totalChunks = 0;

  for (const file of files) {
    const relPath = relative(DIR, file);
    const content = await readFile(file, "utf-8");

    if (content.trim().length === 0) continue;

    const chunks = chunkText(content, CHUNK_SIZE, OVERLAP);
    console.log(`  ${relPath}: ${chunks.length} chunks`);

    for (let i = 0; i < chunks.length; i++) {
      const chunkId = `${relPath}#${i}`;
      const chunkText = chunks[i];
      const now = new Date().toISOString();

      try {
        const embedding = await getEmbedding(chunkText);
        insertMeta.run(chunkId, relPath, chunkText, i, now);
        insertVec.run(chunkId, vecBuffer(embedding));
        totalChunks++;
      } catch (err) {
        console.error(`  Error embedding ${chunkId}: ${err.message}`);
      }
    }
  }

  db.close();
  console.log(`\nIndexed ${totalChunks} chunks from ${files.length} files → ${DB_PATH}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

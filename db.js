// Простое файловое хранилище проектов (JSON-файл).
// На Render бесплатном тарифе диск эфемерный — данные могут пропасть при передеплое/рестарте.
// Для прод-версии стоит заменить на Render Postgres или другую БД.
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "projects.json");

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf8");
}

function readAll() {
  ensureStore();
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(raw || "[]");
  } catch (e) {
    console.error("Не удалось прочитать хранилище проектов:", e);
    return [];
  }
}

function writeAll(projects) {
  ensureStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(projects, null, 2), "utf8");
}

function list() {
  return readAll()
    .map((p) => ({
      id: p.id,
      title: p.title,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function get(id) {
  return readAll().find((p) => p.id === id) || null;
}

function upsert(project) {
  const all = readAll();
  const idx = all.findIndex((p) => p.id === project.id);
  project.updatedAt = new Date().toISOString();
  if (idx === -1) {
    project.createdAt = project.createdAt || project.updatedAt;
    all.push(project);
  } else {
    all[idx] = { ...all[idx], ...project };
  }
  writeAll(all);
  return get(project.id);
}

function remove(id) {
  const all = readAll().filter((p) => p.id !== id);
  writeAll(all);
}

module.exports = { list, get, upsert, remove };

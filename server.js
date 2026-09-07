const express = require("express");
const path = require("path");
const crypto = require("crypto");
const db = require("./db");
const { DEFAULT_MODELS, BLOCKS, generateForModels, fetchModelList } = require("./openrouter");

const app = express();
app.use(express.json({ limit: "1mb" }));
// Отдаём статику из корня проекта: при загрузке файлов через GitHub-веб-интерфейс
// (Add file → Upload files) вложенные папки часто "разворачиваются" в корень,
// поэтому index.html/app.js/style.css ищем прямо рядом с server.js.
app.use(express.static(__dirname));

// -------- API --------

app.get("/api/config", (req, res) => {
  res.json({ defaultModels: DEFAULT_MODELS, blocks: BLOCKS });
});

// Живой список моделей с OpenRouter — чтобы в настройках можно было найти
// точный актуальный ID модели, а не гадать вручную (ID у OpenRouter иногда меняются).
app.get("/api/models", async (req, res) => {
  try {
    const models = await fetchModelList();
    res.json({ models });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.get("/api/projects", (req, res) => {
  res.json(db.list());
});

app.get("/api/projects/:id", (req, res) => {
  const project = db.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Проект не найден" });
  res.json(project);
});

app.post("/api/projects", (req, res) => {
  const { title, product, models, results, selections, finalText } = req.body || {};
  const project = {
    id: crypto.randomUUID(),
    title: title || (product && product.name) || "Без названия",
    product: product || {},
    models: models || [],
    results: results || [],
    selections: selections || {},
    finalText: finalText || "",
  };
  const saved = db.upsert(project);
  res.json(saved);
});

app.put("/api/projects/:id", (req, res) => {
  const existing = db.get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Проект не найден" });
  const updated = db.upsert({ ...existing, ...req.body, id: req.params.id });
  res.json(updated);
});

app.delete("/api/projects/:id", (req, res) => {
  db.remove(req.params.id);
  res.json({ ok: true });
});

app.post("/api/generate", async (req, res) => {
  const apiKey = req.header("x-openrouter-key");
  if (!apiKey) {
    return res.status(400).json({ error: "Не передан OpenRouter API-ключ (заголовок x-openrouter-key)" });
  }
  const { product, models } = req.body || {};
  if (!product || !product.name) {
    return res.status(400).json({ error: "Не указано название товара" });
  }
  const modelList = Array.isArray(models) && models.length ? models : DEFAULT_MODELS.map((m) => m.id);

  try {
    const results = await generateForModels({ apiKey, models: modelList, product });
    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Scenario Builder запущен на порту ${PORT}`);
});

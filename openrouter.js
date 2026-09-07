// Логика обращения к OpenRouter и парсинга ответов моделей.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

// Модели по умолчанию. OpenRouter довольно часто переименовывает/обновляет
// ID моделей, поэтому эти значения могут со временем протухнуть — на этот
// случай в настройках сайта есть живой поиск по актуальному списку моделей
// (см. GET /api/models), где можно найти правильный ID и добавить его.
const DEFAULT_MODELS = [
  { id: "anthropic/claude-sonnet-5", label: "Claude (Sonnet)" },
  { id: "openai/gpt-5-5", label: "GPT (OpenAI)" },
  { id: "google/gemini-3.5-flash", label: "Gemini (Google)" },
  { id: "x-ai/grok-4.6", label: "Grok (xAI)" },
];

// Простой кэш списка моделей, чтобы не дёргать OpenRouter при каждом
// открытии настроек на сайте.
let modelsCache = { data: null, ts: 0 };
const MODELS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 минут

async function fetchModelList() {
  const now = Date.now();
  if (modelsCache.data && now - modelsCache.ts < MODELS_CACHE_TTL_MS) {
    return modelsCache.data;
  }
  const resp = await fetch(OPENROUTER_MODELS_URL);
  if (!resp.ok) {
    throw new Error(`OpenRouter models ${resp.status}`);
  }
  const json = await resp.json();
  const list = (json.data || []).map((m) => ({
    id: m.id,
    name: m.name || m.id,
    context_length: m.context_length || null,
  }));
  modelsCache = { data: list, ts: now };
  return list;
}

const BLOCKS = [
  { key: "headlines", label: "Заголовки" },
  { key: "text_hooks", label: "Текстовые хуки" },
  { key: "visual_hooks", label: "Визуальные хуки" },
  { key: "demonstration", label: "Демонстрация товара" },
  { key: "before_after", label: "До / После" },
  { key: "scenario_outline", label: "Общий сценарий подачи" },
];

function buildPrompt({ name, description, audience, category, language }) {
  const lang = language === "en" ? "английском" : "русском";
  return `Ты — маркетолог-копирайтер, который придумывает рекламные сценарии для видео/креативов.

Товар: ${name || "(не указано)"}
Описание: ${description || "(не указано)"}
Целевая аудитория: ${audience || "не указана"}
Категория/ниша: ${category || "не указана"}

Придумай варианты подачи этого товара в рекламе. Ответь СТРОГО в виде одного JSON-объекта без каких-либо пояснений до или после, на ${lang} языке, со следующей структурой:

{
  "headlines": ["заголовок 1", "заголовок 2", "заголовок 3"],
  "text_hooks": ["текстовый хук 1 (первая фраза, которая цепляет в первые 2 секунды)", "хук 2", "хук 3"],
  "visual_hooks": ["визуальный хук 1 (что происходит в кадре в первые секунды)", "визуальный хук 2", "визуальный хук 3"],
  "demonstration": ["идея демонстрации товара в действии 1", "идея 2"],
  "before_after": [
    {"before": "ситуация/проблема до", "after": "результат/трансформация после"},
    {"before": "...", "after": "..."}
  ],
  "scenario_outline": "Короткий цельный сценарий подачи: с чего начать (хук), как обозначить проблему, как показать демонстрацию/решение, как показать до-после или доказательство, чем закончить (призыв к действию). 5-8 предложений."
}

Никакого текста вне JSON. Никаких markdown-разметок (без \`\`\`).`;
}

function tryParseJson(text) {
  if (!text) return null;
  // 1) прямая попытка
  try {
    return JSON.parse(text);
  } catch (_) {}
  // 2) вырезать из ```json ... ``` или просто ``` ... ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch (_) {}
  }
  // 3) вырезать первую { ... последнюю }
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    try {
      return JSON.parse(text.slice(first, last + 1));
    } catch (_) {}
  }
  return null;
}

function normalizeResult(parsed, rawText) {
  if (!parsed || typeof parsed !== "object") {
    return {
      headlines: [],
      text_hooks: [],
      visual_hooks: [],
      demonstration: [],
      before_after: [],
      scenario_outline: rawText || "",
      _parseFailed: true,
    };
  }
  const arr = (v) => (Array.isArray(v) ? v.filter(Boolean).map(String) : []);
  const beforeAfter = Array.isArray(parsed.before_after)
    ? parsed.before_after
        .map((x) => {
          if (x && typeof x === "object") {
            return { before: String(x.before || ""), after: String(x.after || "") };
          }
          return null;
        })
        .filter(Boolean)
    : [];
  return {
    headlines: arr(parsed.headlines),
    text_hooks: arr(parsed.text_hooks),
    visual_hooks: arr(parsed.visual_hooks),
    demonstration: arr(parsed.demonstration),
    before_after: beforeAfter,
    scenario_outline: typeof parsed.scenario_outline === "string" ? parsed.scenario_outline : "",
  };
}

async function callModel({ apiKey, model, product }) {
  const prompt = buildPrompt(product);
  try {
    const resp = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://scenario-builder.local",
        "X-Title": "Scenario Builder",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.9,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      return { model, ok: false, error: `OpenRouter ${resp.status}: ${errText.slice(0, 300)}` };
    }

    const json = await resp.json();
    const content = json?.choices?.[0]?.message?.content || "";
    const parsed = tryParseJson(content);
    const data = normalizeResult(parsed, content);
    return { model, ok: true, data };
  } catch (e) {
    return { model, ok: false, error: e.message || String(e) };
  }
}

async function generateForModels({ apiKey, models, product }) {
  const results = await Promise.all(
    models.map((model) => callModel({ apiKey, model, product }))
  );
  return results;
}

module.exports = { DEFAULT_MODELS, BLOCKS, generateForModels, fetchModelList };

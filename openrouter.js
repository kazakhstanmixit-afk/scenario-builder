// Логика обращения к OpenRouter и парсинга ответов моделей.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

// Модели по умолчанию. OpenRouter довольно часто переименовывает/обновляет
// ID моделей, поэтому эти значения могут со временем протухнуть — на этот
// случай в настройках сайта есть живой поиск по актуальному списку моделей
// (см. GET /api/models), где можно найти правильный ID и добавить его.
// GPT/OpenAI намеренно не включён по умолчанию: два подряд ID (gpt-5-5, gpt-4-1)
// оказались невалидными на OpenRouter, а проверить актуальный ID из своей среды
// я не могу (нет доступа к openrouter.ai). Добавляется вручную через живой поиск
// моделей в Настройках сайта — там показывается реальный список с самого OpenRouter.
const DEFAULT_MODELS = [
  { id: "anthropic/claude-sonnet-5", label: "Claude (Sonnet)" },
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
  { key: "pain", label: "Боли клиента" },
  { key: "positioning", label: "Позиционирование (по Трауту)" },
  { key: "headlines", label: "Заголовки" },
  { key: "text_hooks", label: "Текстовые хуки" },
  { key: "visual_hooks", label: "Визуальные хуки" },
  { key: "demonstration", label: "Демонстрация товара" },
  { key: "before_after", label: "До / После" },
  { key: "cta", label: "Призыв к действию" },
  { key: "scenario_outline", label: "Общий сценарий подачи" },
];

// Приёмы позиционирования по Джеку Трауту / Элу Райсу — коротко,
// чтобы модель выбирала из них, а не изобретала своё.
const TROUT_TECHNIQUES = `1. Владеть атрибутом — присвоить одно ключевое свойство (скорость, натуральность, стойкость, простота), которым ещё не владеет конкурент.
2. Владеть проблемой — стать решением конкретной узкой проблемы аудитории.
3. Владеть результатом — продавать не свойства, а обещанный результат/трансформацию.
4. Создать категорию — если сложно быть №1 в большой категории, сузить нишу и стать №1 в ней.
5. Позиция эксперта/специалиста — бренд = эксперт в узкой области, а не "для всех".
6. Через ингредиент/технологию — присвоить конкретный компонент или метод как доказательство (например: "коллаген и биотин").
7. Против категории — противопоставить себя привычному, "устаревшему" способу решения.
8. Через аудиторию — сузиться до конкретной узкой аудитории вместо "для всех".
9. Через систему/шаги — подать как понятную систему "шаг 1 → шаг 2 → шаг 3", а не один продукт.
10. Репозиционирование конкурента — показать, что привычная альтернатива сложна/устарела/неудобна.
11. Доступная альтернатива люксу — позиционировать как "аналог люкса/премиум-бренда", но дешевле и доступнее.`;

function buildPrompt({ name, description, audience, category, language }) {
  const lang = language === "en" ? "английском" : "русском";
  return `Ты — маркетолог-копирайтер и стратег по позиционированию (школа Джека Траута и Эла Райса), который придумывает короткие рекламные сценарии для соцсетей (TikTok/Reels/Shorts).

Товар: ${name || "(не указано)"}
Описание: ${description || "(не указано)"}
Целевая аудитория: ${audience || "не указана"}
Категория/ниша: ${category || "не указана"}

ГЛАВНОЕ ПРАВИЛО — КОНТЕКСТ, А НЕ ШАБЛОН:
Всё, что ты пишешь, должно опираться на реальные детали ИМЕННО этого товара из описания выше — конкретные свойства, состав, формат использования, цену, нишу. Не пиши общими фразами, которые с тем же успехом подошли бы любому другому товару в этой категории. Если в описании есть конкретика (ингредиент, цифра, механика использования) — обязательно используй её как минимум в паре вариантов. Тексты должны звучать так, будто их написал человек, который реально пользовался именно этим товаром и понимает конкретно эту аудиторию, а не бездушный шаблон "уникальный товар для всей семьи".

СТИЛЬ (важно, соблюдай строго):
- Заголовки и хуки — короткие, трендовые, разговорные, как в реальных вирусных Reels/TikTok. Максимум 6-9 слов. Никакого канцелярита, никакого "Откройте для себя", никакого пафоса.
- Никаких вводных фраз вроде "Конечно, вот сценарий" — сразу суть.
- Сценарий пиши живым естественным языком, как реальный человек рассказывает, а не как маркетинговый бриф.
- Каждый вариант должен быть самостоятельным и разным по подходу, не повторяй одну и ту же идею другими словами.

ШАГ 1 — БОЛИ КЛИЕНТА:
Прежде чем писать что-либо ещё, сформулируй 3 конкретные боли/фрустрации именно ЭТОЙ аудитории, которые решает именно ЭТОТ товар (не абстрактные "хочет быть красивой", а конкретные ситуации: что именно раздражает, отнимает время, не получается, стыдно, страшно и т.д.). Все остальные блоки (хуки, до/после, сценарий) должны логически вырастать из этих болей, а не существовать отдельно.

ШАГ 2 — ПОЗИЦИОНИРОВАНИЕ ПО ТРАУТУ — вот приёмы:
${TROUT_TECHNIQUES}
Выбери 2-3 приёма, которые сильнее всего подходят именно этому товару и связаны с болями из шага 1.

Для каждого сформулируй позицию СТРОГО в формате "Товар/категория = одно ключевое качество" — коротко, как формула, а не описание. По одному владеемому качеству на позицию, без перечислений через запятую. Примеры нужного формата (не копируй буквально, это только чтобы показать формат):
- "Шампунь = коллаген и биотин" (владение через ингредиент)
- "Флюид = аналог люкса" (доступная альтернатива люксу)
- "Крем = решение акне за 14 дней" (владение результатом)
Формулировка должна быть готова к использованию как есть — как подпись под товаром или строка в рекламе, без воды и объяснений.

Ответь СТРОГО в виде одного JSON-объекта без каких-либо пояснений до или после, на ${lang} языке, со следующей структурой:

{
  "pain": ["конкретная боль/фрустрация аудитории 1, связанная именно с этим товаром", "боль 2", "боль 3"],
  "positioning": [
    {"technique": "название приёма из списка выше", "statement": "Товар/категория = одно ключевое качество, коротко, формулой"},
    {"technique": "...", "statement": "..."}
  ],
  "headlines": ["короткий трендовый заголовок 1 (до 9 слов, отталкивается от боли или позиции)", "заголовок 2", "заголовок 3"],
  "text_hooks": ["текстовый хук 1 — первая фраза видео, называет боль или цепляет за неё в первые 1-2 секунды", "хук 2", "хук 3"],
  "visual_hooks": ["визуальный хук 1 — что происходит в кадре в первые секунды, показывает боль или контраст", "визуальный хук 2", "визуальный хук 3"],
  "demonstration": ["идея демонстрации товара в действии 1, показывающая решение конкретной боли", "идея 2"],
  "before_after": [
    {"before": "конкретная ситуация до, привязанная к одной из болей", "after": "результат/трансформация после, коротко"},
    {"before": "...", "after": "..."}
  ],
  "cta": ["короткий призыв к действию 1 (прямой: купи/закажи сейчас)", "призыв 2 (мягкий/через выгоду)", "призыв 3 (через срочность/ограничение)"],
  "scenario_outline": "Короткий цельный сценарий 4-6 предложений живым языком, который естественно проходит через боль/хук → обозначение проблемы (до/после) → демонстрацию → призыв к действию — но без ярлыков-заголовков внутри текста, просто связный рассказ, с конкретными деталями именно этого товара."
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
      pain: [],
      positioning: [],
      headlines: [],
      text_hooks: [],
      visual_hooks: [],
      demonstration: [],
      before_after: [],
      cta: [],
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
  const positioning = Array.isArray(parsed.positioning)
    ? parsed.positioning
        .map((x) => {
          if (x && typeof x === "object") {
            return { technique: String(x.technique || ""), statement: String(x.statement || "") };
          }
          return null;
        })
        .filter((x) => x && x.statement)
    : [];
  return {
    pain: arr(parsed.pain),
    positioning,
    headlines: arr(parsed.headlines),
    text_hooks: arr(parsed.text_hooks),
    visual_hooks: arr(parsed.visual_hooks),
    demonstration: arr(parsed.demonstration),
    before_after: beforeAfter,
    cta: arr(parsed.cta),
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

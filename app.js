(() => {
  "use strict";

  const LS_KEY_API = "sb_openrouter_key";
  const LS_KEY_MODELS = "sb_models";

  const state = {
    blocks: [],
    defaultModels: [],
    allModels: null, // живой список с OpenRouter, подгружается лениво
    models: [], // [{id, label, enabled}]
    results: [], // raw response from /api/generate
    selections: {
      positioning: [],
      headlines: [],
      text_hooks: [],
      visual_hooks: [],
      demonstration: [],
      before_after: [],
      cta: [],
      scenario_outline: [],
    },
    projectId: null,
  };

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const uid = () =>
    (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `id_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  function loadModels() {
    const saved = localStorage.getItem(LS_KEY_MODELS);
    if (saved) {
      try {
        state.models = JSON.parse(saved);
        return;
      } catch (_) {}
    }
    state.models = state.defaultModels.map((m) => ({ id: m.id, label: m.label, enabled: true }));
  }
  function saveModels() {
    localStorage.setItem(LS_KEY_MODELS, JSON.stringify(state.models));
  }

  function renderModelList() {
    const box = $("#modelList");
    box.innerHTML = "";
    state.models.forEach((m, idx) => {
      const row = el("label", "model-item");
      const cb = el("input");
      cb.type = "checkbox";
      cb.checked = m.enabled;
      cb.addEventListener("change", () => {
        m.enabled = cb.checked;
        saveModels();
      });
      row.appendChild(cb);
      const nameWrap = el("span", null, m.label || m.id);
      row.appendChild(nameWrap);
      const code = el("code", null, m.id);
      row.appendChild(code);
      const rm = el("span", "remove", "убрать");
      rm.addEventListener("click", () => {
        state.models.splice(idx, 1);
        saveModels();
        renderModelList();
      });
      row.appendChild(rm);
      box.appendChild(row);
    });
  }

  function addModelToList(id, label) {
    if (state.models.some((m) => m.id === id)) return;
    state.models.push({ id, label: label || id, enabled: true });
    saveModels();
    renderModelList();
  }

  function addCustomModel() {
    const input = $("#customModelInput");
    const val = input.value.trim();
    if (!val) return;
    addModelToList(val, val);
    input.value = "";
  }

  // ---------- Живой поиск моделей на OpenRouter ----------
  async function ensureAllModelsLoaded() {
    if (state.allModels) return state.allModels;
    const box = $("#modelSearchResults");
    box.innerHTML = '<div class="msr-empty">Загружаем список моделей с OpenRouter…</div>';
    try {
      const res = await fetch("/api/models");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка загрузки списка моделей");
      state.allModels = json.models || [];
      box.innerHTML = '<div class="msr-empty">Начни печатать название модели выше.</div>';
    } catch (e) {
      state.allModels = [];
      box.innerHTML = `<div class="msr-empty">Не удалось загрузить список: ${e.message}</div>`;
    }
    return state.allModels;
  }

  function renderModelSearchResults(query) {
    const box = $("#modelSearchResults");
    const all = state.allModels || [];
    const q = query.trim().toLowerCase();
    if (!q) {
      box.innerHTML = '<div class="msr-empty">Начни печатать название модели выше.</div>';
      return;
    }
    const matches = all
      .filter((m) => m.id.toLowerCase().includes(q) || (m.name || "").toLowerCase().includes(q))
      .slice(0, 30);
    box.innerHTML = "";
    if (!matches.length) {
      box.appendChild(el("div", "msr-empty", "Ничего не найдено."));
      return;
    }
    matches.forEach((m) => {
      const row = el("div", "msr-row");
      const info = el("div", "msr-info");
      info.appendChild(el("span", "msr-name", m.name || m.id));
      info.appendChild(el("span", "msr-id", m.id));
      row.appendChild(info);
      const already = state.models.some((x) => x.id === m.id);
      const btn = el("button", "btn btn-secondary btn-small", already ? "Добавлено" : "Добавить");
      btn.disabled = already;
      btn.addEventListener("click", () => {
        addModelToList(m.id, m.name || m.id);
        renderModelSearchResults(query);
      });
      row.appendChild(btn);
      box.appendChild(row);
    });
  }

  let modelSearchDebounce = null;
  function initModelSearch() {
    const input = $("#modelSearchInput");
    input.addEventListener("focus", () => ensureAllModelsLoaded());
    input.addEventListener("input", () => {
      clearTimeout(modelSearchDebounce);
      modelSearchDebounce = setTimeout(async () => {
        await ensureAllModelsLoaded();
        renderModelSearchResults(input.value);
      }, 150);
    });
  }

  // ---------- Настройки / диалоги ----------
  function initDialogs() {
    $("#btnSettings").addEventListener("click", () => $("#settingsDialog").showModal());
    $("#btnProjects").addEventListener("click", async () => {
      await renderProjectsList();
      $("#projectsDialog").showModal();
    });
    $("#closeProjectsBtn").addEventListener("click", () => $("#projectsDialog").close());
    $("#addModelBtn").addEventListener("click", addCustomModel);
    $("#customModelInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); addCustomModel(); }
    });

    const apiKeyInput = $("#apiKeyInput");
    apiKeyInput.value = localStorage.getItem(LS_KEY_API) || "";
    apiKeyInput.addEventListener("input", () => {
      localStorage.setItem(LS_KEY_API, apiKeyInput.value.trim());
    });
  }

  async function renderProjectsList() {
    const box = $("#projectsList");
    box.innerHTML = "Загрузка…";
    const res = await fetch("/api/projects");
    const list = await res.json();
    box.innerHTML = "";
    if (!list.length) {
      box.textContent = "Пока нет сохранённых проектов.";
      return;
    }
    list.forEach((p) => {
      const row = el("div", "project-item");
      const left = el("div");
      left.appendChild(el("div", null, p.title));
      left.appendChild(el("div", "meta", new Date(p.updatedAt).toLocaleString("ru-RU")));
      row.appendChild(left);
      const actions = el("div", "actions");
      const openBtn = el("button", "btn btn-secondary btn-small", "Открыть");
      openBtn.addEventListener("click", () => { loadProject(p.id); $("#projectsDialog").close(); });
      const delBtn = el("button", "btn btn-ghost btn-small", "Удалить");
      delBtn.addEventListener("click", async () => {
        if (!confirm(`Удалить проект «${p.title}»?`)) return;
        await fetch(`/api/projects/${p.id}`, { method: "DELETE" });
        renderProjectsList();
      });
      actions.appendChild(openBtn);
      actions.appendChild(delBtn);
      row.appendChild(actions);
      box.appendChild(row);
    });
  }

  // ---------- Извлечение товара по ссылке ----------
  async function extractFromUrl() {
    const url = $("#productUrl").value.trim();
    const statusEl = $("#extractStatus");
    if (!url) {
      statusEl.textContent = "Вставь ссылку на карточку товара.";
      statusEl.style.color = "var(--danger)";
      return;
    }
    statusEl.textContent = "Загружаем страницу и достаём данные…";
    statusEl.style.color = "";
    $("#extractBtn").disabled = true;
    try {
      const res = await fetch("/api/extract-product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось извлечь данные");
      if (json.name) $("#productName").value = json.name;
      let desc = json.description || "";
      if (json.price) desc = `Цена: ${json.price}\n${desc}`;
      if (desc) $("#productDescription").value = desc;
      statusEl.textContent = "Готово — проверь и поправь поля ниже, если нужно.";
      statusEl.style.color = "#1a8a4a";
    } catch (e) {
      statusEl.textContent = "Не получилось: " + e.message + ". Заполни поля вручную.";
      statusEl.style.color = "var(--danger)";
    } finally {
      $("#extractBtn").disabled = false;
    }
  }

  // ---------- Генерация ----------
  function getProductFromForm() {
    return {
      name: $("#productName").value.trim(),
      description: $("#productDescription").value.trim(),
      audience: $("#productAudience").value.trim(),
      category: $("#productCategory").value.trim(),
      language: $("#productLanguage").value,
    };
  }

  function setStatus(id, text, type) {
    const node = $(id);
    node.textContent = text || "";
    node.className = "status-line" + (type ? " " + type : "");
  }

  async function generate() {
    const apiKey = localStorage.getItem(LS_KEY_API);
    const product = getProductFromForm();

    if (!product.name) {
      setStatus("#generateStatus", "Укажи название товара.", "error");
      return;
    }
    if (!apiKey) {
      setStatus("#generateStatus", "Сначала добавь OpenRouter API-ключ в настройках.", "error");
      $("#settingsDialog").showModal();
      return;
    }
    const enabledModels = state.models.filter((m) => m.enabled).map((m) => m.id);
    if (!enabledModels.length) {
      setStatus("#generateStatus", "Выбери хотя бы одну модель в настройках.", "error");
      return;
    }

    $("#generateBtn").disabled = true;
    setStatus("#generateStatus", `Генерируем варианты (${enabledModels.length} моделей)… это может занять до минуты.`);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-openrouter-key": apiKey },
        body: JSON.stringify({ product, models: enabledModels }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка генерации");
      state.results = json.results;
      renderResults();
      setStatus("#generateStatus", "Готово. Смотри варианты ниже.", "success");
      $("#resultsSection").classList.remove("hidden");
      $("#finalSection").classList.remove("hidden");
      $("#resultsSection").scrollIntoView({ behavior: "smooth" });
    } catch (e) {
      setStatus("#generateStatus", "Ошибка: " + e.message, "error");
    } finally {
      $("#generateBtn").disabled = false;
    }
  }

  function modelLabelFor(modelId) {
    const found = state.models.find((m) => m.id === modelId);
    return found ? (found.label || found.id) : modelId;
  }

  function addSelection(blockKey, entry) {
    state.selections[blockKey].push({ id: uid(), ...entry });
    renderFinal();
  }

  function renderResults() {
    const box = $("#resultsBlocks");
    box.innerHTML = "";

    // positioning — рендерим первым, отдельно (пары технique+statement)
    {
      const meta = state.blocks.find((b) => b.key === "positioning");
      const section = el("div", "result-block");
      section.appendChild(el("h3", null, meta ? meta.label : "Позиционирование"));
      const cols = el("div", "model-columns");
      state.results.forEach((r) => {
        const col = el("div", "model-col");
        col.appendChild(el("div", "model-name", modelLabelFor(r.model)));
        if (!r.ok) {
          col.appendChild(el("div", "model-error", r.error || "Ошибка"));
        } else {
          const items = r.data.positioning || [];
          if (!items.length) col.appendChild(el("div", "model-error", "Пусто"));
          items.forEach((p) => {
            const row = el("div", "item-row");
            const txt = el("div", "item-text ba-pair");
            txt.innerHTML = `<b>${escapeHtml(p.technique)}:</b> ${escapeHtml(p.statement)}`;
            row.appendChild(txt);
            const btn = el("button", "add-btn", "+ Добавить");
            btn.addEventListener("click", () =>
              addSelection("positioning", { model: r.model, technique: p.technique, statement: p.statement })
            );
            row.appendChild(btn);
            col.appendChild(row);
          });
        }
        cols.appendChild(col);
      });
      section.appendChild(cols);
      box.appendChild(section);
    }

    const arrayBlocks = ["headlines", "text_hooks", "visual_hooks", "demonstration", "cta"];

    arrayBlocks.forEach((blockKey) => {
      const meta = state.blocks.find((b) => b.key === blockKey);
      const section = el("div", "result-block");
      section.appendChild(el("h3", null, meta ? meta.label : blockKey));
      const cols = el("div", "model-columns");
      state.results.forEach((r) => {
        const col = el("div", "model-col");
        col.appendChild(el("div", "model-name", modelLabelFor(r.model)));
        if (!r.ok) {
          col.appendChild(el("div", "model-error", r.error || "Ошибка"));
        } else {
          const items = r.data[blockKey] || [];
          if (!items.length) col.appendChild(el("div", "model-error", "Пусто"));
          items.forEach((text) => {
            const row = el("div", "item-row");
            row.appendChild(el("div", "item-text", text));
            const btn = el("button", "add-btn", "+ Добавить");
            btn.addEventListener("click", () => addSelection(blockKey, { model: r.model, text }));
            row.appendChild(btn);
            col.appendChild(row);
          });
        }
        cols.appendChild(col);
      });
      section.appendChild(cols);
      box.appendChild(section);
    });

    // before_after
    {
      const meta = state.blocks.find((b) => b.key === "before_after");
      const section = el("div", "result-block");
      section.appendChild(el("h3", null, meta ? meta.label : "До / После"));
      const cols = el("div", "model-columns");
      state.results.forEach((r) => {
        const col = el("div", "model-col");
        col.appendChild(el("div", "model-name", modelLabelFor(r.model)));
        if (!r.ok) {
          col.appendChild(el("div", "model-error", r.error || "Ошибка"));
        } else {
          const items = r.data.before_after || [];
          if (!items.length) col.appendChild(el("div", "model-error", "Пусто"));
          items.forEach((pair) => {
            const row = el("div", "item-row");
            const txt = el("div", "item-text ba-pair");
            txt.innerHTML = `<b>До:</b> ${escapeHtml(pair.before)}<br><b>После:</b> ${escapeHtml(pair.after)}`;
            row.appendChild(txt);
            const btn = el("button", "add-btn", "+ Добавить");
            btn.addEventListener("click", () =>
              addSelection("before_after", { model: r.model, before: pair.before, after: pair.after })
            );
            row.appendChild(btn);
            col.appendChild(row);
          });
        }
        cols.appendChild(col);
      });
      section.appendChild(cols);
      box.appendChild(section);
    }

    // scenario_outline
    {
      const meta = state.blocks.find((b) => b.key === "scenario_outline");
      const section = el("div", "result-block");
      section.appendChild(el("h3", null, meta ? meta.label : "Общий сценарий"));
      const cols = el("div", "model-columns");
      state.results.forEach((r) => {
        const col = el("div", "model-col");
        col.appendChild(el("div", "model-name", modelLabelFor(r.model)));
        if (!r.ok) {
          col.appendChild(el("div", "model-error", r.error || "Ошибка"));
        } else {
          const text = r.data.scenario_outline || "";
          const row = el("div", "item-row");
          row.appendChild(el("div", "item-text", text || "Пусто"));
          if (text) {
            const btn = el("button", "add-btn", "+ Добавить");
            btn.addEventListener("click", () => addSelection("scenario_outline", { model: r.model, text }));
            row.appendChild(btn);
          }
          col.appendChild(row);
        }
        cols.appendChild(col);
      });
      section.appendChild(cols);
      box.appendChild(section);
    }
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ---------- Итоговый сценарий ----------
  function removeSelection(blockKey, id) {
    state.selections[blockKey] = state.selections[blockKey].filter((x) => x.id !== id);
    renderFinal();
  }

  function renderFinal() {
    const box = $("#finalBlocks");
    box.innerHTML = "";

    state.blocks.forEach((meta) => {
      const items = state.selections[meta.key];
      const wrap = el("div", "final-block");
      wrap.appendChild(el("h4", null, `${meta.label} (${items.length})`));
      if (!items.length) {
        wrap.appendChild(el("div", "hint", "Пока ничего не выбрано."));
      }
      items.forEach((item) => {
        const row = el("div", "final-item");
        const ta = el("textarea");
        const isPair = meta.key === "before_after" || meta.key === "positioning";
        ta.rows = isPair ? 2 : 1;
        if (meta.key === "before_after") {
          ta.value = `До: ${item.before}\nПосле: ${item.after}`;
        } else if (meta.key === "positioning") {
          ta.value = `${item.technique}: ${item.statement}`;
        } else {
          ta.value = item.text;
        }
        ta.addEventListener("input", () => {
          if (meta.key === "before_after") {
            const lines = ta.value.split("\n");
            item.before = (lines[0] || "").replace(/^До:\s*/i, "");
            item.after = (lines[1] || "").replace(/^После:\s*/i, "");
          } else if (meta.key === "positioning") {
            const idx = ta.value.indexOf(":");
            if (idx === -1) {
              item.statement = ta.value;
            } else {
              item.technique = ta.value.slice(0, idx).trim();
              item.statement = ta.value.slice(idx + 1).trim();
            }
          } else {
            item.text = ta.value;
          }
        });
        row.appendChild(ta);
        const rm = el("button", "remove-btn", "✕");
        rm.addEventListener("click", () => removeSelection(meta.key, item.id));
        row.appendChild(rm);
        wrap.appendChild(row);
      });
      box.appendChild(wrap);
    });

    if (!$("#buildFinalTextBtn")) {
      const btn = el("button", "btn btn-secondary", "Собрать текст из выбранного ⬇");
      btn.id = "buildFinalTextBtn";
      btn.style.marginBottom = "12px";
      btn.addEventListener("click", buildFinalText);
      box.parentNode.insertBefore(btn, $("#finalText"));
    }
  }

  function buildFinalText() {
    const p = getProductFromForm();
    const lines = [];
    lines.push(`СЦЕНАРИЙ: ${p.name || "(без названия)"}`);
    if (p.description) lines.push(p.description);
    lines.push("");
    state.blocks.forEach((meta) => {
      const items = state.selections[meta.key];
      if (!items.length) return;
      lines.push(`== ${meta.label.toUpperCase()} ==`);
      items.forEach((item, i) => {
        if (meta.key === "before_after") {
          lines.push(`${i + 1}. До: ${item.before}\n   После: ${item.after}`);
        } else if (meta.key === "positioning") {
          lines.push(`${i + 1}. [${item.technique}] ${item.statement}`);
        } else {
          lines.push(`${i + 1}. ${item.text}`);
        }
      });
      lines.push("");
    });
    $("#finalText").value = lines.join("\n").trim();
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ---------- Сохранение / загрузка проекта ----------
  async function saveProject() {
    const title = $("#projectTitle").value.trim() || getProductFromForm().name || "Без названия";
    const payload = {
      title,
      product: getProductFromForm(),
      models: state.models.filter((m) => m.enabled).map((m) => m.id),
      results: state.results,
      selections: state.selections,
      finalText: $("#finalText").value,
    };
    setStatus("#saveStatus", "Сохраняем…");
    try {
      let saved;
      if (state.projectId) {
        const res = await fetch(`/api/projects/${state.projectId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        saved = await res.json();
      } else {
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        saved = await res.json();
      }
      state.projectId = saved.id;
      history.replaceState(null, "", `?id=${saved.id}`);
      setStatus("#saveStatus", "Проект сохранён.", "success");
    } catch (e) {
      setStatus("#saveStatus", "Ошибка сохранения: " + e.message, "error");
    }
  }

  async function loadProject(id) {
    const res = await fetch(`/api/projects/${id}`);
    if (!res.ok) return;
    const p = await res.json();
    state.projectId = p.id;
    history.replaceState(null, "", `?id=${p.id}`);

    $("#productName").value = p.product?.name || "";
    $("#productDescription").value = p.product?.description || "";
    $("#productAudience").value = p.product?.audience || "";
    $("#productCategory").value = p.product?.category || "";
    $("#productLanguage").value = p.product?.language || "ru";
    $("#projectTitle").value = p.title || "";

    state.results = p.results || [];
    state.selections = Object.assign(
      {
        positioning: [],
        headlines: [],
        text_hooks: [],
        visual_hooks: [],
        demonstration: [],
        before_after: [],
        cta: [],
        scenario_outline: [],
      },
      p.selections || {}
    );
    $("#finalText").value = p.finalText || "";

    if (state.results.length) {
      renderResults();
      $("#resultsSection").classList.remove("hidden");
    }
    $("#finalSection").classList.remove("hidden");
    renderFinal();
  }

  // ---------- Инициализация ----------
  async function init() {
    const cfg = await (await fetch("/api/config")).json();
    state.blocks = cfg.blocks;
    state.defaultModels = cfg.defaultModels;
    loadModels();
    renderModelList();
    initDialogs();
    initModelSearch();

    $("#generateBtn").addEventListener("click", generate);
    $("#extractBtn").addEventListener("click", extractFromUrl);
    $("#saveProjectBtn").addEventListener("click", saveProject);
    $("#downloadTxtBtn").addEventListener("click", () =>
      download(`${($("#projectTitle").value || "scenario").trim()}.txt`, $("#finalText").value)
    );
    $("#downloadMdBtn").addEventListener("click", () =>
      download(`${($("#projectTitle").value || "scenario").trim()}.md`, $("#finalText").value)
    );

    const params = new URLSearchParams(location.search);
    const id = params.get("id");
    if (id) loadProject(id);
  }

  document.addEventListener("DOMContentLoaded", init);
})();

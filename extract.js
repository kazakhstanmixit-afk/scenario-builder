// Достаём название/описание/цену товара со страницы по ссылке (Kaspi, Wildberries,
// Ozon, обычные интернет-магазины и т.д.) — без headless-браузера, просто разбираем
// HTML: og:-теги, meta description и JSON-LD (schema.org/Product), которые почти
// всегда есть на карточках товаров даже если сам сайт — SPA на JS.

const FETCH_TIMEOUT_MS = 12000;

function matchAttr(html, patterns) {
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return decodeEntities(m[1].trim());
  }
  return "";
}

function decodeEntities(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function extractMeta(html, prop) {
  // поддерживаем оба порядка атрибутов: content до/после property|name
  return matchAttr(html, [
    new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, "i"),
  ]);
}

function extractJsonLdProduct(html) {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const s of scripts) {
    try {
      let data = JSON.parse(s[1].trim());
      const items = Array.isArray(data) ? data : data["@graph"] || [data];
      for (const item of items) {
        const type = item["@type"];
        const isProduct = type === "Product" || (Array.isArray(type) && type.includes("Product"));
        if (isProduct) {
          let price = null;
          const offers = item.offers;
          if (offers) {
            const offer = Array.isArray(offers) ? offers[0] : offers;
            price = offer?.price || offer?.lowPrice || null;
          }
          return {
            name: item.name || "",
            description: item.description || "",
            price: price ? String(price) : "",
            image: Array.isArray(item.image) ? item.image[0] : item.image || "",
            brand: (item.brand && (item.brand.name || item.brand)) || "",
          };
        }
      }
    } catch (_) {
      // не JSON или не тот формат — пропускаем
    }
  }
  return null;
}

async function fetchProductFromUrl(url) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (_) {
    throw new Error("Некорректная ссылка");
  }
  if (!/^https?:$/.test(parsedUrl.protocol)) {
    throw new Error("Ссылка должна начинаться с http(s)");
  }

  const browserHeaders = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    Referer: `${parsedUrl.protocol}//${parsedUrl.host}/`,
  };

  async function doFetch(attempt) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const resp = await fetch(parsedUrl.toString(), { signal: controller.signal, headers: browserHeaders });
      if (resp.status === 429 && attempt === 0) {
        // Похоже на защиту от частых запросов — ждём и пробуем один раз ещё
        await new Promise((r) => setTimeout(r, 2500));
        return doFetch(1);
      }
      if (!resp.ok) {
        if (resp.status === 429 || resp.status === 403) {
          throw new Error(
            `Сайт заблокировал автоматический запрос (${resp.status}) — у него защита от ботов. Такое часто встречается у крупных маркетплейсов (Kaspi, Wildberries). Заполни поля вручную.`
          );
        }
        throw new Error(`Сайт вернул ошибку ${resp.status}`);
      }
      return resp.text();
    } catch (e) {
      if (e.name === "AbortError") throw new Error("Сайт не ответил вовремя (таймаут)");
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  }

  const html = await doFetch(0);

  const jsonLd = extractJsonLdProduct(html);

  const ogTitle = extractMeta(html, "og:title");
  const ogDescription = extractMeta(html, "og:description");
  const metaDescription = extractMeta(html, "description");
  const ogImage = extractMeta(html, "og:image");
  const titleTag = matchAttr(html, [/<title>([^<]*)<\/title>/i]);

  const name = (jsonLd && jsonLd.name) || ogTitle || titleTag || "";
  const description = (jsonLd && jsonLd.description) || ogDescription || metaDescription || "";
  const image = (jsonLd && jsonLd.image) || ogImage || "";
  const price = jsonLd && jsonLd.price ? jsonLd.price : "";

  if (!name && !description) {
    throw new Error("Не удалось найти информацию о товаре на странице (сайт мог заблокировать запрос или отдаёт контент только через JS)");
  }

  return {
    name: name.slice(0, 200),
    description: description.slice(0, 1000),
    price,
    image,
    source: parsedUrl.toString(),
  };
}

module.exports = { fetchProductFromUrl };

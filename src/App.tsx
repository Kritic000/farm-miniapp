import React, { useEffect, useMemo, useState } from "react";
import { API_URL } from "./config";

type Product = {
  id: string;
  category: string;
  name: string;
  unit: string;
  price: number;
  sort: number;
  description?: string;
  image?: string;
};

type CartItem = {
  product: Product;
  qty: number;
};

type TgUser = {
  id?: number;
  username?: string;
  first_name?: string;
  last_name?: string;
};

function getTgUser(): TgUser | null {
  const w = window as any;
  const tg = w?.Telegram?.WebApp;
  const u = tg?.initDataUnsafe?.user;
  return u || null;
}

function money(n: number) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(n));
}

type Toast = { type: "error" | "success" | "info"; text: string } | null;

const PRODUCTS_CACHE_KEY = "farm_products_cache_v1";
const PRODUCTS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 минут

const DELIVERY_FEE = 200;
const FREE_DELIVERY_FROM = 2000;

function loadProductsCache(): { ts: number; products: Product[] } | null {
  try {
    const raw = localStorage.getItem(PRODUCTS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.ts || !Array.isArray(parsed?.products)) return null;
    return { ts: parsed.ts, products: parsed.products };
  } catch {
    return null;
  }
}

function saveProductsCache(products: Product[]) {
  try {
    localStorage.setItem(PRODUCTS_CACHE_KEY, JSON.stringify({ ts: Date.now(), products }));
  } catch {}
}

function normalizeImagePath(img?: string): string | undefined {
  const s = String(img || "").trim();
  if (!s) return undefined;
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  if (s.startsWith("/")) return s;
  if (s.startsWith("public/")) return "/" + s.replace(/^public\//, "");
  return "/" + s;
}

// fetch с таймаутом (чтобы не висло, если Apps Script долго отвечает)
async function fetchWithTimeout(input: RequestInfo, init: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs = 8000, ...rest } = init;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(input, { ...rest, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

export default function App() {
  const API_TOKEN = "Kjhytccb18@";

  const [loading, setLoading] = useState(true);
  const [loadingHint, setLoadingHint] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [toast, setToast] = useState<Toast>(null);

  const [products, setProducts] = useState<Product[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("Все");
  const [tab, setTab] = useState<"catalog" | "cart" | "checkout">("catalog");

  const [cart, setCart] = useState<Record<string, CartItem>>({});

  const [address, setAddress] = useState("");
  const [comment, setComment] = useState("");

  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");

  const [sending, setSending] = useState(false);

  // --- адаптация под Desktop vs Mobile ---
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    // Telegram Desktop обычно шире + hover устройство
    return window.innerWidth >= 520;
  });

  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= 520);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Telegram init
  useEffect(() => {
    const w = window as any;
    const tg = w?.Telegram?.WebApp;
    if (tg) {
      try {
        tg.ready();
        tg.expand();
      } catch {}
    }
  }, []);

  // Автозакрытие toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // Быстрая загрузка: кэш + сеть
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError("");
        setLoadingHint("");

        // 1) кэш
        const cached = loadProductsCache();
        if (cached && Date.now() - cached.ts < PRODUCTS_CACHE_TTL_MS) {
          setProducts(cached.products);
          setLoading(false);
          setLoadingHint("Обновляем ассортимент…");
        }

        // 2) сеть (с таймаутом)
        const url = `${API_URL}?action=products&ts=${Date.now()}`;
        const res = await fetchWithTimeout(url, { method: "GET", timeoutMs: 8000 });
        const data = await res.json();

        if (data?.error) throw new Error(data.error);

        const list: Product[] = (data.products || []).map((p: Product) => ({
          ...p,
          image: normalizeImagePath(p.image),
        }));

        if (cancelled) return;

        setProducts(list);
        saveProductsCache(list);

        setLoading(false);
        setLoadingHint("");
      } catch (e: any) {
        if (cancelled) return;
        const msg = e?.name === "AbortError" ? "Сервер долго отвечает. Попробуйте ещё раз." : (e?.message || "Ошибка загрузки товаров");
        setError(msg);
        setLoading(false);
        setLoadingHint("");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => set.add(p.category));
    return ["Все", ...Array.from(set)];
  }, [products]);

  const filteredProducts = useMemo(() => {
    if (activeCategory === "Все") return products;
    return products.filter((p) => p.category === activeCategory);
  }, [products, activeCategory]);

  const cartItems = useMemo(() => Object.values(cart), [cart]);

  const cartCount = useMemo(() => cartItems.reduce((s, it) => s + it.qty, 0), [cartItems]);

  const total = useMemo(() => cartItems.reduce((s, it) => s + it.qty * it.product.price, 0), [cartItems]);

  // доставка: 200 ₽ если сумма товаров > 0 и < 2000
  const delivery = useMemo(() => {
    if (total <= 0) return 0;
    return total < FREE_DELIVERY_FROM ? DELIVERY_FEE : 0;
  }, [total]);

  const grandTotal = useMemo(() => total + delivery, [total, delivery]);

  function addToCart(p: Product) {
    setCart((prev) => {
      const next = { ...prev };
      const cur = next[p.id];
      next[p.id] = { product: p, qty: (cur?.qty || 0) + 1 };
      return next;
    });
    setToast({ type: "info", text: "Добавлено в корзину" });
  }

  function setQty(productId: string, qty: number) {
    setCart((prev) => {
      const next = { ...prev };
      if (qty <= 0) delete next[productId];
      else next[productId] = { ...next[productId], qty };
      return next;
    });
  }

  function qtyOf(productId: string) {
    return cart[productId]?.qty || 0;
  }

  function validateCheckout(): string | null {
    if (customerName.trim().length < 2) return "Укажи имя (минимум 2 символа).";
    if (phone.trim().length < 6) return "Укажи телефон (минимум 6 символов).";
    if (address.trim().length < 5) return "Укажи адрес доставки (минимум 5 символов).";
    if (cartItems.length === 0) return "Корзина пустая.";
    return null;
  }

  async function submitOrder() {
    const validationError = validateCheckout();
    if (validationError) {
      setToast({ type: "error", text: validationError });
      return;
    }

    const tg = getTgUser();

    const payload = {
      token: API_TOKEN,
      tg: tg || {},
      name: customerName.trim(),
      phone: phone.trim(),
      address: address.trim(),
      comment: comment.trim(),
      items: cartItems.map((it) => ({
        id: it.product.id,
        name: it.product.name,
        unit: it.product.unit,
        price: it.product.price,
        qty: it.qty,
        sum: it.qty * it.product.price,
      })),
      total,       // сумма товаров
      delivery,    // доставка
      grandTotal,  // итого с доставкой
    };

    try {
      setSending(true);

      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      if (data?.error) throw new Error(data.error);

      setToast({ type: "success", text: "✅ Заказ отправлен! Мы свяжемся для подтверждения." });

      setCart({});
      setAddress("");
      setComment("");
      setCustomerName("");
      setPhone("");
      setTab("catalog");
    } catch (e: any) {
      setToast({ type: "error", text: `Не удалось отправить заказ: ${e?.message || "Ошибка"}` });
    } finally {
      setSending(false);
    }
  }

  // ---- стили: на Desktop отключаем blur/стекло, чтобы не было “странно” ----
  const S = useMemo(() => createStyles(isDesktop), [isDesktop]);

  return (
    <div style={S.page}>
      {toast && (
        <div
          style={{
            ...S.toast,
            ...(toast.type === "error" ? S.toastError : {}),
            ...(toast.type === "success" ? S.toastSuccess : {}),
            ...(toast.type === "info" ? S.toastInfo : {}),
          }}
        >
          <div style={{ fontWeight: 900 }}>{toast.text}</div>
          <button style={S.toastClose} onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      )}

      <div style={S.container}>
        <div style={S.header}>
          <div style={S.title}>Каталог</div>

          <div style={S.tabs}>
            <button
              style={{ ...S.tabBtn, ...(tab === "catalog" ? S.tabActive : {}) }}
              onClick={() => setTab("catalog")}
            >
              Товары
            </button>

            <button
              style={{ ...S.tabBtn, ...(tab === "cart" || tab === "checkout" ? S.tabActive : {}) }}
              onClick={() => setTab("cart")}
            >
              🛒 Корзина ({cartCount})
            </button>
          </div>
        </div>

        {loading && <div style={S.info}>Загрузка ассортимента…</div>}
        {!loading && loadingHint && <div style={S.infoMuted}>{loadingHint}</div>}
        {error && <div style={{ ...S.info, color: "#b00020" }}>{error}</div>}

        {!loading && !error && (
          <>
            {tab === "catalog" && (
              <>
                <div style={S.chipsRow}>
                  {categories.map((c) => (
                    <button
                      key={c}
                      style={{ ...S.chip, ...(activeCategory === c ? S.chipActive : {}) }}
                      onClick={() => setActiveCategory(c)}
                    >
                      {c}
                    </button>
                  ))}
                </div>

                <div style={S.list}>
                  {filteredProducts.map((p) => {
                    const q = qtyOf(p.id);

                    return (
                      <div key={p.id} style={S.card}>
                        {p.image ? (
                          <img
                            src={p.image}
                            alt={p.name}
                            style={S.cardImg}
                            loading="lazy"
                            decoding="async"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = "none";
                            }}
                          />
                        ) : (
                          <div style={S.cardImgPlaceholder}>Нет фото</div>
                        )}

                        <div style={S.cardBody}>
                          <div style={S.cardName}>{p.name}</div>
                          {p.description ? <div style={S.cardDesc}>{p.description}</div> : null}

                          <div style={S.cardMeta}>
                            {money(p.price)} ₽ / {p.unit}
                          </div>

                          {q === 0 ? (
                            <button style={S.buyBtn} onClick={() => addToCart(p)}>
                              В корзину
                            </button>
                          ) : (
                            <div style={S.qtyInline}>
                              <button style={S.qtyBtn} onClick={() => setQty(p.id, q - 1)}>
                                −
                              </button>
                              <div style={S.qtyNum}>{q}</div>
                              <button style={S.qtyBtn} onClick={() => setQty(p.id, q + 1)}>
                                +
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {tab === "cart" && (
              <div style={S.panel}>
                {cartItems.length === 0 ? (
                  <div style={S.info}>Корзина пустая</div>
                ) : (
                  <>
                    {cartItems.map((it) => (
                      <div key={it.product.id} style={S.cartRow}>
                        <div style={{ flex: 1 }}>
                          <div style={S.cartName}>{it.product.name}</div>
                          <div style={S.cartMeta}>
                            {money(it.product.price)} ₽ / {it.product.unit}
                          </div>
                        </div>

                        <div style={S.qtyBox}>
                          <button style={S.qtyBtn} onClick={() => setQty(it.product.id, it.qty - 1)}>
                            −
                          </button>
                          <div style={S.qtyNum}>{it.qty}</div>
                          <button style={S.qtyBtn} onClick={() => setQty(it.product.id, it.qty + 1)}>
                            +
                          </button>
                        </div>

                        <div style={S.cartSum}>{money(it.qty * it.product.price)} ₽</div>

                        <button style={S.removeBtn} onClick={() => setQty(it.product.id, 0)}>
                          ✕
                        </button>
                      </div>
                    ))}

                    <div style={S.totalBlock}>
                      <div style={S.totalRow}>
                        <div>Товары</div>
                        <div style={{ fontWeight: 900 }}>{money(total)} ₽</div>
                      </div>

                      <div style={S.totalRow}>
                        <div>
                          Доставка{" "}
                          {delivery === 0 ? (
                            <span style={S.freeTag}>бесплатно</span>
                          ) : (
                            <span style={S.mutedTag}>до {money(FREE_DELIVERY_FROM)} ₽</span>
                          )}
                        </div>
                        <div style={{ fontWeight: 900 }}>{money(delivery)} ₽</div>
                      </div>

                      <div style={S.totalRowBig}>
                        <div>Итого</div>
                        <div style={{ fontWeight: 950 }}>{money(grandTotal)} ₽</div>
                      </div>
                    </div>

                    <button style={S.primaryBtn} onClick={() => setTab("checkout")}>
                      Оформить
                    </button>
                  </>
                )}
              </div>
            )}

            {tab === "checkout" && (
              <div style={S.panel}>
                <div style={S.h2}>Оформление</div>

                <label style={S.label}>
                  Имя <span style={{ color: "#b00020" }}>*</span>
                </label>
                <input
                  style={S.input}
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Как к вам обращаться?"
                  autoComplete="name"
                />

                <label style={S.label}>
                  Телефон <span style={{ color: "#b00020" }}>*</span>
                </label>
                <input
                  style={S.input}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+7..."
                  autoComplete="tel"
                  inputMode="tel"
                />

                <label style={S.label}>
                  Адрес доставки <span style={{ color: "#b00020" }}>*</span>
                </label>
                <input
                  style={S.input}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="улица, дом, подъезд, этаж, кв."
                  autoComplete="street-address"
                />

                <label style={S.label}>Комментарий (необязательно)</label>
                <input
                  style={S.input}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="код домофона, удобное время"
                />

                <div style={S.totalBlock}>
                  <div style={S.totalRow}>
                    <div>Товары</div>
                    <div style={{ fontWeight: 900 }}>{money(total)} ₽</div>
                  </div>

                  <div style={S.totalRow}>
                    <div>
                      Доставка{" "}
                      {delivery === 0 ? (
                        <span style={S.freeTag}>бесплатно</span>
                      ) : (
                        <span style={S.mutedTag}>до {money(FREE_DELIVERY_FROM)} ₽</span>
                      )}
                    </div>
                    <div style={{ fontWeight: 900 }}>{money(delivery)} ₽</div>
                  </div>

                  <div style={S.totalRowBig}>
                    <div>Итого</div>
                    <div style={{ fontWeight: 950 }}>{money(grandTotal)} ₽</div>
                  </div>
                </div>

                <button
                  style={{
                    ...S.primaryBtn,
                    opacity: sending ? 0.7 : 1,
                    cursor: sending ? "not-allowed" : "pointer",
                  }}
                  onClick={submitOrder}
                  disabled={sending}
                >
                  {sending ? "Отправляем..." : "Подтвердить заказ"}
                </button>

                <button style={S.secondaryBtn} onClick={() => setTab("cart")} disabled={sending}>
                  Назад в корзину
                </button>

                <div style={S.note}>Оплата пока не принимается в приложении — мы свяжемся после оформления.</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function createStyles(isDesktop: boolean): Record<string, React.CSSProperties> {
  // На Desktop выключаем blur/backdropFilter (там часто “ломает” вид)
  const glassBg = isDesktop ? "#ffffff" : "rgba(255,255,255,0.78)";
  const glassBgStrong = isDesktop ? "#ffffff" : "rgba(255,255,255,0.92)";
  const glassBorder = isDesktop ? "rgba(0,0,0,0.10)" : "rgba(0,0,0,0.08)";
  const blur: React.CSSProperties = isDesktop
    ? {}
    : { backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" };

  return {
    page: {
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
      padding: 14,
      background:
        "radial-gradient(1200px 600px at 20% 0%, rgba(47,188,47,0.12) 0%, rgba(242,243,245,1) 45%)",
      minHeight: "100vh",
    },

    // контейнер чтобы на Desktop не было “огромных” блоков
    container: {
      maxWidth: 520,
      margin: "0 auto",
    },

    toast: {
      position: "sticky",
      top: 8,
      zIndex: 9999,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      padding: "12px 12px",
      borderRadius: 14,
      boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
      marginBottom: 10,
      border: `1px solid ${glassBorder}`,
      background: glassBgStrong,
      ...blur,
    },
    toastError: { background: "rgba(255,232,234,0.92)", color: "#7a0010" },
    toastSuccess: { background: "rgba(231,246,234,0.92)", color: "#0e4b1b" },
    toastInfo: { background: "rgba(238,242,255,0.92)", color: "#1c2b6b" },
    toastClose: {
      border: 0,
      background: "transparent",
      fontSize: 22,
      lineHeight: 1,
      cursor: "pointer",
      padding: 4,
    },

    header: {
      position: "sticky",
      top: 0,
      zIndex: 50,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      marginBottom: 12,
      padding: "10px 0",
      background: isDesktop
        ? "linear-gradient(180deg, rgba(242,243,245,0.98) 0%, rgba(242,243,245,0.92) 100%)"
        : "linear-gradient(180deg, rgba(242,243,245,0.92) 0%, rgba(242,243,245,0.55) 100%)",
      ...(!isDesktop ? { backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" } : {}),
    },

    title: { fontSize: 32, fontWeight: 900, letterSpacing: -0.6 },

    tabs: { display: "flex", gap: 8 },

    tabBtn: {
      border: `1px solid ${glassBorder}`,
      background: glassBg,
      padding: "10px 14px",
      borderRadius: 999,
      fontWeight: 900,
      cursor: "pointer",
      boxShadow: "0 6px 16px rgba(0,0,0,0.08)",
      ...blur,
    },
    tabActive: {
      borderColor: "rgba(31,122,31,0.25)",
      background: "linear-gradient(180deg, rgba(47,188,47,0.95) 0%, rgba(31,122,31,0.98) 100%)",
      color: "#fff",
      boxShadow: "0 10px 22px rgba(31,122,31,0.25)",
    },

    chipsRow: {
      display: "flex",
      gap: 8,
      overflowX: "auto",
      paddingBottom: 10,
      marginBottom: 10,
    },

    chip: {
      border: `1px solid ${glassBorder}`,
      background: glassBg,
      padding: "9px 12px",
      borderRadius: 999,
      fontWeight: 900,
      cursor: "pointer",
      whiteSpace: "nowrap",
      boxShadow: "0 6px 14px rgba(0,0,0,0.06)",
      ...blur,
    },
    chipActive: {
      background: "linear-gradient(180deg, rgba(47,188,47,0.95) 0%, rgba(31,122,31,0.98) 100%)",
      color: "#fff",
      borderColor: "rgba(31,122,31,0.25)",
      boxShadow: "0 10px 22px rgba(31,122,31,0.22)",
    },

    info: { padding: 12, fontWeight: 800 },
    infoMuted: { padding: 8, color: "#555" },

    list: { display: "grid", gap: 12 },

    card: {
      background: glassBgStrong,
      borderRadius: 18,
      overflow: "hidden",
      boxShadow: "0 12px 26px rgba(0,0,0,0.08)",
      border: `1px solid ${glassBorder}`,
      display: "grid",
      gridTemplateColumns: "120px 1fr",
    },
    cardImg: { width: 120, height: 120, objectFit: "cover", display: "block" },
    cardImgPlaceholder: {
      width: 120,
      height: 120,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "linear-gradient(180deg, rgba(233,234,236,1) 0%, rgba(225,226,228,1) 100%)",
      color: "#666",
      fontWeight: 800,
    },

    cardBody: { padding: 12, display: "flex", flexDirection: "column", gap: 8 },
    cardName: { fontSize: 18, fontWeight: 900, lineHeight: 1.15 },
    cardDesc: { fontSize: 13, color: "#333", lineHeight: 1.25 },
    cardMeta: { color: "#222", fontWeight: 900 },

    buyBtn: {
      marginTop: 6,
      background: "linear-gradient(180deg, #2fbc2f 0%, #1f7a1f 100%)",
      color: "#fff",
      border: "1px solid rgba(255,255,255,0.25)",
      borderRadius: 14,
      padding: "10px 14px",
      fontWeight: 900,
      cursor: "pointer",
      width: "fit-content",
      boxShadow: "0 10px 22px rgba(31,122,31,0.22)",
    },

    qtyInline: { display: "flex", alignItems: "center", gap: 8, marginTop: 6 },

    panel: {
      background: glassBgStrong,
      borderRadius: 18,
      padding: 14,
      boxShadow: "0 12px 26px rgba(0,0,0,0.08)",
      border: `1px solid ${glassBorder}`,
    },

    cartRow: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "10px 0",
      borderBottom: "1px solid rgba(0,0,0,0.06)",
    },
    cartName: { fontWeight: 900 },
    cartMeta: { color: "#333", fontWeight: 800, fontSize: 13 },

    qtyBox: { display: "flex", alignItems: "center", gap: 6 },
    qtyBtn: {
      width: 36,
      height: 36,
      borderRadius: 12,
      border: `1px solid ${glassBorder}`,
      background: glassBg,
      fontSize: 18,
      cursor: "pointer",
      boxShadow: "0 8px 18px rgba(0,0,0,0.07)",
      ...blur,
    },
    qtyNum: { minWidth: 24, textAlign: "center", fontWeight: 900 },

    cartSum: { width: 90, textAlign: "right", fontWeight: 900 },

    removeBtn: {
      border: `1px solid ${glassBorder}`,
      background: glassBg,
      borderRadius: 12,
      fontSize: 16,
      cursor: "pointer",
      padding: "6px 10px",
      boxShadow: "0 8px 18px rgba(0,0,0,0.06)",
      ...blur,
    },

    totalBlock: {
      marginTop: 10,
      paddingTop: 10,
      borderTop: "1px solid rgba(0,0,0,0.06)",
      display: "grid",
      gap: 8,
    },

    totalRow: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      fontSize: 15,
    },
    totalRowBig: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      fontSize: 17,
      paddingTop: 6,
      marginTop: 4,
      borderTop: "1px dashed rgba(0,0,0,0.12)",
    },

    freeTag: {
      marginLeft: 8,
      padding: "3px 8px",
      borderRadius: 999,
      background: "rgba(47,188,47,0.14)",
      color: "#1f7a1f",
      fontWeight: 900,
      fontSize: 12,
    },
    mutedTag: {
      marginLeft: 8,
      padding: "3px 8px",
      borderRadius: 999,
      background: "rgba(0,0,0,0.06)",
      color: "#333",
      fontWeight: 800,
      fontSize: 12,
    },

    h2: { fontSize: 20, fontWeight: 900, marginBottom: 10 },

    label: { display: "block", marginTop: 10, fontWeight: 900 },
    input: {
      width: "100%",
      padding: "12px 12px",
      borderRadius: 14,
      border: `1px solid ${glassBorder}`,
      marginTop: 6,
      fontSize: 14,
      background: "#fff",
      outline: "none",
      boxShadow: "0 8px 18px rgba(0,0,0,0.05)",
    },

    primaryBtn: {
      width: "100%",
      marginTop: 12,
      background: "linear-gradient(180deg, #2fbc2f 0%, #1f7a1f 100%)",
      color: "#fff",
      border: "1px solid rgba(255,255,255,0.25)",
      borderRadius: 16,
      padding: "13px 14px",
      fontWeight: 900,
      cursor: "pointer",
      boxShadow: "0 12px 26px rgba(31,122,31,0.22)",
    },
    secondaryBtn: {
      width: "100%",
      marginTop: 10,
      background: "#fff",
      color: "#111",
      border: `1px solid ${glassBorder}`,
      borderRadius: 16,
      padding: "13px 14px",
      fontWeight: 900,
      cursor: "pointer",
      boxShadow: "0 10px 22px rgba(0,0,0,0.08)",
    },

    note: { marginTop: 10, fontSize: 12, color: "#555" },
  };
}

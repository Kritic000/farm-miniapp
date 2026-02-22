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
    localStorage.setItem(
      PRODUCTS_CACHE_KEY,
      JSON.stringify({ ts: Date.now(), products })
    );
  } catch {}
}

// нормализуем путь картинки из таблицы:
// - "public/images/xxx.jpg" -> "/images/xxx.jpg"
// - "/images/xxx.jpg" -> "/images/xxx.jpg"
// - "images/xxx.jpg" -> "/images/xxx.jpg"
function normalizeImagePath(img?: string): string | undefined {
  const s = String(img || "").trim();
  if (!s) return undefined;
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  if (s.startsWith("/")) return s;
  if (s.startsWith("public/")) return "/" + s.replace(/^public\//, "");
  return "/" + s;
}

// fetch с таймаутом (Apps Script может “просыпаться” долго)
async function fetchWithTimeout(
  input: RequestInfo,
  init: RequestInit & { timeoutMs?: number } = {}
) {
  const { timeoutMs = 25000, ...rest } = init; // 25 секунд
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
  // === ВАЖНО: токен должен совпадать с API_TOKEN в Apps Script ===
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

  // Быстрая загрузка ассортимента: сначала кэш, потом сеть
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const cached = loadProductsCache();
      const hasFreshCache = !!(
        cached && Date.now() - cached.ts < PRODUCTS_CACHE_TTL_MS
      );

      try {
        setLoading(true);
        setError("");
        setLoadingHint("");

        // 1) показать кэш мгновенно
        if (hasFreshCache && cached) {
          setProducts(cached.products);
          setLoading(false);
          setLoadingHint("Обновляем ассортимент…");
        }

        // 2) подтянуть с сервера
        const url = `${API_URL}?action=products&ts=${Date.now()}`;
        const res = await fetchWithTimeout(url, {
          method: "GET",
          timeoutMs: 25000,
        });
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

        // если таймаут, но есть свежий кэш — показываем кэш без ошибки
        if (e?.name === "AbortError" && hasFreshCache) {
          setLoading(false);
          setError("");
          setLoadingHint(
            "Сервер отвечает медленно. Показан сохранённый ассортимент."
          );
          return;
        }

        if (e?.name === "AbortError")
          setError("Сервер долго отвечает. Попробуйте ещё раз.");
        else setError(e?.message || "Ошибка загрузки товаров");

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

  const cartCount = useMemo(
    () => cartItems.reduce((s, it) => s + it.qty, 0),
    [cartItems]
  );

  const total = useMemo(
    () => cartItems.reduce((s, it) => s + it.qty * it.product.price, 0),
    [cartItems]
  );

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
    if (address.trim().length < 5)
      return "Укажи адрес доставки (минимум 5 символов).";
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
      total,
      delivery,
      grandTotal,
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

      setToast({
        type: "success",
        text: "✅ Заказ отправлен! Мы свяжемся для подтверждения.",
      });

      setCart({});
      setAddress("");
      setComment("");
      setCustomerName("");
      setPhone("");
      setTab("catalog");
    } catch (e: any) {
      setToast({
        type: "error",
        text: `Не удалось отправить заказ: ${e?.message || "Ошибка"}`,
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={styles.page}>
      {toast && (
        <div
          style={{
            ...styles.toast,
            ...(toast.type === "error" ? styles.toastError : {}),
            ...(toast.type === "success" ? styles.toastSuccess : {}),
            ...(toast.type === "info" ? styles.toastInfo : {}),
          }}
        >
          <div style={{ fontWeight: 900 }}>{toast.text}</div>
          <button style={styles.toastClose} onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      )}

      <div style={styles.container}>
        {/* Минималистичная шапка */}
        <div style={styles.header}>
          <div style={styles.title}></div>

          <div style={styles.tabs}>
            <button
              style={{
                ...styles.tabBtn,
                ...(tab === "catalog" ? styles.tabActive : {}),
              }}
              onClick={() => setTab("catalog")}
            >
              Товары
            </button>

            <button
              style={{
                ...styles.tabBtn,
                ...(tab === "cart" || tab === "checkout"
                  ? styles.tabActive
                  : {}),
              }}
              onClick={() => setTab("cart")}
            >
              🛒 Корзина ({cartCount})
            </button>
          </div>
        </div>

        {loading && <div style={styles.info}>Загрузка ассортимента…</div>}
        {!loading && loadingHint && (
          <div style={styles.infoMuted}>{loadingHint}</div>
        )}
        {error && (
          <div style={{ ...styles.info, color: styles.colors.danger }}>
            {error}
          </div>
        )}

        {!loading && !error && (
          <>
            {tab === "catalog" && (
              <>
                <div style={styles.chipsRow}>
                  {categories.map((c) => (
                    <button
                      key={c}
                      style={{
                        ...styles.chip,
                        ...(activeCategory === c ? styles.chipActive : {}),
                      }}
                      onClick={() => setActiveCategory(c)}
                    >
                      {c}
                    </button>
                  ))}
                </div>

                <div style={styles.list}>
                  {filteredProducts.map((p) => {
                    const q = qtyOf(p.id);

                    return (
                      <div key={p.id} style={styles.card}>
                        {p.image ? (
                          <img
                            src={p.image}
                            alt={p.name}
                            style={styles.cardImg}
                            loading="lazy"
                            decoding="async"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display =
                                "none";
                            }}
                          />
                        ) : (
                          <div style={styles.cardImgPlaceholder}>Нет фото</div>
                        )}

                        <div style={styles.cardBody}>
                          <div style={styles.cardName}>{p.name}</div>
                          {p.description ? (
                            <div style={styles.cardDesc}>{p.description}</div>
                          ) : null}

                          {/* ✅ Цена: цветная только сумма (и без дубля unit) */}
                          <div style={styles.cardMeta}>
                            <span
                              style={{
                                color: styles.colors.primary,
                                fontWeight: 950,
                              }}
                            >
                              {money(p.price)} ₽
                            </span>
                            <span
                              style={{
                                color: styles.colors.ink,
                                opacity: 0.9,
                                fontWeight: 850,
                              }}
                            >
                              {" "}
                              / {p.unit}
                            </span>
                          </div>

                          {q === 0 ? (
                            <button
                              style={styles.buyBtn}
                              onClick={() => addToCart(p)}
                            >
                              В корзину
                            </button>
                          ) : (
                            <div style={styles.qtyInline}>
                              <button
                                style={styles.qtyBtn}
                                onClick={() => setQty(p.id, q - 1)}
                              >
                                −
                              </button>
                              <div style={styles.qtyNum}>{q}</div>
                              <button
                                style={styles.qtyBtn}
                                onClick={() => setQty(p.id, q + 1)}
                              >
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
              <div style={styles.panel}>
                {cartItems.length === 0 ? (
                  <div style={styles.info}>Корзина пустая</div>
                ) : (
                  <>
                    {cartItems.map((it) => (
                      <div key={it.product.id} style={styles.cartRow}>
                        <div style={{ flex: 1 }}>
                          <div style={styles.cartName}>{it.product.name}</div>
                          <div style={styles.cartMeta}>
                            {money(it.product.price)} ₽ / {it.product.unit}
                          </div>
                        </div>

                        <div style={styles.qtyBox}>
                          <button
                            style={styles.qtyBtn}
                            onClick={() =>
                              setQty(it.product.id, it.qty - 1)
                            }
                          >
                            −
                          </button>
                          <div style={styles.qtyNum}>{it.qty}</div>
                          <button
                            style={styles.qtyBtn}
                            onClick={() =>
                              setQty(it.product.id, it.qty + 1)
                            }
                          >
                            +
                          </button>
                        </div>

                        <div style={styles.cartSum}>
                          {money(it.qty * it.product.price)} ₽
                        </div>

                        <button
                          style={styles.removeBtn}
                          onClick={() => setQty(it.product.id, 0)}
                        >
                          ✕
                        </button>
                      </div>
                    ))}

                    <div style={styles.totalBlock}>
                      <div style={styles.totalRow}>
                        <div>Товары</div>
                        <div style={{ fontWeight: 900 }}>{money(total)} ₽</div>
                      </div>

                      <div style={styles.totalRow}>
                        <div>
                          Доставка{" "}
                          {delivery === 0 ? (
                            <span style={styles.freeTag}>бесплатно</span>
                          ) : (
                            <span style={styles.mutedTag}>
                              до {money(FREE_DELIVERY_FROM)} ₽
                            </span>
                          )}
                        </div>
                        <div style={{ fontWeight: 900 }}>
                          {money(delivery)} ₽
                        </div>
                      </div>

                      <div style={styles.totalRowBig}>
                        <div>Итого</div>
                        <div style={{ fontWeight: 950 }}>
                          {money(grandTotal)} ₽
                        </div>
                      </div>
                    </div>

                    <button
                      style={styles.primaryBtn}
                      onClick={() => setTab("checkout")}
                    >
                      Оформить
                    </button>
                  </>
                )}
              </div>
            )}

            {tab === "checkout" && (
              <div style={styles.panel}>
                <div style={styles.h2}>Оформление</div>

                <label style={styles.label}>
                  Имя <span style={{ color: styles.colors.danger }}>*</span>
                </label>
                <input
                  style={styles.input}
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Как к вам обращаться?"
                  autoComplete="name"
                />

                <label style={styles.label}>
                  Телефон <span style={{ color: styles.colors.danger }}>*</span>
                </label>
                <input
                  style={styles.input}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+7..."
                  autoComplete="tel"
                  inputMode="tel"
                />

                <label style={styles.label}>
                  Адрес доставки{" "}
                  <span style={{ color: styles.colors.danger }}>*</span>
                </label>
                <input
                  style={styles.input}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="улица, дом, подъезд, этаж, кв."
                  autoComplete="street-address"
                />

                <label style={styles.label}>Комментарий (необязательно)</label>
                <input
                  style={styles.input}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="код домофона, удобное время"
                />

                <div style={styles.totalBlock}>
                  <div style={styles.totalRow}>
                    <div>Товары</div>
                    <div style={{ fontWeight: 900 }}>{money(total)} ₽</div>
                  </div>

                  <div style={styles.totalRow}>
                    <div>
                      Доставка{" "}
                      {delivery === 0 ? (
                        <span style={styles.freeTag}>бесплатно</span>
                      ) : (
                        <span style={styles.mutedTag}>
                          до {money(FREE_DELIVERY_FROM)} ₽
                        </span>
                      )}
                    </div>
                    <div style={{ fontWeight: 900 }}>
                      {money(delivery)} ₽
                    </div>
                  </div>

                  <div style={styles.totalRowBig}>
                    <div>Итого</div>
                    <div style={{ fontWeight: 950 }}>
                      {money(grandTotal)} ₽
                    </div>
                  </div>
                </div>

                <button
                  style={{
                    ...styles.primaryBtn,
                    opacity: sending ? 0.7 : 1,
                    cursor: sending ? "not-allowed" : "pointer",
                  }}
                  onClick={submitOrder}
                  disabled={sending}
                >
                  {sending ? "Отправляем..." : "Подтвердить заказ"}
                </button>

                <button
                  style={styles.secondaryBtn}
                  onClick={() => setTab("cart")}
                  disabled={sending}
                >
                  Назад в корзину
                </button>

                <div style={styles.note}>
                  Оплата пока не принимается в приложении — мы свяжемся после
                  оформления.
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Стили + палитра (ТОЛЬКО твои цвета)
 */
const styles: Record<string, React.CSSProperties> & {
  colors: {
    ink: string;
    primary: string;
    sun: string;
    orange: string;
    danger: string;
  };
} = {
  colors: {
    ink: "#264653",
    primary: "#2a9d8f",
    sun: "#e9c46a",
    orange: "#f4a261",
    danger: "#e76f51",
  },

  page: {
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
    padding: 16,
    minHeight: "100vh",
    boxSizing: "border-box",

    // фон-картинка + “вуаль”
    backgroundImage:
      "linear-gradient(rgba(255,255,255,0.30), rgba(255,255,255,0.50)), url('/images/bg-farm.png')",
    backgroundSize: "cover",
    backgroundPosition: "center top",
    backgroundRepeat: "no-repeat",
    color: "#264653",
  },

  // ✅ важно для мобилки: width+boxSizing, чтобы не вылезало
  container: {
    maxWidth: 520,
    width: "100%",
    boxSizing: "border-box",
    margin: "0 auto",
    background: "rgba(255,255,255,0.60)",
    borderRadius: 22,
    padding: 12,
    boxShadow: "0 20px 40px rgba(38,70,83,0.22)",
    border: "1px solid rgba(38,70,83,0.12)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
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
    boxShadow: "0 12px 26px rgba(38,70,83,0.20)",
    marginBottom: 10,
    border: "1px solid rgba(38,70,83,0.12)",
    background: "rgba(255,255,255,0.92)",
    color: "#264653",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    boxSizing: "border-box",
  },
  toastError: { background: "rgba(231,111,81,0.16)", color: "#264653" },
  toastSuccess: { background: "rgba(42,157,143,0.16)", color: "#264653" },
  toastInfo: { background: "rgba(233,196,106,0.20)", color: "#264653" },
  toastClose: {
    border: 0,
    background: "transparent",
    fontSize: 22,
    lineHeight: 1,
    cursor: "pointer",
    padding: 4,
    color: "#264653",
  },

  // ✅ Минимализм: без “плашки” под названием
  header: {
    position: "sticky",
    top: 0,
    zIndex: 50,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 12,
    padding: "6px 0",
    background: "transparent",
    borderBottom: "none",
  },

  title: {
    fontSize: 28,
    fontWeight: 950,
    letterSpacing: -0.6,
    color: "#264653",
  },

  tabs: { display: "flex", gap: 10 },

  tabBtn: {
    border: "1px solid rgba(38,70,83,0.18)",
    background: "rgba(255,255,255,0.78)",
    padding: "10px 16px",
    borderRadius: 999,
    fontWeight: 950,
    cursor: "pointer",
    boxShadow: "0 8px 18px rgba(38,70,83,0.16)",
    color: "#264653",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    boxSizing: "border-box",
  },
  tabActive: {
    borderColor: "rgba(42,157,143,0.35)",
    background:
      "linear-gradient(180deg, rgba(42,157,143,0.98) 0%, rgba(38,70,83,0.98) 140%)",
    color: "#ffffff",
    boxShadow: "0 14px 30px rgba(42,157,143,0.26)",
  },

  chipsRow: {
    display: "flex",
    gap: 10,
    overflowX: "auto",
    paddingBottom: 10,
    marginBottom: 10,
  },

  chip: {
    border: "1px solid rgba(38,70,83,0.18)",
    background: "rgba(255,255,255,0.74)",
    padding: "9px 12px",
    borderRadius: 999,
    fontWeight: 950,
    cursor: "pointer",
    whiteSpace: "nowrap",
    boxShadow: "0 8px 18px rgba(38,70,83,0.14)",
    color: "#264653",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    boxSizing: "border-box",
  },
  chipActive: {
    background:
      "linear-gradient(180deg, rgba(42,157,143,0.98) 0%, rgba(38,70,83,0.98) 140%)",
    color: "#ffffff",
    borderColor: "rgba(42,157,143,0.35)",
    boxShadow: "0 14px 30px rgba(42,157,143,0.22)",
  },

  info: { padding: 12, fontWeight: 900, color: "#264653" },
  infoMuted: { padding: 8, color: "rgba(38,70,83,0.82)", fontWeight: 800 },

  list: { display: "grid", gap: 12 },

  card: {
    background: "rgba(255,255,255,0.55)",
    borderRadius: 18,
    overflow: "hidden",
    boxShadow: "0 12px 26px rgba(38,70,83,0.16)",
    border: "1px solid rgba(38,70,83,0.12)",
    display: "grid",
    gridTemplateColumns: "120px 1fr",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    boxSizing: "border-box",
  },

  cardImg: { width: 120, height: 120, objectFit: "cover", display: "block" },

  cardImgPlaceholder: {
    width: 120,
    height: 120,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(233,196,106,0.22)",
    color: "#264653",
    fontWeight: 950,
    boxSizing: "border-box",
  },

  cardBody: { padding: 12, display: "flex", flexDirection: "column", gap: 8 },
  cardName: {
    fontSize: 18,
    fontWeight: 950,
    lineHeight: 1.15,
    color: "#264653",
  },
  cardDesc: {
    fontSize: 13,
    color: "rgba(38,70,83,0.90)",
    lineHeight: 1.25,
    fontWeight: 700,
  },
  cardMeta: { color: "#111111", fontWeight: 950 },

  buyBtn: {
    marginTop: 6,
    background:
      "linear-gradient(180deg, rgba(42,157,143,1) 0%, rgba(38,70,83,1) 140%)",
    color: "#fff",
    border: "1px solid rgba(255,255,255,0.22)",
    borderRadius: 14,
    padding: "10px 14px",
    fontWeight: 950,
    cursor: "pointer",
    width: "fit-content",
    boxShadow: "0 14px 30px rgba(42,157,143,0.22)",
    boxSizing: "border-box",
  },

  qtyInline: { display: "flex", alignItems: "center", gap: 8, marginTop: 6 },

  qtyBox: { display: "flex", alignItems: "center", gap: 6 },
  qtyBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    border: "1px solid rgba(38,70,83,0.16)",
    background: "rgba(255,255,255,0.82)",
    fontSize: 18,
    cursor: "pointer",
    boxShadow: "0 10px 20px rgba(38,70,83,0.14)",
    color: "#264653",
    boxSizing: "border-box",
  },
  qtyNum: { minWidth: 24, textAlign: "center", fontWeight: 950, color: "#264653" },

  panel: {
    background: "rgba(255,255,255,0.80)",
    borderRadius: 18,
    padding: 12,
    boxShadow: "0 12px 26px rgba(38,70,83,0.16)",
    border: "1px solid rgba(38,70,83,0.12)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    boxSizing: "border-box",
  },

  cartRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 0",
    borderBottom: "1px solid rgba(38,70,83,0.10)",
  },
  cartName: { fontWeight: 950, color: "#264653" },
  cartMeta: { color: "rgba(38,70,83,0.90)", fontWeight: 800, fontSize: 13 },

  cartSum: { width: 90, textAlign: "right", fontWeight: 950, color: "#264653" },

  removeBtn: {
    border: "1px solid rgba(231,111,81,0.55)",
    background: "rgba(231,111,81,0.16)",
    color: "#264653",
    borderRadius: 12,
    fontSize: 16,
    cursor: "pointer",
    padding: "6px 10px",
    boxShadow: "0 10px 18px rgba(231,111,81,0.18)",
    boxSizing: "border-box",
  },

  totalBlock: {
    marginTop: 10,
    paddingTop: 10,
    borderTop: "1px solid rgba(38,70,83,0.10)",
    display: "grid",
    gap: 8,
  },

  totalRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 15,
    color: "#264653",
    fontWeight: 800,
  },
  totalRowBig: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 17,
    paddingTop: 6,
    marginTop: 4,
    borderTop: "1px dashed rgba(38,70,83,0.22)",
    color: "#264653",
  },

  freeTag: {
    marginLeft: 8,
    padding: "3px 8px",
    borderRadius: 999,
    background: "rgba(233,196,106,0.30)",
    color: "#264653",
    fontWeight: 950,
    fontSize: 12,
    border: "1px solid rgba(233,196,106,0.65)",
    boxSizing: "border-box",
  },
  mutedTag: {
    marginLeft: 8,
    padding: "3px 8px",
    borderRadius: 999,
    background: "rgba(244,162,97,0.18)",
    color: "#264653",
    fontWeight: 900,
    fontSize: 12,
    border: "1px solid rgba(244,162,97,0.55)",
    boxSizing: "border-box",
  },

  h2: { fontSize: 20, fontWeight: 950, marginBottom: 10, color: "#264653" },

  label: {
    display: "block",
    marginTop: 10,
    fontWeight: 900,
    fontSize: 14,
    color: "#264653",
  },

  // ✅ чтобы инпуты не вылезали на телефоне
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "12px 12px",
    borderRadius: 14,
    border: "1px solid rgba(38,70,83,0.16)",
    marginTop: 6,
    fontSize: 14,
    background: "rgba(255,255,255,0.86)",
    outline: "none",
    boxShadow: "0 10px 18px rgba(38,70,83,0.10)",
    color: "#264653",
  },

  primaryBtn: {
    width: "100%",
    marginTop: 12,
    background:
      "linear-gradient(180deg, rgba(42,157,143,1) 0%, rgba(38,70,83,1) 140%)",
    color: "#fff",
    border: "1px solid rgba(255,255,255,0.22)",
    borderRadius: 16,
    padding: "13px 14px",
    fontWeight: 950,
    cursor: "pointer",
    boxShadow: "0 16px 34px rgba(42,157,143,0.24)",
    boxSizing: "border-box",
  },

  secondaryBtn: {
    width: "100%",
    marginTop: 10,
    background: "rgba(244,162,97,0.18)",
    color: "#264653",
    border: "1px solid rgba(244,162,97,0.55)",
    borderRadius: 16,
    padding: "13px 14px",
    fontWeight: 950,
    cursor: "pointer",
    boxShadow: "0 12px 26px rgba(244,162,97,0.18)",
    boxSizing: "border-box",
  },

  note: {
    marginTop: 10,
    fontSize: 12,
    color: "rgba(38,70,83,0.86)",
    fontWeight: 700,
  },
};


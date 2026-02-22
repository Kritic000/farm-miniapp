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
  image?: string; // например "/images/milk.jpg"
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

  // поля клиента
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
      try {
        setLoading(true);
        setError("");
        setLoadingHint("");

        // 1) показать кэш мгновенно
        const cached = loadProductsCache();
        if (cached && Date.now() - cached.ts < PRODUCTS_CACHE_TTL_MS) {
          setProducts(cached.products);
          setLoading(false);
          setLoadingHint("Обновляем ассортимент…");
        }

        // 2) подтянуть с сервера (всегда, чтобы обновлялось)
        const url = `${API_URL}?action=products&ts=${Date.now()}`;
        const res = await fetch(url, { method: "GET" });
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
        setError(e?.message || "Ошибка загрузки товаров");
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
      // ВАЖНО: без alert — иначе Telegram иногда “ломает” ввод
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
    };

    try {
      setSending(true);

      // Важно: text/plain уменьшает шанс preflight/CORS проблем в Apps Script
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
      {/* Toast (встроенное уведомление вместо alert) */}
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

      <div style={styles.header}>
        <div style={styles.title}>Каталог</div>
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
              ...(tab === "cart" || tab === "checkout" ? styles.tabActive : {}),
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
      {error && <div style={{ ...styles.info, color: "#b00020" }}>{error}</div>}

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
                          onError={(e) => {
                            // если битый путь — покажем плейсхолдер (скрываем img)
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

                        <div style={styles.cardMeta}>
                          {money(p.price)} ₽ / {p.unit}
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
                          onClick={() => setQty(it.product.id, it.qty - 1)}
                        >
                          −
                        </button>
                        <div style={styles.qtyNum}>{it.qty}</div>
                        <button
                          style={styles.qtyBtn}
                          onClick={() => setQty(it.product.id, it.qty + 1)}
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

                  <div style={styles.totalRow}>
                    <div>Итого</div>
                    <div style={{ fontWeight: 800 }}>{money(total)} ₽</div>
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
                Имя <span style={{ color: "#b00020" }}>*</span>
              </label>
              <input
                style={styles.input}
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Как к вам обращаться?"
                autoComplete="name"
              />

              <label style={styles.label}>
                Телефон <span style={{ color: "#b00020" }}>*</span>
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
                Адрес доставки <span style={{ color: "#b00020" }}>*</span>
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

              <div style={styles.totalRow}>
                <div>Итого</div>
                <div style={{ fontWeight: 800 }}>{money(total)} ₽</div>
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
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
    padding: 16,
    background: "#f2f3f5",
    minHeight: "100vh",
  },

  // toast
  toast: {
    position: "sticky",
    top: 8,
    zIndex: 9999,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "12px 12px",
    borderRadius: 12,
    boxShadow: "0 8px 20px rgba(0,0,0,0.18)",
    marginBottom: 10,
    border: "1px solid rgba(0,0,0,0.06)",
  },
  toastError: { background: "#ffe8ea", color: "#7a0010" },
  toastSuccess: { background: "#e7f6ea", color: "#0e4b1b" },
  toastInfo: { background: "#eef2ff", color: "#1c2b6b" },
  toastClose: {
    border: 0,
    background: "transparent",
    fontSize: 22,
    lineHeight: 1,
    cursor: "pointer",
    padding: 4,
  },

  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  },
  title: { fontSize: 34, fontWeight: 900, letterSpacing: -0.5 },
  tabs: { display: "flex", gap: 8 },
  tabBtn: {
    border: "1px solid #d0d0d0",
    background: "#fff",
    padding: "10px 12px",
    borderRadius: 10,
    fontWeight: 700,
    cursor: "pointer",
  },
  tabActive: { background: "#e6f2e6", borderColor: "#7ab37a" },

  chipsRow: {
    display: "flex",
    gap: 8,
    overflowX: "auto",
    paddingBottom: 8,
    marginBottom: 10,
  },
  chip: {
    border: "1px solid #d0d0d0",
    background: "#fff",
    padding: "8px 10px",
    borderRadius: 999,
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  chipActive: {
    background: "#1f7a1f",
    color: "#fff",
    borderColor: "#1f7a1f",
  },

  info: { padding: 12, fontWeight: 700 },
  infoMuted: { padding: 8, color: "#555" },

  list: { display: "grid", gap: 12 },

  card: {
    background: "#fff",
    borderRadius: 14,
    overflow: "hidden",
    boxShadow: "0 1px 10px rgba(0,0,0,0.06)",
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
    background: "#e9eaec",
    color: "#666",
    fontWeight: 700,
  },
  cardBody: { padding: 12, display: "flex", flexDirection: "column", gap: 8 },
  cardName: { fontSize: 18, fontWeight: 900, lineHeight: 1.15 },
  cardDesc: { fontSize: 13, color: "#333", lineHeight: 1.25 },
  cardMeta: { color: "#222", fontWeight: 700 },

  buyBtn: {
    marginTop: 4,
    background: "#1f7a1f",
    color: "#fff",
    border: 0,
    borderRadius: 10,
    padding: "10px 12px",
    fontWeight: 800,
    cursor: "pointer",
    width: "fit-content",
  },

  qtyInline: { display: "flex", alignItems: "center", gap: 8, marginTop: 4 },
  panel: {
    background: "#fff",
    borderRadius: 14,
    padding: 14,
    boxShadow: "0 1px 10px rgba(0,0,0,0.06)",
  },

  cartRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 0",
    borderBottom: "1px solid #eee",
  },
  cartName: { fontWeight: 900 },
  cartMeta: { color: "#333", fontWeight: 700, fontSize: 13 },

  qtyBox: { display: "flex", alignItems: "center", gap: 6 },
  qtyBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    border: "1px solid #d0d0d0",
    background: "#fff",
    fontSize: 18,
    cursor: "pointer",
  },
  qtyNum: { minWidth: 24, textAlign: "center", fontWeight: 900 },

  cartSum: { width: 90, textAlign: "right", fontWeight: 900 },
  removeBtn: {
    border: 0,
    background: "transparent",
    fontSize: 18,
    cursor: "pointer",
    padding: 6,
  },

  totalRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 12,
    marginTop: 6,
    fontSize: 16,
  },

  h2: { fontSize: 20, fontWeight: 900, marginBottom: 10 },

  label: { display: "block", marginTop: 10, fontWeight: 800 },
  input: {
    width: "100%",
    padding: "12px 12px",
    borderRadius: 10,
    border: "1px solid #d0d0d0",
    marginTop: 6,
    fontSize: 14,
  },

  primaryBtn: {
    width: "100%",
    marginTop: 12,
    background: "#1f7a1f",
    color: "#fff",
    border: 0,
    borderRadius: 12,
    padding: "12px 14px",
    fontWeight: 900,
    cursor: "pointer",
  },
  secondaryBtn: {
    width: "100%",
    marginTop: 10,
    background: "#fff",
    color: "#111",
    border: "1px solid #d0d0d0",
    borderRadius: 12,
    padding: "12px 14px",
    fontWeight: 900,
    cursor: "pointer",
  },

  note: { marginTop: 10, fontSize: 12, color: "#555" },
};

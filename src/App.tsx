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

type OrderItem = {
  id?: string;
  name: string;
  unit?: string;
  price: number;
  qty: number;
  sum: number;
};

type Order = {
  createdAt: string;
  status: string;
  name?: string;
  phone?: string;
  total: number;
  delivery: number;
  grandTotal: number;
  items: OrderItem[];
};

type Toast = { type: "error" | "success" | "info"; text: string } | null;

const PRODUCTS_CACHE_KEY = "farm_products_cache_v1";
const PRODUCTS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 минут
const LAST_PHONE_KEY = "farm_last_phone_v1";

const DELIVERY_FEE = 200;
const FREE_DELIVERY_FROM = 2000;

function getTgUser(): TgUser | null {
  const w = window as any;
  const tg = w?.Telegram?.WebApp;
  const u = tg?.initDataUnsafe?.user;
  return u || null;
}

function money(n: number) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(n));
}

function normalizePhone(p: string) {
  return (p || "").replace(/\D+/g, "");
}

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function humanStatus(s: string) {
  const v = String(s || "").toLowerCase();
  if (v === "new") return "Новый";
  if (v === "accepted") return "Принят";
  if (v === "cooking" || v === "in_work") return "В работе";
  if (v === "delivering") return "Доставляется";
  if (v === "done" || v === "completed") return "Выполнен";
  if (v === "canceled" || v === "cancelled") return "Отменён";
  return s || "—";
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

function loadLastPhone(): string {
  try {
    return localStorage.getItem(LAST_PHONE_KEY) || "";
  } catch {
    return "";
  }
}

function saveLastPhone(phone: string) {
  try {
    localStorage.setItem(LAST_PHONE_KEY, phone);
  } catch {}
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
  const [tab, setTab] = useState<"catalog" | "cart" | "checkout" | "orders">(
    "catalog"
  );

  const [cart, setCart] = useState<Record<string, CartItem>>({});

  const [address, setAddress] = useState("");
  const [comment, setComment] = useState("");

  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState(() => loadLastPhone());

  const [sending, setSending] = useState(false);

  // orders
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);

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

  // сохраняем телефон (чтобы "Мои заказы" могли работать даже если tg id недоступен)
  useEffect(() => {
    const p = phone.trim();
    if (p.length >= 6) saveLastPhone(p);
  }, [phone]);

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
      // телефон оставляем
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

  async function loadMyOrders() {
    const tg = getTgUser();
    const tgUserId = tg?.id ? String(tg.id) : "";
    const phoneDigits = normalizePhone(phone);

    // если нет ни tgUserId, ни телефона — не грузим
    if (!tgUserId && phoneDigits.length < 6) {
      setOrders([]);
      setOrdersError(
        "Чтобы показать заказы, открой приложение из Telegram или укажи телефон (в оформлении)."
      );
      return;
    }

    try {
      setOrdersLoading(true);
      setOrdersError("");

      const url =
        `${API_URL}?action=orders` +
        `&token=${encodeURIComponent(API_TOKEN)}` +
        `&tgUserId=${encodeURIComponent(tgUserId)}` +
        `&phone=${encodeURIComponent(phoneDigits)}` +
        `&limit=30` +
        `&ts=${Date.now()}`;

      const res = await fetchWithTimeout(url, {
        method: "GET",
        timeoutMs: 25000,
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      if (data?.error) throw new Error(data.error);

      const list: Order[] = Array.isArray(data.orders) ? data.orders : [];
      setOrders(list);
    } catch (e: any) {
      setOrdersError(e?.message || "Не удалось загрузить заказы");
    } finally {
      setOrdersLoading(false);
    }
  }

  // когда открыли вкладку orders — подгружаем
  useEffect(() => {
    if (tab !== "orders") return;
    loadMyOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

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
          <div style={{ fontWeight: 700 }}>{toast.text}</div>
          <button style={styles.toastClose} onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      )}

      <div style={styles.container}>
        {/* ===== HEADER (Вариант 2: 2 ряда) ===== */}
        <div style={styles.header}>
          {/* Row 1: Название + Корзина */}
          <div style={styles.headerRow}>
            <div style={styles.title}>FarmShop</div>
            <button
              style={{
                ...styles.navBtn,
                ...(tab === "cart" || tab === "checkout" ? styles.navBtnActive : {}),
              }}
              onClick={() => setTab("cart")}
            >
              🛒 Корзина ({cartCount})
            </button>
          </div>

          {/* Row 2: Товары + Заказы */}
          <div style={styles.headerRow}>
            <button
              style={{
                ...styles.navBtn,
                ...(tab === "catalog" ? styles.navBtnActive : {}),
              }}
              onClick={() => setTab("catalog")}
            >
              Товары
            </button>

            <button
              style={{
                ...styles.navBtn,
                ...(tab === "orders" ? styles.navBtnActive : {}),
              }}
              onClick={() => setTab("orders")}
            >
              📦 Заказы
            </button>
          </div>
        </div>

        {loading && <div style={styles.info}>Загрузка ассортимента…</div>}
        {!loading && loadingHint && <div style={styles.infoMuted}>{loadingHint}</div>}
        {error && <div style={{ ...styles.info, color: styles.colors.danger }}>{error}</div>}

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
                              (e.currentTarget as HTMLImageElement).style.display = "none";
                            }}
                          />
                        ) : (
                          <div style={styles.cardImgPlaceholder}>Нет фото</div>
                        )}

                        <div style={styles.cardBody}>
                          <div style={styles.cardName} title={p.name}>
                            {p.name}
                          </div>

                          {p.description ? (
                            <div style={styles.cardDesc} title={p.description}>
                              {p.description}
                            </div>
                          ) : null}

                          <div style={styles.cardMeta}>
                            <span style={styles.price}>{money(p.price)} ₽</span>
                            <span style={styles.unit}> / {p.unit}</span>
                          </div>

                          {q === 0 ? (
                            <button style={styles.buyBtn} onClick={() => addToCart(p)}>
                              В корзину
                            </button>
                          ) : (
                            <div style={styles.qtyInline}>
                              <button style={styles.qtyBtn} onClick={() => setQty(p.id, q - 1)}>
                                −
                              </button>
                              <div style={styles.qtyNum}>{q}</div>
                              <button style={styles.qtyBtn} onClick={() => setQty(p.id, q + 1)}>
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
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={styles.cartName}>{it.product.name}</div>
                          <div style={styles.cartMeta}>
                            {money(it.product.price)} ₽ / {it.product.unit}
                          </div>
                        </div>

                        <div style={styles.qtyBox}>
                          <button style={styles.qtyBtn} onClick={() => setQty(it.product.id, it.qty - 1)}>
                            −
                          </button>
                          <div style={styles.qtyNum}>{it.qty}</div>
                          <button style={styles.qtyBtn} onClick={() => setQty(it.product.id, it.qty + 1)}>
                            +
                          </button>
                        </div>

                        <div style={styles.cartSum}>{money(it.qty * it.product.price)} ₽</div>

                        <button style={styles.removeBtn} onClick={() => setQty(it.product.id, 0)}>
                          ✕
                        </button>
                      </div>
                    ))}

                    <div style={styles.totalBlock}>
                      <div style={styles.totalRow}>
                        <div>Товары</div>
                        <div style={{ fontWeight: 700 }}>{money(total)} ₽</div>
                      </div>

                      <div style={styles.totalRow}>
                        <div>
                          Доставка{" "}
                          {delivery === 0 ? (
                            <span style={styles.freeTag}>бесплатно</span>
                          ) : (
                            <span style={styles.mutedTag}>до {money(FREE_DELIVERY_FROM)} ₽</span>
                          )}
                        </div>
                        <div style={{ fontWeight: 700 }}>{money(delivery)} ₽</div>
                      </div>

                      <div style={styles.totalRowBig}>
                        <div>Итого</div>
                        <div style={{ fontWeight: 800 }}>{money(grandTotal)} ₽</div>
                      </div>
                    </div>

                    <button style={styles.primaryBtn} onClick={() => setTab("checkout")}>
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
                  Адрес доставки <span style={{ color: styles.colors.danger }}>*</span>
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
                    <div style={{ fontWeight: 700 }}>{money(total)} ₽</div>
                  </div>

                  <div style={styles.totalRow}>
                    <div>
                      Доставка{" "}
                      {delivery === 0 ? (
                        <span style={styles.freeTag}>бесплатно</span>
                      ) : (
                        <span style={styles.mutedTag}>до {money(FREE_DELIVERY_FROM)} ₽</span>
                      )}
                    </div>
                    <div style={{ fontWeight: 700 }}>{money(delivery)} ₽</div>
                  </div>

                  <div style={styles.totalRowBig}>
                    <div>Итого</div>
                    <div style={{ fontWeight: 800 }}>{money(grandTotal)} ₽</div>
                  </div>
                </div>

                <button
                  style={{
                    ...styles.primaryBtn,
                    opacity: sending ? 0.75 : 1,
                    cursor: sending ? "not-allowed" : "pointer",
                  }}
                  onClick={submitOrder}
                  disabled={sending}
                >
                  {sending ? "Отправляем..." : "Подтвердить заказ"}
                </button>

                <button style={styles.secondaryBtn} onClick={() => setTab("cart")} disabled={sending}>
                  Назад в корзину
                </button>

                <div style={styles.note}>
                  Оплата пока не принимается в приложении — мы свяжемся после оформления.
                </div>
              </div>
            )}

            {tab === "orders" && (
              <div style={styles.panel}>
                <div style={styles.ordersHeader}>
                  <div style={styles.h2}>Мои заказы</div>
                  <button
                    style={styles.refreshBtn}
                    onClick={loadMyOrders}
                    disabled={ordersLoading}
                    title="Обновить"
                  >
                    {ordersLoading ? "Обновляем…" : "↻"}
                  </button>
                </div>

                {ordersError ? (
                  <div style={{ ...styles.info, color: styles.colors.danger }}>{ordersError}</div>
                ) : null}

                {ordersLoading && !orders.length ? <div style={styles.info}>Загружаем заказы…</div> : null}

                {!ordersLoading && !ordersError && orders.length === 0 ? (
                  <div style={styles.infoMuted}>Заказов пока нет. Оформи первый заказ — и он появится здесь.</div>
                ) : null}

                <div style={styles.ordersList}>
                  {orders.map((o, idx) => (
                    <div key={idx} style={styles.orderCard}>
                      <div style={styles.orderTop}>
                        <div style={styles.orderDate}>{formatDate(o.createdAt)}</div>
                        <div style={styles.orderStatus}>{humanStatus(o.status)}</div>
                      </div>

                      <div style={styles.orderTotals}>
                        <div style={styles.orderRow}>
                          <div>Товары</div>
                          <div style={{ fontWeight: 700 }}>{money(o.total)} ₽</div>
                        </div>
                        <div style={styles.orderRow}>
                          <div>Доставка</div>
                          <div style={{ fontWeight: 700 }}>{money(o.delivery)} ₽</div>
                        </div>
                        <div style={styles.orderRowBig}>
                          <div>Итого</div>
                          <div style={{ fontWeight: 800 }}>{money(o.grandTotal)} ₽</div>
                        </div>
                      </div>

                      <div style={styles.orderItems}>
                        {Array.isArray(o.items) &&
                          o.items.slice(0, 20).map((it, j) => (
                            <div key={j} style={styles.orderItemRow}>
                              <div style={styles.orderItemName} title={it.name}>
                                {it.name}
                              </div>
                              <div style={styles.orderItemQty}>×{it.qty}</div>
                              <div style={styles.orderItemSum}>{money(it.sum)} ₽</div>
                            </div>
                          ))}
                        {Array.isArray(o.items) && o.items.length > 20 ? (
                          <div style={styles.infoMuted}>Показаны первые 20 позиций…</div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Плавающая корзина */}
      {tab === "catalog" && cartCount > 0 && (
        <button style={styles.floatingCart} onClick={() => setTab("cart")}>
          🛒 {cartCount} • {money(grandTotal)} ₽
        </button>
      )}
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
    color: "#264653",
    backgroundImage:
      "linear-gradient(rgba(255,255,255,0.30), rgba(255,255,255,0.50)), url('/images/bg-farm.png')",
    backgroundRepeat: "no-repeat",
    backgroundPosition: "center top",
    backgroundSize: "cover",
    backgroundAttachment: "fixed",
  },

  container: {
    maxWidth: 520,
    width: "100%",
    boxSizing: "border-box",
    margin: "0 auto",
    background: "rgba(255,255,255,0.60)",
    borderRadius: 22,
    padding: 12,
    boxShadow: "0 18px 34px rgba(38,70,83,0.18)",
    border: "1px solid rgba(38,70,83,0.10)",
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
    boxShadow: "0 10px 22px rgba(38,70,83,0.16)",
    marginBottom: 10,
    border: "1px solid rgba(38,70,83,0.10)",
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

  header: {
    display: "grid",
    gap: 10,
    marginBottom: 12,
  },

  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    width: "100%",
    boxSizing: "border-box",
    minWidth: 0, // ✅ важно: разрешаем строке сжиматься
  },

  title: {
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: -0.2,
    color: "#264653",
    minWidth: 0,
    overflow: "hidden",        // ✅
    textOverflow: "ellipsis",  // ✅
    whiteSpace: "nowrap",      // ✅
  },

  navBtn: {
  border: "1px solid rgba(38,70,83,0.18)",
  background: "rgba(255,255,255,0.78)",

  // ✅ ВОТ ЭТИ СТРОКИ ДЕЛАЮТ РАЗМЕР ОДИНАКОВЫМ
  width: 170,               // одинаковая ширина у всех
  height: 44,               // одинаковая высота у всех
  padding: "0 14px",        // убираем разную высоту из-за padding
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  lineHeight: 1,
  boxSizing: "border-box",
  whiteSpace: "nowrap",

  flexShrink: 0,       // ✅ чтобы кнопка не "ломалась"
  maxWidth: "48%",      // ✅ две кнопки в ряд не вылезут
  overflow: "hidden",   // ✅
  textOverflow: "ellipsis", // ✅ если текст слишком длинный

  borderRadius: 999,
  fontWeight: 650,
  cursor: "pointer",
  boxShadow: "0 6px 14px rgba(38,70,83,0.12)",
  color: "#264653",
  maxWidth: "100%",
},

  navBtnActive: {
    borderColor: "rgba(42,157,143,0.35)",
    background:
      "linear-gradient(180deg, rgba(42,157,143,0.98) 0%, rgba(38,70,83,0.98) 140%)",
    color: "#ffffff",
    boxShadow: "0 10px 22px rgba(42,157,143,0.20)",
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
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
    boxShadow: "0 6px 14px rgba(38,70,83,0.10)",
    color: "#264653",
    boxSizing: "border-box",
  },

  chipActive: {
    background:
      "linear-gradient(180deg, rgba(42,157,143,0.98) 0%, rgba(38,70,83,0.98) 140%)",
    color: "#ffffff",
    borderColor: "rgba(42,157,143,0.35)",
    boxShadow: "0 10px 22px rgba(42,157,143,0.18)",
  },

  info: { padding: 12, fontWeight: 650, color: "#264653" },
  infoMuted: { padding: 8, color: "rgba(38,70,83,0.82)", fontWeight: 550 },

  list: { display: "grid", gap: 12 },

  // фиксируем одинаковую “геометрию” карточки/картинки для всех категорий
  card: {
    background: "rgba(255,255,255,0.55)",
    borderRadius: 18,
    overflow: "hidden",
    boxShadow: "0 10px 22px rgba(38,70,83,0.14)",
    border: "1px solid rgba(38,70,83,0.10)",
    display: "grid",
    gridTemplateColumns: "110px 1fr",
    alignItems: "start",
    boxSizing: "border-box",
  },

  cardImg: {
    width: 110,
    height: 108,
    objectFit: "cover",
    display: "block",
    alignSelf: "start",
  },

  cardImgPlaceholder: {
    width: 110,
    height: 108,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(233,196,106,0.22)",
    color: "#264653",
    fontWeight: 650,
    boxSizing: "border-box",
    alignSelf: "start",
  },

  cardBody: {
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    boxSizing: "border-box",
  },

  cardName: {
    fontSize: 16,
    fontWeight: 650,
    lineHeight: 1.15,
    color: "#264653",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },

  // 5 строк описания
  cardDesc: {
    fontSize: 12,
    color: "rgba(38,70,83,0.80)",
    lineHeight: 1.25,
    fontWeight: 450,
    display: "-webkit-box",
    WebkitLineClamp: 5,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },

  cardMeta: { fontWeight: 550 },

  price: { color: "#2a9d8f", fontWeight: 700 },
  unit: { color: "rgba(38,70,83,0.85)", fontWeight: 500 },

  buyBtn: {
    marginTop: 4,
    background:
      "linear-gradient(180deg, rgba(42,157,143,1) 0%, rgba(38,70,83,1) 140%)",
    color: "#fff",
    border: "1px solid rgba(255,255,255,0.22)",
    borderRadius: 14,
    padding: "9px 12px",
    fontWeight: 650,
    cursor: "pointer",
    width: "fit-content",
    boxShadow: "0 10px 22px rgba(42,157,143,0.18)",
    boxSizing: "border-box",
  },

  qtyInline: { display: "flex", alignItems: "center", gap: 8, marginTop: 4 },

  panel: {
    background: "rgba(255,255,255,0.80)",
    borderRadius: 18,
    padding: 12,
    boxShadow: "0 10px 22px rgba(38,70,83,0.14)",
    border: "1px solid rgba(38,70,83,0.10)",
    boxSizing: "border-box",
  },

  cartRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 0",
    borderBottom: "1px solid rgba(38,70,83,0.10)",
  },

  cartName: { fontWeight: 650, color: "#264653" },
  cartMeta: { color: "rgba(38,70,83,0.80)", fontWeight: 450, fontSize: 13 },

  qtyBox: { display: "flex", alignItems: "center", gap: 6 },
  qtyBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    border: "1px solid rgba(38,70,83,0.16)",
    background: "rgba(255,255,255,0.82)",
    fontSize: 18,
    cursor: "pointer",
    boxShadow: "0 8px 16px rgba(38,70,83,0.10)",
    color: "#264653",
    boxSizing: "border-box",
  },

  qtyNum: {
    minWidth: 24,
    textAlign: "center",
    fontWeight: 650,
    color: "#264653",
  },

  cartSum: { width: 90, textAlign: "right", fontWeight: 650, color: "#264653" },

  removeBtn: {
    border: "1px solid rgba(231,111,81,0.55)",
    background: "rgba(231,111,81,0.16)",
    color: "#264653",
    borderRadius: 12,
    fontSize: 16,
    cursor: "pointer",
    padding: "6px 10px",
    boxShadow: "0 8px 14px rgba(231,111,81,0.14)",
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
    fontSize: 14,
    color: "#264653",
    fontWeight: 550,
  },

  totalRowBig: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 16,
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
    fontWeight: 650,
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
    fontWeight: 600,
    fontSize: 12,
    border: "1px solid rgba(244,162,97,0.55)",
    boxSizing: "border-box",
  },

  h2: { fontSize: 18, fontWeight: 650, marginBottom: 10, color: "#264653" },

  label: {
    display: "block",
    marginTop: 10,
    fontWeight: 600,
    fontSize: 14,
    color: "#264653",
  },

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
    boxShadow: "0 8px 14px rgba(38,70,83,0.08)",
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
    fontWeight: 650,
    cursor: "pointer",
    boxShadow: "0 12px 26px rgba(42,157,143,0.18)",
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
    fontWeight: 650,
    cursor: "pointer",
    boxShadow: "0 10px 22px rgba(244,162,97,0.14)",
    boxSizing: "border-box",
  },

  note: {
    marginTop: 10,
    fontSize: 12,
    color: "rgba(38,70,83,0.80)",
    fontWeight: 450,
  },

  floatingCart: {
    position: "fixed",
    left: "50%",
    transform: "translateX(-50%)",
    bottom: 16,
    zIndex: 9999,
    maxWidth: 520,
    width: "calc(100% - 32px)",
    boxSizing: "border-box",
    border: "1px solid rgba(38,70,83,0.16)",
    background:
      "linear-gradient(180deg, rgba(233,196,106,0.92) 0%, rgba(244,162,97,0.90) 100%)",
    color: "#264653",
    borderRadius: 999,
    padding: "12px 14px",
    fontWeight: 650,
    cursor: "pointer",
    boxShadow: "0 16px 32px rgba(38,70,83,0.18)",
  },

  // orders UI
  ordersHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 6,
  },

  refreshBtn: {
    border: "1px solid rgba(38,70,83,0.16)",
    background: "rgba(255,255,255,0.85)",
    borderRadius: 12,
    padding: "8px 10px",
    cursor: "pointer",
    fontWeight: 700,
    boxShadow: "0 8px 14px rgba(38,70,83,0.08)",
  },

  ordersList: {
    display: "grid",
    gap: 10,
    marginTop: 10,
  },

  orderCard: {
    background: "rgba(255,255,255,0.70)",
    border: "1px solid rgba(38,70,83,0.10)",
    borderRadius: 16,
    padding: 12,
    boxShadow: "0 10px 18px rgba(38,70,83,0.10)",
  },

  orderTop: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 8,
  },

  orderDate: {
    fontWeight: 650,
    color: "#264653",
  },

  orderStatus: {
    fontWeight: 650,
    color: "rgba(38,70,83,0.85)",
  },

  orderTotals: {
    display: "grid",
    gap: 6,
    paddingBottom: 8,
    borderBottom: "1px solid rgba(38,70,83,0.10)",
    marginBottom: 8,
  },

  orderRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    fontSize: 14,
    color: "#264653",
  },

  orderRowBig: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    fontSize: 15,
    color: "#264653",
    paddingTop: 6,
    marginTop: 2,
    borderTop: "1px dashed rgba(38,70,83,0.20)",
  },

  orderItems: {
    display: "grid",
    gap: 6,
  },

  orderItemRow: {
    display: "grid",
    gridTemplateColumns: "1fr auto auto",
    gap: 8,
    alignItems: "baseline",
  },

  orderItemName: {
    fontSize: 13,
    color: "rgba(38,70,83,0.90)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  orderItemQty: {
    fontSize: 13,
    color: "rgba(38,70,83,0.75)",
    fontWeight: 600,
  },

  orderItemSum: {
    fontSize: 13,
    color: "#264653",
    fontWeight: 650,
  },
};



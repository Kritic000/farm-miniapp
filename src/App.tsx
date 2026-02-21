import React, { useEffect, useMemo, useState } from "react";
import { API_URL } from "./config";

type Product = {
  id: string;
  category: string;
  name: string;
  unit: string;
  price: number;
  sort: number;
  image?: string; // например: "/images/milk.jpg"
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

export default function App() {
  // === ВАЖНО: токен должен совпадать с API_TOKEN в Apps Script ===
  const API_TOKEN = "Kjhytccb18@";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [products, setProducts] = useState<Product[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("Все");

  const [tab, setTab] = useState<"catalog" | "cart" | "checkout">("catalog");
  const [cart, setCart] = useState<Record<string, CartItem>>({});

  const [address, setAddress] = useState("");
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);

  // Telegram expand / theme
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

  // Load products
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError("");

        const url = `${API_URL}?action=products&ts=${Date.now()}`;
        const res = await fetch(url, { method: "GET" });
        const data = await res.json();

        if (data?.error) throw new Error(data.error);

        // Если хочешь фото — можно прописывать их здесь по id
        // либо добавить отдельную колонку image в Google Sheet и возвращать её из Apps Script
        const withImages: Product[] = (data.products || []).map((p: Product) => {
          // пример: если файл лежит public/images/milk.jpg
          if (p.id === "P001") return { ...p, image: "/images/milk.jpg" };
          return p;
        });

        setProducts(withImages);
      } catch (e: any) {
        setError(e?.message || "Ошибка загрузки товаров");
      } finally {
        setLoading(false);
      }
    })();
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

  const cartCount = useMemo(() => {
    return cartItems.reduce((s, it) => s + it.qty, 0);
  }, [cartItems]);

  const total = useMemo(() => {
    return cartItems.reduce((s, it) => s + it.qty * it.product.price, 0);
  }, [cartItems]);

  function addToCart(p: Product) {
    setCart((prev) => {
      const next = { ...prev };
      const cur = next[p.id];
      next[p.id] = { product: p, qty: (cur?.qty || 0) + 1 };
      return next;
    });
  }

  function setQty(productId: string, qty: number) {
    setCart((prev) => {
      const next = { ...prev };
      if (qty <= 0) delete next[productId];
      else next[productId] = { ...next[productId], qty };
      return next;
    });
  }

  async function submitOrder() {
    if (address.trim().length < 5) {
      alert("Укажи адрес доставки (минимум 5 символов).");
      return;
    }
    if (cartItems.length === 0) {
      alert("Корзина пустая.");
      return;
    }

    const tg = getTgUser();

    const payload = {
      token: API_TOKEN,
      tg: tg || {},
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

      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" }, // для Apps Script часто надёжнее text/plain
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      if (data?.error) throw new Error(data.error);

      alert("✅ Заказ отправлен! Мы свяжемся с вами для подтверждения.");
      setCart({});
      setAddress("");
      setComment("");
      setTab("catalog");
    } catch (e: any) {
      alert(`Не удалось отправить заказ: ${e?.message || "Ошибка"}`);
    } finally {
      setSending(false);
    }
  }

  // ===== UI =====
  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div style={styles.title}>Каталог</div>

        <div style={styles.tabs}>
          <button
            style={{ ...styles.tabBtn, ...(tab === "catalog" ? styles.tabActive : {}) }}
            onClick={() => setTab("catalog")}
          >
            Товары
          </button>

          <button
            style={{ ...styles.tabBtn, ...(tab === "cart" || tab === "checkout" ? styles.tabActive : {}) }}
            onClick={() => setTab("cart")}
          >
            🛒 Корзина ({cartCount})
          </button>
        </div>
      </div>

      {loading && <div style={styles.info}>Загрузка…</div>}
      {error && <div style={{ ...styles.info, color: "#b00020" }}>{error}</div>}

      {!loading && !error && (
        <>
          {tab === "catalog" && (
            <>
              {/* Категории */}
              <div style={styles.chipsRow}>
                {categories.map((c) => (
                  <button
                    key={c}
                    style={{ ...styles.chip, ...(activeCategory === c ? styles.chipActive : {}) }}
                    onClick={() => setActiveCategory(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>

              <div style={styles.list}>
                {filteredProducts.map((p) => (
                  <div key={p.id} style={styles.card}>
                    {p.image ? (
                      <img src={p.image} alt={p.name} style={styles.cardImg} />
                    ) : (
                      <div style={styles.cardImgPlaceholder}>Нет фото</div>
                    )}

                    <div style={styles.cardBody}>
                      <div style={styles.cardName}>{p.name}</div>
                      <div style={styles.cardMeta}>
                        {money(p.price)} ₽ / {p.unit}
                      </div>

                      <button style={styles.buyBtn} onClick={() => addToCart(p)}>
                        В корзину
                      </button>
                    </div>
                  </div>
                ))}
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

                  <div style={styles.totalRow}>
                    <div>Итого</div>
                    <div style={{ fontWeight: 800 }}>{money(total)} ₽</div>
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
                Адрес доставки <span style={{ color: "#b00020" }}>*</span>
              </label>
              <input
                style={styles.input}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Например: улица, дом, подъезд, этаж, кв."
              />

              <label style={styles.label}>Комментарий (необязательно)</label>
              <input
                style={styles.input}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Например: код домофона, удобное время"
              />

              <div style={styles.totalRow}>
                <div>Итого</div>
                <div style={{ fontWeight: 800 }}>{money(total)} ₽</div>
              </div>

              <button style={styles.primaryBtn} onClick={submitOrder} disabled={sending}>
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
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 },
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

  chipsRow: { display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8, marginBottom: 10 },
  chip: {
    border: "1px solid #d0d0d0",
    background: "#fff",
    padding: "8px 10px",
    borderRadius: 999,
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  chipActive: { background: "#1f7a1f", color: "#fff", borderColor: "#1f7a1f" },

  info: { padding: 12 },
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

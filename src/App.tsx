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

type CartItem = Product & { qty: number };

// --- Telegram helper (без telegram.ts) ---
function getTelegramUserSafe() {
  const w: any = window as any;
  const tg = w?.Telegram?.WebApp;

  // Если открыто внутри Telegram Mini App
  const user = tg?.initDataUnsafe?.user;
  if (user) {
    return {
      id: user.id,
      username: user.username || "",
      first_name: user.first_name || "",
      last_name: user.last_name || "",
      language_code: user.language_code || "",
    };
  }

  // Если открыто в браузере
  return {
    id: "",
    username: "",
    first_name: "",
    last_name: "",
    language_code: "",
  };
}

export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeCategory, setActiveCategory] = useState("Все");
  const [view, setView] = useState<"catalog" | "cart">("catalog");
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [comment, setComment] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}?action=products`, { method: "GET" });
        const data = await res.json();
        setProducts(Array.isArray(data.products) ? data.products : []);
      } catch (e) {
        setProducts([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const categories = useMemo(() => {
    const cats = Array.from(new Set(products.map((p) => p.category).filter(Boolean)));
    return ["Все", ...cats];
  }, [products]);

  const filtered = useMemo(() => {
    if (activeCategory === "Все") return products;
    return products.filter((p) => p.category === activeCategory);
  }, [products, activeCategory]);

  const cartCount = useMemo(() => cart.reduce((s, i) => s + i.qty, 0), [cart]);
  const total = useMemo(() => cart.reduce((sum, i) => sum + i.price * i.qty, 0), [cart]);

  const addToCart = (p: Product) => {
    setCart((prev) => {
      const found = prev.find((i) => i.id === p.id);
      if (found) {
        return prev.map((i) => (i.id === p.id ? { ...i, qty: i.qty + 1 } : i));
      }
      return [...prev, { ...p, qty: 1 }];
    });
  };

  const changeQty = (id: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) => (i.id === id ? { ...i, qty: i.qty + delta } : i))
        .filter((i) => i.qty > 0)
    );
  };

  const submitOrder = async () => {
    if (cart.length === 0) return alert("Корзина пустая.");

    if (name.trim().length < 2) return alert("Укажи имя (минимум 2 символа).");
    if (phone.trim().length < 6) return alert("Укажи корректный телефон.");
    if (address.trim().length < 5) return alert("Укажи адрес доставки.");

    try {
      const tg = getTelegramUserSafe();

      // Токен берём из ENV Vercel: VITE_API_TOKEN
      const token = (import.meta as any)?.env?.VITE_API_TOKEN || "";

      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          tg,
          clientName: name,
          clientPhone: phone,
          address,
          comment,
          items: cart.map((i) => ({
            id: i.id,
            name: i.name,
            qty: i.qty,
            price: i.price,
            unit: i.unit,
            category: i.category,
          })),
          total,
        }),
      });

      const data = await res.json();

      if (!data?.ok) {
        throw new Error(data?.error || "Не удалось отправить заказ");
      }

      alert("✅ Заказ отправлен!");
      setCart([]);
      setView("catalog");
      setName("");
      setPhone("");
      setAddress("");
      setComment("");
    } catch (e: any) {
      alert("Ошибка отправки: " + (e?.message || String(e)));
    }
  };

  return (
    <div style={styles.app}>
      <div style={styles.banner}>
        <div style={styles.bannerTitle}>Нашенское</div>
        <div style={styles.bannerSubtitle}>фермерские продукты</div>
      </div>

      <div style={styles.tabs}>
        <button style={view === "catalog" ? styles.tabActive : styles.tab} onClick={() => setView("catalog")}>
          Товары
        </button>
        <button style={view === "cart" ? styles.tabActive : styles.tab} onClick={() => setView("cart")}>
          🛒 Корзина ({cartCount})
        </button>
      </div>

      {view === "catalog" && (
        <>
          <div style={styles.categories}>
            {categories.map((cat) => (
              <button
                key={cat}
                style={activeCategory === cat ? styles.chipActive : styles.chip}
                onClick={() => setActiveCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          {loading && <div style={{ padding: 12 }}>Загрузка...</div>}

          {!loading &&
            filtered.map((p) => {
              const inCart = cart.find((i) => i.id === p.id);

              return (
                <div key={p.id} style={styles.card}>
                  <div style={styles.cardRow}>
                    <div style={styles.imageBox}>
                      {p.image ? (
                        <img src={p.image} alt={p.name} style={styles.image} />
                      ) : (
                        <div style={styles.noPhoto}>
                          <div style={{ fontSize: 28 }}>🖼️</div>
                          <div>Нет фото</div>
                        </div>
                      )}
                    </div>

                    <div style={styles.cardInfo}>
                      <div style={styles.name}>{p.name}</div>

                      {p.description ? <div style={styles.desc}>{p.description}</div> : null}

                      <div style={styles.price}>
                        {p.price} ₽ / {p.unit}
                      </div>

                      {!inCart ? (
                        <button style={styles.btn} onClick={() => addToCart(p)}>
                          🛒 В корзину
                        </button>
                      ) : (
                        <div style={styles.qtyBox}>
                          <button style={styles.qtyBtn} onClick={() => changeQty(p.id, -1)}>
                            −
                          </button>
                          <span style={styles.qtyNum}>{inCart.qty}</span>
                          <button style={styles.qtyBtn} onClick={() => changeQty(p.id, 1)}>
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
        </>
      )}

      {view === "cart" && (
        <div style={styles.checkout}>
          <h3 style={{ margin: "6px 0 12px" }}>Оформление</h3>

          <label style={styles.label}>Имя *</label>
          <input style={styles.input} placeholder="Как к вам обращаться?" value={name} onChange={(e) => setName(e.target.value)} />

          <label style={styles.label}>Телефон *</label>
          <input style={styles.input} placeholder="+7..." value={phone} onChange={(e) => setPhone(e.target.value)} />

          <label style={styles.label}>Адрес доставки *</label>
          <input
            style={styles.input}
            placeholder="улица, дом, подъезд, этаж, кв."
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />

          <label style={styles.label}>Комментарий (необязательно)</label>
          <textarea
            style={styles.textarea}
            placeholder="код домофона, удобное время"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />

          <div style={styles.totalRow}>
            <div>Итого</div>
            <div style={{ fontWeight: 800 }}>{total} ₽</div>
          </div>

          <button style={styles.submit} onClick={submitOrder}>
            Подтвердить заказ
          </button>

          <div style={styles.note}>Оплата пока не принимается в приложении — мы свяжемся после оформления.</div>
        </div>
      )}
    </div>
  );
}

const styles: any = {
  app: {
    maxWidth: 520,
    margin: "0 auto",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
    background: "#eef2f5",
    minHeight: "100vh",
  },
  banner: {
    padding: 18,
    background: "linear-gradient(135deg,#7bbf34,#2f7d22)",
    color: "white",
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
  },
  bannerTitle: { fontSize: 34, fontWeight: 900, letterSpacing: 0.2 },
  bannerSubtitle: { opacity: 0.95, marginTop: 2 },

  tabs: { display: "flex", padding: 12, gap: 10 },
  tab: {
    flex: 1,
    padding: 12,
    borderRadius: 14,
    border: "1px solid rgba(0,0,0,0.12)",
    background: "#fff",
    fontWeight: 700,
  },
  tabActive: {
    flex: 1,
    padding: 12,
    borderRadius: 14,
    border: "1px solid rgba(0,0,0,0.06)",
    background: "#dff2d8",
    fontWeight: 900,
  },

  categories: { display: "flex", gap: 10, padding: "0 12px 12px", flexWrap: "wrap" },
  chip: {
    padding: "10px 14px",
    borderRadius: 22,
    border: "1px solid rgba(0,0,0,0.12)",
    background: "#fff",
    fontWeight: 800,
  },
  chipActive: {
    padding: "10px 14px",
    borderRadius: 22,
    border: "1px solid rgba(0,0,0,0.06)",
    background: "#2f7d22",
    color: "#fff",
    fontWeight: 900,
  },

  card: {
    background: "#fff",
    margin: "10px 12px",
    padding: 14,
    borderRadius: 20,
    boxShadow: "0 10px 24px rgba(0,0,0,0.06)",
  },
  cardRow: { display: "flex", gap: 14, alignItems: "stretch" },
  imageBox: {
    width: 120,
    minWidth: 120,
    height: 120,
    borderRadius: 16,
    overflow: "hidden",
    background: "#f1f3f6",
    border: "1px solid rgba(0,0,0,0.06)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  image: { width: "100%", height: "100%", objectFit: "cover" },
  noPhoto: { color: "#7a8795", textAlign: "center", fontWeight: 700, lineHeight: 1.2 },

  cardInfo: { flex: 1, display: "flex", flexDirection: "column", gap: 6 },
  name: { fontWeight: 1000, fontSize: 22, lineHeight: 1.15 },
  desc: { color: "#586575", fontWeight: 650, fontSize: 13, lineHeight: 1.2 },
  price: { color: "#e67e22", fontWeight: 900, fontSize: 20 },

  btn: {
    marginTop: 6,
    background: "linear-gradient(180deg,#3aa22c,#226a1c)",
    color: "#fff",
    padding: "12px 14px",
    borderRadius: 14,
    border: "none",
    fontWeight: 900,
    width: 180,
  },

  qtyBox: { display: "flex", gap: 10, alignItems: "center", marginTop: 6 },
  qtyBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.12)",
    background: "#fff",
    fontSize: 20,
    fontWeight: 900,
  },
  qtyNum: { minWidth: 24, textAlign: "center", fontWeight: 900, fontSize: 18 },

  checkout: {
    margin: 12,
    background: "#fff",
    borderRadius: 20,
    padding: 14,
    boxShadow: "0 10px 24px rgba(0,0,0,0.06)",
  },
  label: { display: "block", fontWeight: 900, marginTop: 10, marginBottom: 6 },
  input: {
    width: "100%",
    padding: 12,
    borderRadius: 14,
    border: "1px solid rgba(0,0,0,0.12)",
    outline: "none",
    fontSize: 16,
  },
  textarea: {
    width: "100%",
    padding: 12,
    borderRadius: 14,
    border: "1px solid rgba(0,0,0,0.12)",
    outline: "none",
    fontSize: 16,
    minHeight: 92,
    resize: "vertical",
  },
  totalRow: { display: "flex", justifyContent: "space-between", marginTop: 14, fontSize: 18 },
  submit: {
    marginTop: 12,
    width: "100%",
    padding: 14,
    borderRadius: 16,
    background: "linear-gradient(180deg,#3aa22c,#226a1c)",
    color: "#fff",
    border: "none",
    fontWeight: 1000,
    fontSize: 16,
  },
  note: { marginTop: 10, color: "#5d6a79", fontWeight: 650, fontSize: 12 },
};

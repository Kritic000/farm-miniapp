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

const DELIVERY_FEE = 200;
const FREE_DELIVERY_FROM = 2000;

export default function App() {
  const API_TOKEN = "Kjhytccb18@";

  const [products, setProducts] = useState<Product[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("Все");
  const [tab, setTab] = useState<"catalog" | "cart" | "checkout">("catalog");

  const [cart, setCart] = useState<Record<string, CartItem>>({});

  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [comment, setComment] = useState("");

  const [toast, setToast] = useState<Toast>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    loadProducts();
  }, []);

  async function loadProducts() {
    try {
      const res = await fetch(`${API_URL}?action=products`);
      const data = await res.json();
      setProducts(data.products || []);
    } catch {
      setToast({ type: "error", text: "Ошибка загрузки товаров" });
    } finally {
      setLoading(false);
    }
  }

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => set.add(p.category));
    return ["Все", ...Array.from(set)];
  }, [products]);

  const filteredProducts =
    activeCategory === "Все"
      ? products
      : products.filter((p) => p.category === activeCategory);

  const cartItems = Object.values(cart);

  const cartCount = cartItems.reduce((s, it) => s + it.qty, 0);

  const total = cartItems.reduce(
    (s, it) => s + it.qty * it.product.price,
    0
  );

  const delivery =
    total > 0 && total < FREE_DELIVERY_FROM ? DELIVERY_FEE : 0;

  const grandTotal = total + delivery;

  function addToCart(p: Product) {
    setCart((prev) => {
      const next = { ...prev };
      const cur = next[p.id];
      next[p.id] = { product: p, qty: (cur?.qty || 0) + 1 };
      return next;
    });
  }

  function setQty(id: string, qty: number) {
    setCart((prev) => {
      const next = { ...prev };
      if (qty <= 0) delete next[id];
      else next[id] = { ...next[id], qty };
      return next;
    });
  }

  function validate(): string | null {
    if (customerName.length < 2) return "Введите имя";
    if (phone.length < 6) return "Введите телефон";
    if (address.length < 5) return "Введите адрес";
    if (!cartItems.length) return "Корзина пустая";
    return null;
  }

  async function submitOrder() {
    const error = validate();
    if (error) {
      setToast({ type: "error", text: error });
      return;
    }

    try {
      setSending(true);

      await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({
          token: API_TOKEN,
          name: customerName,
          phone,
          address,
          comment,
          items: cartItems,
          total,
          delivery,
          grandTotal,
        }),
      });

      setToast({
        type: "success",
        text: "Заказ отправлен! Мы свяжемся с вами.",
      });

      setCart({});
      setTab("catalog");
      setCustomerName("");
      setPhone("");
      setAddress("");
      setComment("");
    } catch {
      setToast({ type: "error", text: "Ошибка отправки заказа" });
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={styles.page}>
      {toast && (
        <div style={styles.toast}>{toast.text}</div>
      )}

      <div style={styles.container}>
        <div style={styles.header}>
          <div style={styles.title}>Нашенское</div>

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
                ...(tab !== "catalog" ? styles.tabActive : {}),
              }}
              onClick={() => setTab("cart")}
            >
              Корзина ({cartCount})
            </button>
          </div>
        </div>

        {loading && <div>Загрузка...</div>}

        {!loading && tab === "catalog" && (
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

            {filteredProducts.map((p) => {
              const qty = cart[p.id]?.qty || 0;

              return (
                <div key={p.id} style={styles.card}>
                  <div style={styles.cardBody}>
                    <div style={styles.cardName}>{p.name}</div>

                    <div style={styles.priceRow}>
                      <span style={styles.price}>
                        {money(p.price)} ₽
                      </span>
                      <span> / {p.unit}</span>
                    </div>

                    {qty === 0 ? (
                      <button
                        style={styles.buyBtn}
                        onClick={() => addToCart(p)}
                      >
                        В корзину
                      </button>
                    ) : (
                      <div style={styles.qtyBox}>
                        <button
                          style={styles.qtyBtn}
                          onClick={() => setQty(p.id, qty - 1)}
                        >
                          −
                        </button>
                        <div>{qty}</div>
                        <button
                          style={styles.qtyBtn}
                          onClick={() => setQty(p.id, qty + 1)}
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {tab === "cart" && (
          <div style={styles.panel}>
            {cartItems.map((it) => (
              <div key={it.product.id}>
                {it.product.name} — {money(it.product.price)} ₽
              </div>
            ))}

            <div style={styles.total}>
              Итого: {money(grandTotal)} ₽
            </div>

            <button
              style={styles.primaryBtn}
              onClick={() => setTab("checkout")}
            >
              Оформить
            </button>
          </div>
        )}

        {tab === "checkout" && (
          <div style={styles.panel}>
            <div style={styles.h2}>Оформление</div>

            <label style={styles.label}>Имя *</label>
            <input
              style={styles.input}
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
            />

            <label style={styles.label}>Телефон *</label>
            <input
              style={styles.input}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />

            <label style={styles.label}>Адрес *</label>
            <input
              style={styles.input}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />

            <label style={styles.label}>Комментарий</label>
            <input
              style={styles.input}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />

            <div style={styles.total}>
              Итого: {money(grandTotal)} ₽
            </div>

            <button
              style={styles.primaryBtn}
              onClick={submitOrder}
              disabled={sending}
            >
              Подтвердить заказ
            </button>

            <button
              style={styles.secondaryBtn}
              onClick={() => setTab("cart")}
            >
              Назад
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    fontFamily: "system-ui",
    padding: 16,
    minHeight: "100vh",
    boxSizing: "border-box",
    background:
      "linear-gradient(rgba(255,255,255,0.3), rgba(255,255,255,0.5)), url('/images/bg-farm.png')",
    backgroundSize: "cover",
  },

  container: {
    maxWidth: 520,
    width: "100%",
    margin: "0 auto",
    background: "rgba(255,255,255,0.6)",
    borderRadius: 20,
    padding: 12,
    boxSizing: "border-box",
  },

  header: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: 12,
  },

  title: {
    fontSize: 26,
    fontWeight: 900,
  },

  tabs: { display: "flex", gap: 8 },

  tabBtn: {
    padding: "8px 14px",
    borderRadius: 999,
    border: "1px solid #264653",
    background: "#fff",
    cursor: "pointer",
  },

  tabActive: {
    background: "#2a9d8f",
    color: "#fff",
  },

  chipsRow: {
    display: "flex",
    gap: 8,
    overflowX: "auto",
    marginBottom: 12,
  },

  chip: {
    padding: "6px 12px",
    borderRadius: 999,
    border: "1px solid #264653",
    background: "#fff",
  },

  chipActive: {
    background: "#2a9d8f",
    color: "#fff",
  },

  card: {
    background: "#fff",
    padding: 12,
    borderRadius: 16,
    marginBottom: 10,
    boxSizing: "border-box",
  },

  cardBody: { display: "flex", flexDirection: "column", gap: 6 },

  cardName: { fontWeight: 700 },

  priceRow: { display: "flex", gap: 6 },

  price: { color: "#2a9d8f", fontWeight: 700 },

  buyBtn: {
    marginTop: 6,
    padding: "8px 12px",
    background: "#2a9d8f",
    color: "#fff",
    border: "none",
    borderRadius: 12,
  },

  qtyBox: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },

  qtyBtn: {
    padding: "4px 8px",
  },

  panel: {
    background: "#fff",
    padding: 12,
    borderRadius: 16,
    boxSizing: "border-box",
  },

  total: {
    marginTop: 12,
    fontWeight: 700,
  },

  primaryBtn: {
    marginTop: 12,
    padding: 10,
    background: "#2a9d8f",
    color: "#fff",
    border: "none",
    borderRadius: 14,
  },

  secondaryBtn: {
    marginTop: 8,
    padding: 10,
    background: "#eee",
    borderRadius: 14,
  },

  h2: { fontSize: 18, fontWeight: 700 },

  label: { marginTop: 10, fontWeight: 600 },

  input: {
    width: "100%",
    padding: 10,
    marginTop: 4,
    borderRadius: 12,
    border: "1px solid #ccc",
    boxSizing: "border-box",
  },

  toast: {
    background: "#2a9d8f",
    color: "#fff",
    padding: 10,
    borderRadius: 10,
    marginBottom: 10,
  },
};

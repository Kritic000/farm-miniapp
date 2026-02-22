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

function money(n: number) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(n));
}

export default function App() {
  const API_TOKEN = "Kjhytccb18@";

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState("Все");
  const [tab, setTab] = useState<"catalog" | "cart">("catalog");
  const [cart, setCart] = useState<Record<string, CartItem>>({});

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_URL}?action=products`);
        const data = await res.json();
        setProducts(data.products || []);
      } catch {
        alert("Ошибка загрузки");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => set.add(p.category));
    return ["Все", ...Array.from(set)];
  }, [products]);

  const filtered = useMemo(() => {
    if (activeCategory === "Все") return products;
    return products.filter((p) => p.category === activeCategory);
  }, [products, activeCategory]);

  const cartItems = Object.values(cart);
  const subtotal = cartItems.reduce(
    (s, it) => s + it.qty * it.product.price,
    0
  );

  const delivery = subtotal > 0 && subtotal < 2000 ? 200 : 0;
  const total = subtotal + delivery;

  function add(p: Product) {
    setCart((prev) => {
      const next = { ...prev };
      const cur = next[p.id];
      next[p.id] = { product: p, qty: (cur?.qty || 0) + 1 };
      return next;
    });
  }

  function changeQty(id: string, qty: number) {
    setCart((prev) => {
      const next = { ...prev };
      if (qty <= 0) delete next[id];
      else next[id] = { ...next[id], qty };
      return next;
    });
  }

  return (
    <div style={styles.page}>
      <div style={styles.container}>
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
                ...(tab === "cart" ? styles.tabActive : {}),
              }}
              onClick={() => setTab("cart")}
            >
              🛒 Корзина ({cartItems.length})
            </button>
          </div>
        </div>

        {loading && <div>Загрузка...</div>}

        {!loading && tab === "catalog" && (
          <>
            <div style={styles.chips}>
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

            {filtered.map((p) => (
              <div key={p.id} style={styles.card}>
                <div style={styles.cardBody}>
                  <div style={styles.cardName}>{p.name}</div>
                  <div style={styles.price}>
                    {money(p.price)} ₽ / {p.unit}
                  </div>
                  <button style={styles.buyBtn} onClick={() => add(p)}>
                    В корзину
                  </button>
                </div>
              </div>
            ))}
          </>
        )}

        {!loading && tab === "cart" && (
          <>
            {cartItems.map((it) => (
              <div key={it.product.id} style={styles.cartRow}>
                <div style={{ flex: 1 }}>{it.product.name}</div>
                <div>
                  <button
                    style={styles.qtyBtn}
                    onClick={() =>
                      changeQty(it.product.id, it.qty - 1)
                    }
                  >
                    −
                  </button>
                  {it.qty}
                  <button
                    style={styles.qtyBtn}
                    onClick={() =>
                      changeQty(it.product.id, it.qty + 1)
                    }
                  >
                    +
                  </button>
                </div>
              </div>
            ))}

            <div style={styles.totalBox}>
              <div>Товары: {money(subtotal)} ₽</div>
              {delivery > 0 && (
                <div>Доставка: {money(delivery)} ₽</div>
              )}
              <div style={{ fontWeight: 800 }}>
                Итого: {money(total)} ₽
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    padding: 16,
    backgroundImage:
      "linear-gradient(rgba(255,255,255,0.55), rgba(255,255,255,0.85)), url('/images/bg-farm.png')",
    backgroundSize: "cover",
    backgroundPosition: "center top",
    backgroundRepeat: "no-repeat",
  },

  container: {
    maxWidth: 520,
    margin: "0 auto",
    background: "rgba(255,255,255,0.9)",
    borderRadius: 22,
    padding: 16,
    boxShadow: "0 20px 40px rgba(0,0,0,0.15)",
  },

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },

  title: {
    fontSize: 32,
    fontWeight: 900,
  },

  tabs: { display: "flex", gap: 8 },

  tabBtn: {
    borderRadius: 999,
    padding: "10px 14px",
    border: "1px solid #ddd",
    background: "#fff",
    cursor: "pointer",
    fontWeight: 700,
  },

  tabActive: {
    background: "linear-gradient(180deg,#2fbc2f,#1f7a1f)",
    color: "#fff",
  },

  chips: {
    display: "flex",
    gap: 8,
    marginBottom: 12,
    overflowX: "auto",
  },

  chip: {
    borderRadius: 999,
    padding: "8px 12px",
    border: "1px solid #ddd",
    background: "#fff",
    cursor: "pointer",
    fontWeight: 700,
  },

  chipActive: {
    background: "#1f7a1f",
    color: "#fff",
  },

  card: {
    background: "#fff",
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    boxShadow: "0 10px 20px rgba(0,0,0,0.08)",
  },

  cardBody: { display: "flex", flexDirection: "column", gap: 8 },

  cardName: { fontWeight: 900 },

  price: { fontWeight: 700 },

  buyBtn: {
    background: "linear-gradient(180deg,#2fbc2f,#1f7a1f)",
    color: "#fff",
    border: 0,
    borderRadius: 14,
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: 800,
  },

  cartRow: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: 8,
  },

  qtyBtn: {
    margin: "0 6px",
    borderRadius: 8,
    border: "1px solid #ccc",
    padding: "2px 8px",
    cursor: "pointer",
  },

  totalBox: {
    marginTop: 16,
    paddingTop: 10,
    borderTop: "1px solid #ddd",
  },
};

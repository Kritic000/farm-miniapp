import React, { useEffect, useMemo, useState } from "react";
import { API_URL } from "./config";
import { getTelegramUser } from "./telegram";

type Product = {
  id: string;
  category: string;
  name: string;
  unit: string;
  price: number;
  sort: number;
  description?: string;
};

type CartItem = Product & { qty: number };

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
    fetch(`${API_URL}?action=products`)
      .then(res => res.json())
      .then(data => {
        setProducts(data.products || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const categories = useMemo(() => {
    const cats = Array.from(new Set(products.map(p => p.category)));
    return ["Все", ...cats];
  }, [products]);

  const filtered = useMemo(() => {
    if (activeCategory === "Все") return products;
    return products.filter(p => p.category === activeCategory);
  }, [products, activeCategory]);

  const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0);

  const addToCart = (p: Product) => {
    setCart(prev => {
      const found = prev.find(i => i.id === p.id);
      if (found) {
        return prev.map(i =>
          i.id === p.id ? { ...i, qty: i.qty + 1 } : i
        );
      }
      return [...prev, { ...p, qty: 1 }];
    });
  };

  const changeQty = (id: string, delta: number) => {
    setCart(prev =>
      prev
        .map(i =>
          i.id === id ? { ...i, qty: i.qty + delta } : i
        )
        .filter(i => i.qty > 0)
    );
  };

  const submitOrder = async () => {
    if (name.trim().length < 2) {
      alert("Укажи имя (минимум 2 символа).");
      return;
    }
    if (phone.trim().length < 6) {
      alert("Укажи корректный телефон.");
      return;
    }
    if (address.trim().length < 5) {
      alert("Укажи адрес доставки.");
      return;
    }

    try {
      const tg = getTelegramUser();

      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: import.meta.env.VITE_API_TOKEN,
          tg,
          name,
          phone,
          address,
          comment,
          items: cart,
          total
        })
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Ошибка");

      alert("Заказ отправлен!");
      setCart([]);
      setView("catalog");
      setName("");
      setPhone("");
      setAddress("");
      setComment("");
    } catch (e: any) {
      alert("Ошибка отправки: " + e.message);
    }
  };

  return (
    <div style={styles.app}>
      <div style={styles.banner}>
        <div style={styles.bannerTitle}>Нашенское</div>
        <div style={styles.bannerSubtitle}>фермерские продукты</div>
      </div>

      <div style={styles.tabs}>
        <button
          style={view === "catalog" ? styles.tabActive : styles.tab}
          onClick={() => setView("catalog")}
        >
          Товары
        </button>
        <button
          style={view === "cart" ? styles.tabActive : styles.tab}
          onClick={() => setView("cart")}
        >
          🛒 Корзина ({cart.length})
        </button>
      </div>

      {view === "catalog" && (
        <>
          <div style={styles.categories}>
            {categories.map(cat => (
              <button
                key={cat}
                style={
                  activeCategory === cat
                    ? styles.chipActive
                    : styles.chip
                }
                onClick={() => setActiveCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          {loading && <div>Загрузка...</div>}

          {!loading &&
            filtered.map(p => {
              const inCart = cart.find(i => i.id === p.id);
              return (
                <div key={p.id} style={styles.card}>
                  <div style={styles.cardInfo}>
                    <div style={styles.name}>{p.name}</div>
                    <div style={styles.price}>
                      {p.price} ₽ / {p.unit}
                    </div>

                    {!inCart ? (
                      <button
                        style={styles.btn}
                        onClick={() => addToCart(p)}
                      >
                        В корзину
                      </button>
                    ) : (
                      <div style={styles.qtyBox}>
                        <button onClick={() => changeQty(p.id, -1)}>
                          −
                        </button>
                        <span>{inCart.qty}</span>
                        <button onClick={() => changeQty(p.id, 1)}>
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

      {view === "cart" && (
        <div style={styles.checkout}>
          <h3>Оформление</h3>

          <input
            placeholder="Имя"
            value={name}
            onChange={e => setName(e.target.value)}
          />
          <input
            placeholder="Телефон"
            value={phone}
            onChange={e => setPhone(e.target.value)}
          />
          <input
            placeholder="Адрес"
            value={address}
            onChange={e => setAddress(e.target.value)}
          />
          <textarea
            placeholder="Комментарий"
            value={comment}
            onChange={e => setComment(e.target.value)}
          />

          <div style={{ marginTop: 12, fontWeight: 700 }}>
            Итого: {total} ₽
          </div>

          <button style={styles.submit} onClick={submitOrder}>
            Подтвердить заказ
          </button>
        </div>
      )}
    </div>
  );
}

const styles: any = {
  app: {
    maxWidth: 480,
    margin: "0 auto",
    fontFamily: "sans-serif",
    background: "#f2f4f7",
    minHeight: "100vh"
  },
  banner: {
    padding: 20,
    background: "linear-gradient(135deg,#5da92f,#3e7c1f)",
    color: "white"
  },
  bannerTitle: { fontSize: 28, fontWeight: 700 },
  bannerSubtitle: { opacity: 0.9 },
  tabs: { display: "flex", padding: 12, gap: 8 },
  tab: {
    flex: 1,
    padding: 10,
    borderRadius: 10,
    border: "1px solid #ccc",
    background: "#fff"
  },
  tabActive: {
    flex: 1,
    padding: 10,
    borderRadius: 10,
    border: "none",
    background: "#3e7c1f",
    color: "#fff"
  },
  categories: { display: "flex", gap: 8, padding: 12, flexWrap: "wrap" },
  chip: {
    padding: "6px 12px",
    borderRadius: 20,
    border: "1px solid #ccc",
    background: "#fff"
  },
  chipActive: {
    padding: "6px 12px",
    borderRadius: 20,
    border: "none",
    background: "#3e7c1f",
    color: "#fff"
  },
  card: {
    background: "#fff",
    margin: 12,
    padding: 16,
    borderRadius: 16
  },
  cardInfo: { display: "flex", flexDirection: "column", gap: 8 },
  name: { fontWeight: 700 },
  price: { color: "#e67e22", fontWeight: 600 },
  btn: {
    background: "#3e7c1f",
    color: "#fff",
    padding: 10,
    borderRadius: 10,
    border: "none"
  },
  qtyBox: {
    display: "flex",
    gap: 10,
    alignItems: "center"
  },
  checkout: { padding: 16 },
  submit: {
    marginTop: 16,
    width: "100%",
    padding: 12,
    borderRadius: 12,
    background: "#3e7c1f",
    color: "#fff",
    border: "none"
  }
};

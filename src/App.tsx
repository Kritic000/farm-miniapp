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
  image?: string;
};

type CartItem = {
  id: string;
  name: string;
  unit: string;
  price: number;
  qty: number;
};

const API_TOKEN = "Kjhytccb18@"; // <-- ДОЛЖЕН совпадать с API_TOKEN в Apps Script

function rub(n: number) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(n)) + " ₽";
}

function isTelegramWebAppLocal() {
  return typeof (window as any).Telegram?.WebApp !== "undefined";
}

export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState<"products" | "cart" | "checkout">("products");

  const [cart, setCart] = useState<Record<string, CartItem>>({});
  const cartCount = useMemo(
    () => Object.values(cart).reduce((s, it) => s + it.qty, 0),
    [cart]
  );
  const total = useMemo(
    () => Object.values(cart).reduce((s, it) => s + it.qty * it.price, 0),
    [cart]
  );

  const [address, setAddress] = useState("");
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    // Подстроимся под Telegram WebApp (если открыто внутри Telegram)
    if (isTelegramWebAppLocal()) {
      const tg = (window as any).Telegram?.WebApp;
      tg?.ready?.();
      tg?.expand?.();
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const res = await fetch(`${API_URL}?action=products`, {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        const data = await res.json();
        setProducts(Array.isArray(data.products) ? data.products : []);
      } catch (e) {
        console.error(e);
        alert("Не удалось загрузить товары");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function addToCart(p: Product) {
    setCart((prev) => {
      const next = { ...prev };
      const existing = next[p.id];
      next[p.id] = existing
        ? { ...existing, qty: existing.qty + 1 }
        : { id: p.id, name: p.name, unit: p.unit, price: p.price, qty: 1 };
      return next;
    });
  }

  function inc(id: string) {
    setCart((prev) => {
      const it = prev[id];
      if (!it) return prev;
      return { ...prev, [id]: { ...it, qty: it.qty + 1 } };
    });
  }

  function dec(id: string) {
    setCart((prev) => {
      const it = prev[id];
      if (!it) return prev;
      const next = { ...prev };
      if (it.qty <= 1) delete next[id];
      else next[id] = { ...it, qty: it.qty - 1 };
      return next;
    });
  }

  function remove(id: string) {
    setCart((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  async function submitOrder() {
    try {
      if (address.trim().length < 5) {
        alert("Введите адрес доставки");
        return;
      }
      if (cartCount === 0) {
        alert("Корзина пустая");
        return;
      }

      setSending(true);

      // Важно: твой telegram.ts должен возвращать объект пользователя или {}
      const telegram = getTelegramUser?.() || {};

      const items = Object.values(cart).map((it) => ({
        id: it.id,
        name: it.name,
        unit: it.unit,
        price: it.price,
        qty: it.qty,
        sum: it.price * it.qty,
      }));

      // Твой Apps Script ждёт body.tg (а не telegram) — поэтому отправляем tg
      const payload = {
        token: API_TOKEN,
        tg: telegram,
        address: address.trim(),
        comment: comment.trim(),
        items,
        total,
      };

      const res = await fetch(`${API_URL}?action=order`, {
        method: "POST",
        headers: {
          // Для Apps Script часто лучше text/plain, чем application/json
          "Content-Type": "text/plain;charset=UTF-8",
          Accept: "application/json",
          "X-Api-Token": API_TOKEN,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.ok) {
        const msg = data?.error ? String(data.error) : `HTTP ${res.status}`;
        throw new Error(msg);
      }

      alert("Заказ отправлен!");

      setCart({});
      setAddress("");
      setComment("");
      setTab("products");
    } catch (e: any) {
      console.error(e);
      alert(`Не удалось отправить заказ: ${e?.message || e}`);
    } finally {
      setSending(false);
    }
  }

  const categories = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of products) {
      const c = p.category || "Другое";
      if (!map.has(c)) map.set(c, []);
      map.get(c)!.push(p);
    }
    return Array.from(map.entries()).map(([name, list]) => ({
      name,
      list: list
        .slice()
        .sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name)),
    }));
  }, [products]);

  return (
    <div style={styles.page}>
      <div style={styles.headerRow}>
        <h1 style={styles.h1}>Каталог</h1>
        <div style={styles.tabs}>
          <button
            style={{ ...styles.tabBtn, ...(tab === "products" ? styles.tabBtnActive : {}) }}
            onClick={() => setTab("products")}
          >
            Товары
          </button>
          <button
            style={{ ...styles.tabBtn, ...(tab !== "products" ? styles.tabBtnActive : {}) }}
            onClick={() => setTab("cart")}
          >
            🛒 Корзина ({cartCount})
          </button>
        </div>
      </div>

      {loading && <div style={styles.muted}>Загрузка…</div>}

      {!loading && tab === "products" && (
        <div style={{ display: "grid", gap: 14 }}>
          {categories.map((c) => (
            <div key={c.name}>
              <div style={styles.catTitle}>{c.name}</div>
              <div style={{ display: "grid", gap: 12 }}>
                {c.list.map((p) => (
                  <div key={p.id} style={styles.card}>
                    {p.image ? (
                      <img
                        src={p.image}
                        alt={p.name}
                        style={styles.cardImg}
                        onError={(ev) => {
                          (ev.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : null}

                    <div style={{ display: "grid", gap: 8 }}>
                      <div style={styles.cardTitle}>{p.name}</div>
                      <div style={styles.cardSub}>
                        {rub(p.price)} / {p.unit}
                      </div>

                      <button style={styles.primaryBtn} onClick={() => addToCart(p)}>
                        В корзину
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === "cart" && (
        <div style={{ display: "grid", gap: 12 }}>
          {cartCount === 0 ? (
            <div style={styles.muted}>Корзина пустая</div>
          ) : (
            <>
              <div style={{ display: "grid", gap: 10 }}>
                {Object.values(cart).map((it) => (
                  <div key={it.id} style={styles.cartRow}>
                    <div style={{ minWidth: 0 }}>
                      <div style={styles.cartName}>{it.name}</div>
                      <div style={styles.muted}>
                        {rub(it.price)} / {it.unit}
                      </div>
                    </div>

                    <div style={styles.qty}>
                      <button style={styles.qtyBtn} onClick={() => dec(it.id)}>
                        −
                      </button>
                      <div style={styles.qtyVal}>{it.qty}</div>
                      <button style={styles.qtyBtn} onClick={() => inc(it.id)}>
                        +
                      </button>
                    </div>

                    <div style={styles.cartSum}>{rub(it.qty * it.price)}</div>

                    <button style={styles.linkBtn} onClick={() => remove(it.id)}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <div style={styles.totalRow}>
                <div style={{ fontWeight: 800 }}>Итого</div>
                <div style={{ fontWeight: 800 }}>{rub(total)}</div>
              </div>

              <button style={styles.primaryBtn} onClick={() => setTab("checkout")}>
                Оформить заказ
              </button>

              <button style={styles.ghostBtn} onClick={() => setTab("products")}>
                Назад к товарам
              </button>
            </>
          )}
        </div>
      )}

      {!loading && tab === "checkout" && (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={styles.checkoutCard}>
            <div style={styles.checkoutTitle}>Оформление</div>

            <label style={styles.label}>
              Адрес доставки <span style={{ color: "#c33" }}>*</span>
              <input
                style={styles.input}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Например: ул. Ленина 10, кв 20"
              />
            </label>

            <label style={styles.label}>
              Комментарий (необязательно)
              <input
                style={styles.input}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Например: код домофона, удобное время"
              />
            </label>

            <div style={styles.totalRow}>
              <div style={{ fontWeight: 800 }}>Итого</div>
              <div style={{ fontWeight: 800 }}>{rub(total)}</div>
            </div>

            <button style={styles.primaryBtn} onClick={submitOrder} disabled={sending}>
              {sending ? "Отправляем…" : "Подтвердить заказ"}
            </button>

            <button style={styles.ghostBtn} onClick={() => setTab("cart")} disabled={sending}>
              Назад в корзину
            </button>

            <div style={styles.help}>
              Оплата пока не принимается в приложении — мы свяжемся после оформления.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    padding: 16,
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
    background: "#f4f6f5",
    minHeight: "100vh",
    color: "#111",
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    justifyContent: "space-between",
    marginBottom: 10,
  },
  h1: { margin: 0, fontSize: 34, fontWeight: 900 },
  tabs: { display: "flex", gap: 8 },
  tabBtn: {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #d7dedb",
    background: "#fff",
    cursor: "pointer",
    fontWeight: 700,
  },
  tabBtnActive: { background: "#e7efe9" },

  catTitle: {
    margin: "12px 0 10px",
    fontSize: 18,
    fontWeight: 900,
  },

  card: {
    background: "#fff",
    borderRadius: 14,
    border: "1px solid #e6ece9",
    boxShadow: "0 1px 8px rgba(0,0,0,0.04)",
    padding: 14,
    display: "grid",
    gap: 10,
  },
  cardImg: {
    width: "100%",
    height: 160,
    objectFit: "cover",
    borderRadius: 12,
    border: "1px solid #eef2ef",
  },
  cardTitle: { fontSize: 18, fontWeight: 900 },
  cardSub: { fontSize: 14, color: "#333" },

  primaryBtn: {
    background: "#2e7d32",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "10px 12px",
    fontWeight: 800,
    cursor: "pointer",
  },
  ghostBtn: {
    background: "#fff",
    color: "#111",
    border: "1px solid #d7dedb",
    borderRadius: 10,
    padding: "10px 12px",
    fontWeight: 800,
    cursor: "pointer",
  },
  linkBtn: {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontSize: 18,
  },

  cartRow: {
    display: "grid",
    gridTemplateColumns: "1fr auto auto auto",
    gap: 10,
    alignItems: "center",
    background: "#fff",
    border: "1px solid #e6ece9",
    borderRadius: 12,
    padding: 12,
  },
  cartName: {
    fontWeight: 900,
    fontSize: 15,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  cartSum: { fontWeight: 900, minWidth: 90, textAlign: "right" },

  qty: { display: "flex", alignItems: "center", gap: 6 },
  qtyBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    border: "1px solid #d7dedb",
    background: "#fff",
    cursor: "pointer",
    fontWeight: 900,
  },
  qtyVal: { minWidth: 24, textAlign: "center", fontWeight: 900 },

  totalRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "#fff",
    border: "1px solid #e6ece9",
    borderRadius: 12,
    padding: 12,
  },

  checkoutCard: {
    background: "#fff",
    border: "1px solid #e6ece9",
    borderRadius: 14,
    padding: 14,
    display: "grid",
    gap: 10,
  },
  checkoutTitle: { fontSize: 18, fontWeight: 900 },
  label: { display: "grid", gap: 6, fontWeight: 800 },
  input: {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #d7dedb",
    fontSize: 14,
    outline: "none",
  },
  help: { fontSize: 12, color: "#444" },
  muted: { color: "#555" },
};

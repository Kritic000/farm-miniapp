import React, { useEffect, useMemo, useState } from "react";
import { API_URL } from "./config";

type Product = {
  id: string;
  category?: string;
  name: string;
  unit: string;
  price: number;
  active?: boolean; // TRUE/FALSE из таблицы
  sort?: number;
  image?: string; // например "/images/milk.jpg"
};

type CartItem = {
  product: Product;
  qty: number;
};

type View = "catalog" | "cart" | "checkout";

const CATEGORIES = ["Молочка", "Сыры", "Колбасные изделия", "Курица"] as const;
type Category = (typeof CATEGORIES)[number] | "Все";

function rub(n: number) {
  return new Intl.NumberFormat("ru-RU").format(n) + " ₽";
}

export default function App() {
  const tg = (window as any).Telegram?.WebApp;
  const theme = tg?.themeParams || {};

  const [view, setView] = useState<View>("catalog");
  const [category, setCategory] = useState<Category>("Все");

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [cart, setCart] = useState<Record<string, CartItem>>({});
  const [address, setAddress] = useState("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [orderOk, setOrderOk] = useState<string>("");

  // Telegram init
  useEffect(() => {
    try {
      tg?.ready?.();
      tg?.expand?.();
    } catch {}
  }, [tg]);

  // Load products
  useEffect(() => {
    setLoading(true);
    setError("");
    fetch(`${API_URL}?action=products`)
      .then((r) => r.json())
      .then((data) => {
        const list: Product[] = data.products || [];
        setProducts(list);
      })
      .catch(() => setError("Не удалось загрузить каталог"))
      .finally(() => setLoading(false));
  }, []);

  const cartItems = useMemo(() => Object.values(cart), [cart]);

  const cartCount = useMemo(
    () => cartItems.reduce((s, it) => s + it.qty, 0),
    [cartItems]
  );

  const total = useMemo(
    () => cartItems.reduce((s, it) => s + it.qty * it.product.price, 0),
    [cartItems]
  );

  const visibleProducts = useMemo(() => {
    // active в таблице может прийти как TRUE/FALSE или "TRUE"/"FALSE"
    const isActive = (p: Product) => {
      if (p.active === undefined) return true;
      if (typeof p.active === "boolean") return p.active;
      return String(p.active).toLowerCase() === "true";
    };

    return products
      .filter(isActive)
      .filter((p) => (category === "Все" ? true : (p.category || "") === category))
      .slice()
      .sort((a, b) => (a.sort ?? 9999) - (b.sort ?? 9999));
  }, [products, category]);

  function addToCart(p: Product) {
    setCart((prev) => {
      const next = { ...prev };
      const existing = next[p.id];
      next[p.id] = { product: p, qty: (existing?.qty || 0) + 1 };
      return next;
    });
    try {
      tg?.HapticFeedback?.impactOccurred?.("light");
    } catch {}
  }

  function inc(id: string) {
    setCart((prev) => {
      const next = { ...prev };
      if (!next[id]) return prev;
      next[id] = { ...next[id], qty: next[id].qty + 1 };
      return next;
    });
  }

  function dec(id: string) {
    setCart((prev) => {
      const next = { ...prev };
      const it = next[id];
      if (!it) return prev;
      const q = it.qty - 1;
      if (q <= 0) delete next[id];
      else next[id] = { ...it, qty: q };
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
    setOrderOk("");

    if (cartCount === 0) {
      alert("Корзина пустая");
      setView("catalog");
      return;
    }
    if (!address.trim()) {
      alert("Пожалуйста, укажите адрес доставки");
      return;
    }

    setSubmitting(true);
    try {
      const user = tg?.initDataUnsafe?.user || null;

      const payload = {
        address: address.trim(),
        comment: comment.trim(),
        total,
        items: cartItems.map((it) => ({
          id: it.product.id,
          category: it.product.category || "",
          name: it.product.name,
          unit: it.product.unit,
          price: it.product.price,
          qty: it.qty,
          sum: it.qty * it.product.price,
        })),
        telegram: user
          ? {
              id: user.id,
              first_name: user.first_name,
              last_name: user.last_name,
              username: user.username,
            }
          : null,
      };

      const res = await fetch(`${API_URL}?action=order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || data?.ok !== true) {
        throw new Error(data?.error || "Ошибка отправки заказа");
      }

      setOrderOk(`Заказ принят ✅ ${data.orderId ? "№" + data.orderId : ""}`.trim());
      setCart({});
      setAddress("");
      setComment("");
      setView("catalog");
      setCategory("Все");

      try {
        tg?.HapticFeedback?.notificationOccurred?.("success");
      } catch {}
    } catch (e: any) {
      alert(`Не удалось отправить заказ: ${e?.message || "ошибка"}`);
      try {
        tg?.HapticFeedback?.notificationOccurred?.("error");
      } catch {}
    } finally {
      setSubmitting(false);
    }
  }

  // Theme colors
  const bg = theme.bg_color || "#f4f6f9";
  const text = theme.text_color || "#111";
  const cardBg = theme.secondary_bg_color || "#fff";
  const btn = theme.button_color || "#2e7d32";
  const btnText = theme.button_text_color || "#fff";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: bg,
        color: text,
        padding: 14,
        fontFamily: "Arial",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 28, fontWeight: 800 }}>Каталог</div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={() => setView("catalog")} style={tabStyle(view === "catalog", cardBg)}>
            Товары
          </button>
          <button onClick={() => setView("cart")} style={tabStyle(view === "cart", cardBg)}>
            🛒 Корзина ({cartCount})
          </button>
        </div>
      </div>

      {orderOk && (
        <div style={{ background: cardBg, padding: 12, borderRadius: 10, marginBottom: 12 }}>
          {orderOk}
        </div>
      )}

      {/* Catalog */}
      {view === "catalog" && (
        <>
          {/* Categories */}
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 10, marginBottom: 6 }}>
            <button onClick={() => setCategory("Все")} style={chip(category === "Все")}>
              Все
            </button>
            {CATEGORIES.map((c) => (
              <button key={c} onClick={() => setCategory(c)} style={chip(category === c)}>
                {c}
              </button>
            ))}
          </div>

          {loading && <div>Загрузка…</div>}
          {error && <div style={{ color: "crimson" }}>{error}</div>}

          {!loading && !error && visibleProducts.length === 0 && (
            <div style={{ background: cardBg, padding: 12, borderRadius: 10 }}>
              В этой категории пока нет товаров.
            </div>
          )}

          {!loading &&
            !error &&
            visibleProducts.map((p) => (
              <div
                key={p.id}
                style={{
                  background: cardBg,
                  borderRadius: 12,
                  overflow: "hidden",
                  marginBottom: 12,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                }}
              >
                {p.image ? (
                  <img
                    src={p.image}
                    alt={p.name}
                    style={{ width: "100%", height: 180, objectFit: "cover", display: "block" }}
                  />
                ) : null}

                <div style={{ padding: 12 }}>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>{p.name}</div>
                  <div style={{ opacity: 0.75, marginTop: 4 }}>{p.category}</div>

                  <div style={{ opacity: 0.85, marginTop: 8 }}>
                    {rub(p.price)} / {p.unit}
                  </div>

                  <button
                    onClick={() => addToCart(p)}
                    style={{
                      marginTop: 10,
                      background: btn,
                      color: btnText,
                      border: "none",
                      padding: "10px 14px",
                      borderRadius: 10,
                      cursor: "pointer",
                      fontWeight: 800,
                    }}
                  >
                    В корзину
                  </button>
                </div>
              </div>
            ))}
        </>
      )}

      {/* Cart */}
      {view === "cart" && (
        <div style={{ background: cardBg, borderRadius: 12, padding: 12 }}>
          {cartCount === 0 ? (
            <div>
              Корзина пустая.
              <div style={{ marginTop: 10 }}>
                <button onClick={() => setView("catalog")} style={primary(btn, btnText)}>
                  Перейти в каталог
                </button>
              </div>
            </div>
          ) : (
            <>
              {cartItems.map((it) => (
                <div
                  key={it.product.id}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    padding: "10px 0",
                    borderBottom: "1px solid rgba(0,0,0,0.08)",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800 }}>{it.product.name}</div>
                    <div style={{ opacity: 0.75, marginTop: 4 }}>
                      {rub(it.product.price)} / {it.product.unit}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button onClick={() => dec(it.product.id)} style={qtyBtn(cardBg)}>
                      −
                    </button>
                    <div style={{ minWidth: 22, textAlign: "center", fontWeight: 800 }}>{it.qty}</div>
                    <button onClick={() => inc(it.product.id)} style={qtyBtn(cardBg)}>
                      +
                    </button>
                  </div>

                  <div style={{ width: 90, textAlign: "right", fontWeight: 800 }}>
                    {rub(it.qty * it.product.price)}
                  </div>

                  <button onClick={() => remove(it.product.id)} style={linkBtn()}>
                    удалить
                  </button>
                </div>
              ))}

              <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 12, fontSize: 16 }}>
                <div style={{ fontWeight: 900 }}>Итого</div>
                <div style={{ fontWeight: 900 }}>{rub(total)}</div>
              </div>

              <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
                <button onClick={() => setView("checkout")} style={primary(btn, btnText)}>
                  Оформить заказ
                </button>
                <button onClick={() => setView("catalog")} style={secondary(cardBg)}>
                  Добавить ещё
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Checkout */}
      {view === "checkout" && (
        <div style={{ background: cardBg, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 10 }}>Оформление</div>

          <label style={{ display: "block", fontWeight: 800, marginBottom: 6 }}>Адрес доставки *</label>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Город, улица, дом, подъезд, этаж, квартира"
            style={inputStyle(text)}
          />

          <label style={{ display: "block", fontWeight: 800, marginTop: 12, marginBottom: 6 }}>
            Комментарий (необязательно)
          </label>
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Например: код домофона, удобное время"
            style={inputStyle(text)}
          />

          <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between" }}>
            <div style={{ fontWeight: 900 }}>Итого</div>
            <div style={{ fontWeight: 900 }}>{rub(total)}</div>
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
            <button disabled={submitting} onClick={submitOrder} style={primary(btn, btnText)}>
              {submitting ? "Отправляем…" : "Подтвердить заказ"}
            </button>
            <button disabled={submitting} onClick={() => setView("cart")} style={secondary(cardBg)}>
              Назад в корзину
            </button>
          </div>

          <div style={{ marginTop: 10, opacity: 0.75, fontSize: 12 }}>
            Оплата пока не принимается в приложении — мы свяжемся после оформления.
          </div>
        </div>
      )}
    </div>
  );
}

/* Styles helpers */
function tabStyle(active: boolean, cardBg: string): React.CSSProperties {
  return {
    background: active ? "rgba(46,125,50,0.12)" : cardBg,
    border: "1px solid rgba(0,0,0,0.12)",
    padding: "8px 10px",
    borderRadius: 10,
    cursor: "pointer",
    fontWeight: 800,
    whiteSpace: "nowrap",
  };
}

function chip(active: boolean): React.CSSProperties {
  return {
    border: "1px solid rgba(0,0,0,0.12)",
    background: active ? "rgba(46,125,50,0.15)" : "#fff",
    padding: "8px 10px",
    borderRadius: 999,
    cursor: "pointer",
    fontWeight: 900,
    whiteSpace: "nowrap",
  };
}

function primary(bg: string, color: string): React.CSSProperties {
  return {
    background: bg,
    color,
    border: "none",
    padding: "10px 14px",
    borderRadius: 10,
    cursor: "pointer",
    fontWeight: 900,
  };
}

function secondary(cardBg: string): React.CSSProperties {
  return {
    background: cardBg,
    border: "1px solid rgba(0,0,0,0.12)",
    padding: "10px 14px",
    borderRadius: 10,
    cursor: "pointer",
    fontWeight: 900,
  };
}

function qtyBtn(cardBg: string): React.CSSProperties {
  return {
    background: cardBg,
    border: "1px solid rgba(0,0,0,0.15)",
    borderRadius: 10,
    width: 34,
    height: 34,
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 18,
    lineHeight: "30px",
  };
}

function linkBtn(): React.CSSProperties {
  return {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    color: "#2e7d32",
    fontWeight: 800,
    whiteSpace: "nowrap",
  };
}

function inputStyle(text: string): React.CSSProperties {
  return {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.15)",
    background: "#fff",
    color: text,
  };
}

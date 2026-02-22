import React, { useEffect, useMemo, useRef, useState } from "react";
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

// ✅ ВАЖНО: поставь сюда ТОЧНО такой же токен, как в Apps Script (API_TOKEN)
const FALLBACK_TOKEN = "Kjhytccb18@";

// --- Telegram helper (без telegram.ts) ---
function getTelegramUserSafe() {
  const w: any = window as any;
  const tg = w?.Telegram?.WebApp;

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

  return { id: "", username: "", first_name: "", last_name: "", language_code: "" };
}

// --- нормализация пути к картинке из Google Sheets ---
function normalizeImagePath(raw?: string): string | undefined {
  if (!raw) return undefined;
  let s = String(raw).trim();
  if (!s) return undefined;

  if (s.startsWith("public/")) s = s.slice("public/".length);
  if (!s.startsWith("/") && !s.startsWith("http")) s = "/" + s;

  return s;
}

function formatRub(n: number) {
  return `${Math.round(n)} ₽`;
}

function Modal({
  open,
  title,
  message,
  onClose,
}: {
  open: boolean;
  title?: string;
  message: string;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalTitle}>{title || "Сообщение"}</div>
        <div style={styles.modalText}>{message}</div>
        <button style={styles.modalBtn} onClick={onClose}>
          OK
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const DELIVERY_THRESHOLD = 2000;
  const DELIVERY_FEE = 200;

  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeCategory, setActiveCategory] = useState("Все");
  const [view, setView] = useState<"catalog" | "cart">("catalog");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [comment, setComment] = useState("");

  const nameRef = useRef<HTMLInputElement | null>(null);
  const phoneRef = useRef<HTMLInputElement | null>(null);
  const addressRef = useRef<HTMLInputElement | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMsg, setModalMsg] = useState("");
  const [focusAfterClose, setFocusAfterClose] = useState<null | "name" | "phone" | "address">(null);

  const showError = (msg: string, focus?: "name" | "phone" | "address") => {
    setModalMsg(msg);
    setModalOpen(true);
    setFocusAfterClose(focus || null);
  };

  const closeModal = () => {
    setModalOpen(false);
    setTimeout(() => {
      if (focusAfterClose === "name") nameRef.current?.focus();
      if (focusAfterClose === "phone") phoneRef.current?.focus();
      if (focusAfterClose === "address") addressRef.current?.focus();
      setFocusAfterClose(null);
    }, 50);
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}?action=products`, { method: "GET" });
        const data = await res.json();

        const list: Product[] = Array.isArray(data.products) ? data.products : [];
        const normalized = list.map((p) => ({ ...p, image: normalizeImagePath((p as any).image) }));
        setProducts(normalized);
      } catch {
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
  const subtotal = useMemo(() => cart.reduce((sum, i) => sum + i.price * i.qty, 0), [cart]);
  const delivery = useMemo(() => (subtotal > 0 && subtotal < DELIVERY_THRESHOLD ? DELIVERY_FEE : 0), [subtotal]);
  const grandTotal = useMemo(() => subtotal + delivery, [subtotal, delivery]);

  const addToCart = (p: Product) => {
    setCart((prev) => {
      const found = prev.find((i) => i.id === p.id);
      if (found) return prev.map((i) => (i.id === p.id ? { ...i, qty: i.qty + 1 } : i));
      return [...prev, { ...p, qty: 1 }];
    });
  };

  const changeQty = (id: string, delta: number) => {
    setCart((prev) => prev.map((i) => (i.id === id ? { ...i, qty: i.qty + delta } : i)).filter((i) => i.qty > 0));
  };

  const removeItem = (id: string) => {
    setCart((prev) => prev.filter((i) => i.id !== id));
  };

  const submitOrder = async () => {
    if (sending) return;

    if (cart.length === 0) return showError("Корзина пустая.");
    if (name.trim().length < 2) return showError("Укажи имя (минимум 2 символа).", "name");
    if (phone.trim().length < 6) return showError("Укажи корректный телефон.", "phone");
    if (address.trim().length < 5) return showError("Укажи адрес доставки.", "address");

    setSending(true);

    try {
      const tg = getTelegramUserSafe();

      // ✅ Берём токен из Vercel env, а если его нет — используем FALLBACK_TOKEN
      const envToken = (import.meta as any)?.env?.VITE_API_TOKEN || "";
      const token = envToken || FALLBACK_TOKEN;

      await fetch(API_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
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
          subtotal,
          delivery,
          total: grandTotal,
        }),
      });

      setCart([]);
      setView("catalog");
      setName("");
      setPhone("");
      setAddress("");
      setComment("");
      setModalMsg("✅ Заказ отправлен! Мы свяжемся с вами.");
      setModalOpen(true);
    } catch {
      showError("Не удалось отправить заказ. Проверь интернет/VPN и повтори.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={styles.app}>
      <Modal open={modalOpen} title="FarmShop" message={modalMsg} onClose={closeModal} />

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
                        <img
                          src={p.image}
                          alt={p.name}
                          style={styles.image}
                          loading="lazy"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = "none";
                            const parent = e.currentTarget.parentElement;
                            if (parent && !parent.querySelector("[data-nophoto='1']")) {
                              const div = document.createElement("div");
                              div.setAttribute("data-nophoto", "1");
                              div.style.cssText = "color:#7a8795;text-align:center;font-weight:700;line-height:1.2;";
                              div.innerHTML = "<div style='font-size:28px'>🖼️</div><div>Нет фото</div>";
                              parent.appendChild(div);
                            }
                          }}
                        />
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
                        {p.price} ₽ <span style={styles.priceUnit}>/ {p.unit}</span>
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

          <div style={styles.cartBox}>
            <div style={styles.cartTitle}>Ваш заказ</div>

            {cart.length === 0 ? (
              <div style={{ padding: "10px 0", color: "#5d6a79", fontWeight: 600 }}>
                Корзина пустая. Перейди во вкладку «Товары».
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {cart.map((i) => (
                  <div key={i.id} style={styles.cartItem}>
                    <div style={{ flex: 1 }}>
                      <div style={styles.cartItemName}>{i.name}</div>
                      <div style={styles.cartItemMeta}>
                        {i.price} ₽ / {i.unit}
                      </div>
                      <div style={styles.cartItemSum}>Сумма: {formatRub(i.price * i.qty)}</div>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                      <div style={styles.qtyBox}>
                        <button style={styles.qtyBtn} onClick={() => changeQty(i.id, -1)}>
                          −
                        </button>
                        <span style={styles.qtyNum}>{i.qty}</span>
                        <button style={styles.qtyBtn} onClick={() => changeQty(i.id, 1)}>
                          +
                        </button>
                      </div>

                      <button style={styles.removeBtn} onClick={() => removeItem(i.id)}>
                        Удалить
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={styles.summary}>
              <div style={styles.summaryRow}>
                <span>Товары</span>
                <b>{formatRub(subtotal)}</b>
              </div>
              <div style={styles.summaryRow}>
                <span>{subtotal > 0 && subtotal < DELIVERY_THRESHOLD ? `Доставка (до ${DELIVERY_THRESHOLD} ₽)` : "Доставка (бесплатно)"}</span>
                <b>{formatRub(delivery)}</b>
              </div>
              <div style={styles.summaryRowTotal}>
                <span>Итого</span>
                <b>{formatRub(grandTotal)}</b>
              </div>
            </div>
          </div>

          <label style={styles.label}>Имя *</label>
          <input ref={nameRef} style={styles.input} placeholder="Как к вам обращаться?" value={name} onChange={(e) => setName(e.target.value)} />

          <label style={styles.label}>Телефон *</label>
          <input ref={phoneRef} style={styles.input} placeholder="+7..." value={phone} onChange={(e) => setPhone(e.target.value)} />

          <label style={styles.label}>Адрес доставки *</label>
          <input ref={addressRef} style={styles.input} placeholder="улица, дом, подъезд, этаж, кв." value={address} onChange={(e) => setAddress(e.target.value)} />

          <label style={styles.label}>Комментарий (необязательно)</label>
          <textarea style={styles.textarea} placeholder="код домофона, удобное время" value={comment} onChange={(e) => setComment(e.target.value)} />

          <button style={sending ? styles.submitDisabled : styles.submit} onClick={submitOrder} disabled={cart.length === 0 || sending}>
            {sending ? "Отправляем..." : "Подтвердить заказ"}
          </button>

          <div style={styles.note}>Оплата пока не принимается в приложении — мы свяжемся после оформления.</div>
        </div>
      )}
    </div>
  );
}

const styles: any = {
  app: { maxWidth: 520, margin: "0 auto", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif", background: "#eef2f5", minHeight: "100vh" },
  banner: { padding: 18, background: "linear-gradient(135deg,#7bbf34,#2f7d22)", color: "white", borderBottomLeftRadius: 18, borderBottomRightRadius: 18 },
  bannerTitle: { fontSize: 34, fontWeight: 800, letterSpacing: 0.2 },
  bannerSubtitle: { opacity: 0.95, marginTop: 2, fontWeight: 500 },
  tabs: { display: "flex", padding: 12, gap: 10 },
  tab: { flex: 1, padding: 12, borderRadius: 14, border: "1px solid rgba(0,0,0,0.12)", background: "#fff", fontWeight: 650 },
  tabActive: { flex: 1, padding: 12, borderRadius: 14, border: "1px solid rgba(0,0,0,0.06)", background: "#dff2d8", fontWeight: 750 },
  categories: { display: "flex", gap: 10, padding: "0 12px 12px", flexWrap: "wrap" },
  chip: { padding: "10px 14px", borderRadius: 22, border: "1px solid rgba(0,0,0,0.12)", background: "#fff", fontWeight: 650 },
  chipActive: { padding: "10px 14px", borderRadius: 22, border: "1px solid rgba(0,0,0,0.06)", background: "#2f7d22", color: "#fff", fontWeight: 750 },
  card: { background: "#fff", margin: "10px 12px", padding: 14, borderRadius: 20, boxShadow: "0 10px 24px rgba(0,0,0,0.06)" },
  cardRow: { display: "flex", gap: 14, alignItems: "stretch" },
  imageBox: { width: 120, minWidth: 120, height: 120, borderRadius: 16, overflow: "hidden", background: "#f1f3f6", border: "1px solid rgba(0,0,0,0.06)", display: "flex", alignItems: "center", justifyContent: "center" },
  image: { width: "100%", height: "100%", objectFit: "cover" },
  noPhoto: { color: "#7a8795", textAlign: "center", fontWeight: 650, lineHeight: 1.2 },
  cardInfo: { flex: 1, display: "flex", flexDirection: "column", gap: 6 },
  name: { fontWeight: 750, fontSize: 20, lineHeight: 1.15, letterSpacing: 0.1 },
  desc: { color: "#586575", fontWeight: 550, fontSize: 13, lineHeight: 1.25 },
  price: { color: "#e67e22", fontWeight: 750, fontSize: 18 },
  priceUnit: { color: "#5d6a79", fontWeight: 550, fontSize: 14 },
  btn: { marginTop: 6, background: "linear-gradient(180deg,#3aa22c,#226a1c)", color: "#fff", padding: "12px 14px", borderRadius: 14, border: "none", fontWeight: 750, width: 180 },
  qtyBox: { display: "flex", gap: 10, alignItems: "center" },
  qtyBtn: { width: 42, height: 42, borderRadius: 12, border: "1px solid rgba(0,0,0,0.12)", background: "#fff", fontSize: 20, fontWeight: 800 },
  qtyNum: { minWidth: 24, textAlign: "center", fontWeight: 750, fontSize: 18 },
  checkout: { margin: 12, background: "#fff", borderRadius: 20, padding: 14, boxShadow: "0 10px 24px rgba(0,0,0,0.06)" },
  cartBox: { border: "1px solid rgba(0,0,0,0.08)", borderRadius: 16, padding: 12, marginBottom: 12, background: "#f8fafc" },
  cartTitle: { fontWeight: 800, marginBottom: 10, fontSize: 16 },
  cartItem: { display: "flex", gap: 10, padding: 10, borderRadius: 14, background: "#fff", border: "1px solid rgba(0,0,0,0.06)" },
  cartItemName: { fontWeight: 750, lineHeight: 1.15 },
  cartItemMeta: { color: "#5d6a79", fontWeight: 550, fontSize: 12, marginTop: 4 },
  cartItemSum: { marginTop: 6, fontWeight: 750 },
  removeBtn: { border: "1px solid rgba(0,0,0,0.12)", background: "#fff", borderRadius: 12, padding: "8px 10px", fontWeight: 650 },
  summary: { marginTop: 12, paddingTop: 12, borderTop: "1px dashed rgba(0,0,0,0.18)", display: "flex", flexDirection: "column", gap: 8 },
  summaryRow: { display: "flex", justifyContent: "space-between", color: "#2b3440" },
  summaryRowTotal: { display: "flex", justifyContent: "space-between", fontSize: 16 },
  label: { display: "block", fontWeight: 750, marginTop: 10, marginBottom: 6 },
  input: { width: "100%", padding: 12, borderRadius: 14, border: "1px solid rgba(0,0,0,0.12)", outline: "none", fontSize: 16 },
  textarea: { width: "100%", padding: 12, borderRadius: 14, border: "1px solid rgba(0,0,0,0.12)", outline: "none", fontSize: 16, minHeight: 92, resize: "vertical" },
  submit: { marginTop: 12, width: "100%", padding: 14, borderRadius: 16, background: "linear-gradient(180deg,#3aa22c,#226a1c)", color: "#fff", border: "none", fontWeight: 850, fontSize: 16 },
  submitDisabled: { marginTop: 12, width: "100%", padding: 14, borderRadius: 16, background: "#86b982", color: "#fff", border: "none", fontWeight: 850, fontSize: 16, opacity: 0.85 },
  note: { marginTop: 10, color: "#5d6a79", fontWeight: 550, fontSize: 12 },
  modalOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 },
  modalCard: { width: "100%", maxWidth: 420, background: "#fff", borderRadius: 16, padding: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" },
  modalTitle: { fontWeight: 850, fontSize: 16, marginBottom: 8 },
  modalText: { color: "#243040", fontWeight: 600, lineHeight: 1.25 },
  modalBtn: { marginTop: 12, width: "100%", padding: 12, borderRadius: 14, border: "none", background: "#2f7d22", color: "#fff", fontWeight: 850 },
};

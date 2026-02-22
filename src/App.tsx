import React, { useEffect, useMemo, useState } from "react";
import { API_URL } from "./config";

type Product = {
  id: string;
  category: string;
  name: string;
  unit: string;
  price: number;
  sort?: number;
  image?: string;        // например: /images/milk.jpg
  description?: string;  // опционально
};

type CartItem = {
  id: string;
  name: string;
  unit: string;
  price: number;
  qty: number;
  image?: string;
  description?: string;
};

type TgUser = {
  id?: number;
  username?: string;
  first_name?: string;
};

function getTgUserSafe(): TgUser | null {
  const w: any = window as any;
  const tg = w?.Telegram?.WebApp;
  const u = tg?.initDataUnsafe?.user;
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    first_name: u.first_name,
  };
}

// Нормализуем путь картинки:
// - если в таблице "public/images/xxx.jpg" → превратим в "/images/xxx.jpg"
// - если уже "/images/xxx.jpg" → оставим
// - если пусто → undefined
function normalizeImagePath(p?: string): string | undefined {
  const s = (p || "").trim();
  if (!s) return undefined;
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  if (s.startsWith("/")) return s;
  if (s.startsWith("public/")) return "/" + s.replace(/^public\//, "");
  return "/" + s; // на всякий
}

function formatRUB(n: number) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(n)) + " ₽";
}

const DELIVERY_FEE = 200;
const FREE_DELIVERY_FROM = 2000;

export default function App() {
  const [tab, setTab] = useState<"products" | "cart" | "checkout">("products");

  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string>("");

  const [category, setCategory] = useState<string>("Все");

  const [cart, setCart] = useState<Record<string, CartItem>>({});
  const cartCount = useMemo(
    () => Object.values(cart).reduce((s, x) => s + x.qty, 0),
    [cart]
  );

  // Checkout fields
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [comment, setComment] = useState("");

  const [modal, setModal] = useState<string>("");

  useEffect(() => {
    // Telegram UI tweaks
    const w: any = window as any;
    const tg = w?.Telegram?.WebApp;
    if (tg) {
      try {
        tg.expand();
        tg.ready();
        tg.setHeaderColor?.("#CFE9FF"); // sky
        tg.setBackgroundColor?.("#F6F6F0"); // warm light
      } catch {}
    }
  }, []);

  useEffect(() => {
    // load cart from localStorage
    try {
      const raw = localStorage.getItem("farm_cart_v1");
      if (raw) setCart(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("farm_cart_v1", JSON.stringify(cart));
    } catch {}
  }, [cart]);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`${API_URL}?action=products`, { cache: "no-store" });
        const data = await res.json();
        if (!alive) return;
        const list: Product[] = (data.products || []).map((p: any) => ({
          ...p,
          image: normalizeImagePath(p.image),
          description: (p.description || "").trim() || undefined,
        }));
        setProducts(list);
      } catch (e: any) {
        if (!alive) return;
        setError("Не удалось загрузить ассортимент. Проверь API_URL.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => set.add(p.category));
    const arr = Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
    return ["Все", ...arr];
  }, [products]);

  const filtered = useMemo(() => {
    if (category === "Все") return products;
    return products.filter((p) => p.category === category);
  }, [products, category]);

  const subtotal = useMemo(() => {
    return Object.values(cart).reduce((s, x) => s + x.price * x.qty, 0);
  }, [cart]);

  const delivery = useMemo(() => {
    if (subtotal <= 0) return 0;
    return subtotal < FREE_DELIVERY_FROM ? DELIVERY_FEE : 0;
  }, [subtotal]);

  const total = subtotal + delivery;

  function addToCart(p: Product) {
    setCart((prev) => {
      const ex = prev[p.id];
      const nextQty = (ex?.qty || 0) + 1;
      return {
        ...prev,
        [p.id]: {
          id: p.id,
          name: p.name,
          unit: p.unit,
          price: p.price,
          qty: nextQty,
          image: p.image,
          description: p.description,
        },
      };
    });
  }

  function decFromCart(id: string) {
    setCart((prev) => {
      const ex = prev[id];
      if (!ex) return prev;
      const nextQty = ex.qty - 1;
      const copy = { ...prev };
      if (nextQty <= 0) delete copy[id];
      else copy[id] = { ...ex, qty: nextQty };
      return copy;
    });
  }

  function removeFromCart(id: string) {
    setCart((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  }

  function goCheckout() {
    if (cartCount === 0) {
      setModal("Корзина пустая.");
      return;
    }
    setTab("checkout");
  }

  async function submitOrder() {
    const nm = name.trim();
    const ph = phone.trim();
    const addr = address.trim();

    if (nm.length < 2) {
      setModal("Укажи имя (минимум 2 символа).");
      return;
    }
    if (ph.length < 6) {
      setModal("Укажи телефон (минимум 6 символов).");
      return;
    }
    if (addr.length < 5) {
      setModal("Укажи адрес доставки (минимум 5 символов).");
      return;
    }

    const token = (import.meta as any).env?.VITE_API_TOKEN || "";
    if (!token) {
      setModal("В Vercel не задан VITE_API_TOKEN. Без токена заказ не отправить.");
      return;
    }

    const items = Object.values(cart).map((x) => ({
      id: x.id,
      name: x.name,
      unit: x.unit,
      price: x.price,
      qty: x.qty,
      sum: x.price * x.qty,
    }));

    const tgUser = getTgUserSafe();

    try {
      // Важно: не используем no-cors, чтобы видеть реальные ошибки сервера.
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          name: nm,
          phone: ph,
          address: addr,
          comment: comment.trim(),
          items,
          total,
          tg: tgUser || {},
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        setModal("Не удалось отправить заказ: " + (data?.error || `HTTP ${res.status}`));
        return;
      }

      setModal("Заказ отправлен ✅ Мы свяжемся с вами для подтверждения.");
      setCart({});
      setComment("");
      // оставим имя/телефон/адрес (удобно для повторных заказов)
      setTab("products");
    } catch (e: any) {
      setModal("Не удалось отправить заказ: Failed to fetch");
    }
  }

  // ====== Styles (палитра под пейзаж) ======
  const css = `
  :root{
    --bg: #F6F6F0;
    --card: #FFFFFF;
    --milk: #FFFDF3;
    --sky: #CFE9FF;
    --sun: #FFF1B8;
    --green: #2E7D32;
    --green2:#43A047;
    --green3:#1B5E20;
    --text:#1f2937;
    --muted:#6b7280;
    --shadow: 0 10px 25px rgba(15, 23, 42, .10);
    --shadow2: 0 8px 18px rgba(15, 23, 42, .12);
    --radius: 18px;
  }
  html, body { background: var(--bg); }
  .wrap{
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
    color: var(--text);
    padding: 14px 12px 18px;
    max-width: 520px;
    margin: 0 auto;
  }
  .banner{
    border-radius: 22px;
    overflow: hidden;
    box-shadow: var(--shadow);
    background: linear-gradient(180deg, var(--sky), var(--sun));
    position: relative;
    margin-bottom: 10px;
  }
  .bannerImg{
    width: 100%;
    height: 160px;
    object-fit: cover;
    display:block;
    filter: saturate(1.05) contrast(1.02);
  }
  .bannerOverlay{
    position:absolute; inset:0;
    background: linear-gradient(180deg, rgba(0,0,0,.18), rgba(0,0,0,.05) 55%, rgba(0,0,0,0));
  }
  .brand{
    position:absolute; left:14px; top:12px;
    color: white;
    text-shadow: 0 2px 10px rgba(0,0,0,.25);
  }
  .brandTitle{
    font-size: 42px;
    font-weight: 800;
    line-height: 1;
    letter-spacing: .2px;
  }
  .brandSub{
    margin-top: 6px;
    font-weight: 600;
    opacity: .95;
  }

  .topTabs{
    display:flex;
    gap:10px;
    margin: 10px 0 10px;
  }
  .pillBig{
    flex:1;
    border-radius: 16px;
    padding: 12px 14px;
    font-weight: 800;
    border: 2px solid rgba(0,0,0,.08);
    background: #fff;
    box-shadow: 0 8px 16px rgba(15,23,42,.06);
    display:flex;
    justify-content:center;
    align-items:center;
    gap:10px;
  }
  .pillBig.active{
    background: linear-gradient(180deg, var(--green2), var(--green));
    color: #fff;
    border-color: rgba(0,0,0,.06);
  }

  .chips{
    display:flex;
    gap:10px;
    flex-wrap: nowrap;
    overflow:auto;
    padding-bottom: 6px;
    -webkit-overflow-scrolling: touch;
  }
  .chip{
    flex: 0 0 auto;
    border-radius: 999px;
    padding: 10px 14px;
    font-weight: 800;
    background: #fff;
    border: 2px solid rgba(0,0,0,.08);
    box-shadow: 0 6px 14px rgba(15,23,42,.06);
    white-space: nowrap;
  }
  .chip.active{
    background: linear-gradient(180deg, var(--green2), var(--green));
    color: #fff;
    border-color: rgba(0,0,0,.06);
  }

  .list{
    margin-top: 10px;
    display:flex;
    flex-direction: column;
    gap: 12px;
  }
  .card{
    background: var(--card);
    border-radius: 22px;
    box-shadow: var(--shadow2);
    padding: 14px;
    display:flex;
    gap: 12px;
    align-items: stretch;
  }
  .imgBox{
    width: 118px;
    min-width: 118px;
    height: 118px;
    border-radius: 18px;
    background: #EEF2F7;
    border: 2px solid rgba(0,0,0,.06);
    overflow:hidden;
    display:flex;
    align-items:center;
    justify-content:center;
    color: #6b7280;
    font-weight: 800;
  }
  .imgBox img{
    width:100%;
    height:100%;
    object-fit: cover;
  }
  .pTitle{
    font-size: 22px;
    font-weight: 800; /* аккуратнее, но не “жирнющее” */
    line-height: 1.15;
    margin: 2px 0 6px;
  }
  .pDesc{
    color: var(--muted);
    font-weight: 600;
    font-size: 13px;
    line-height: 1.3;
    margin-bottom: 8px;
  }
  .price{
    font-weight: 900;
    color: #F59E0B; /* теплый “солнечный” */
    font-size: 22px;
    margin-top: 2px;
  }
  .btn{
    margin-top: 10px;
    border: none;
    cursor: pointer;
    border-radius: 999px;
    padding: 12px 16px;
    font-weight: 900;
    background: linear-gradient(180deg, var(--green2), var(--green));
    color: #fff;
    box-shadow: 0 10px 0 rgba(27,94,32,.25);
    display:inline-flex;
    align-items:center;
    justify-content:center;
    gap: 10px;
    min-width: 170px;
  }
  .qtyRow{
    margin-top: 10px;
    display:flex;
    gap:10px;
    align-items:center;
  }
  .qtyBtn{
    width: 42px;
    height: 42px;
    border-radius: 14px;
    border: 2px solid rgba(0,0,0,.08);
    background: #fff;
    font-weight: 900;
    font-size: 18px;
    cursor:pointer;
  }
  .qtyNum{
    min-width: 34px;
    text-align:center;
    font-weight: 900;
  }

  .sectionTitle{
    font-size: 26px;
    font-weight: 900;
    margin: 10px 0 8px;
  }
  .cartBox{
    background: #fff;
    border-radius: 22px;
    box-shadow: var(--shadow2);
    padding: 14px;
  }
  .cartItem{
    display:flex;
    gap: 10px;
    align-items:center;
    padding: 10px 0;
    border-bottom: 1px solid rgba(0,0,0,.06);
  }
  .cartItem:last-child{ border-bottom:none; }
  .cartMiniImg{
    width: 52px;
    height: 52px;
    border-radius: 14px;
    background: #EEF2F7;
    overflow:hidden;
    border: 2px solid rgba(0,0,0,.06);
    display:flex;
    align-items:center;
    justify-content:center;
    color:#6b7280;
    font-weight:800;
  }
  .cartMiniImg img{ width:100%; height:100%; object-fit:cover; }
  .cartName{ font-weight: 900; line-height: 1.15; }
  .cartSub{ color: var(--muted); font-weight: 700; font-size: 12px; margin-top: 2px; }
  .cartRight{ margin-left:auto; text-align:right; }
  .sum{ font-weight: 900; }
  .muted{ color: var(--muted); font-weight: 700; }

  .input{
    width: 100%;
    border-radius: 14px;
    border: 2px solid rgba(0,0,0,.08);
    padding: 12px 12px;
    font-weight: 700;
    outline: none;
    background: var(--milk);
  }
  .label{
    font-weight: 900;
    margin: 10px 0 6px;
  }
  .bigAction{
    width: 100%;
    border: none;
    cursor:pointer;
    border-radius: 16px;
    padding: 14px 16px;
    font-weight: 900;
    background: linear-gradient(180deg, var(--green2), var(--green));
    color:#fff;
    box-shadow: 0 10px 0 rgba(27,94,32,.25);
    margin-top: 10px;
  }
  .bigAction.secondary{
    background: #fff;
    color: var(--text);
    border: 2px solid rgba(0,0,0,.08);
    box-shadow: none;
  }

  .modalBack{
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,.35);
    display:flex;
    align-items:flex-end;
    justify-content:center;
    padding: 16px;
  }
  .modal{
    width: 100%;
    max-width: 520px;
    background: #fff;
    border-radius: 18px;
    padding: 14px;
    box-shadow: var(--shadow);
  }
  .modalTitle{ font-weight: 900; margin-bottom: 6px; }
  .modalBtn{
    margin-top: 10px;
    width: 100%;
    border: none;
    border-radius: 14px;
    padding: 12px 14px;
    font-weight: 900;
    background: linear-gradient(180deg, var(--green2), var(--green));
    color:#fff;
    cursor:pointer;
  }
  `;

  const bannerTitle = "Нашенское";
  const bannerSub = "@FarmShopingbot";

  // картинка баннера (пейзаж) — положи в public/images/banner.jpg
  // или замени на свою: /images/xxx.png
  const bannerImage = "/images/banner.png";

  return (
    <div className="wrap">
      <style>{css}</style>

      <div className="banner">
        <img
          className="bannerImg"
          src={bannerImage}
          alt="banner"
          onError={(e) => {
            // если нет баннера — сделаем просто градиент
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
        <div className="bannerOverlay" />
        <div className="brand">
          <div className="brandTitle">{bannerTitle}</div>
          <div className="brandSub">{bannerSub}</div>
        </div>
      </div>

      <div className="topTabs">
        <button
          className={"pillBig " + (tab === "products" ? "active" : "")}
          onClick={() => setTab("products")}
        >
          Товары
        </button>
        <button
          className={"pillBig " + (tab !== "products" ? "active" : "")}
          onClick={() => setTab("cart")}
        >
          🛒 Корзина ({cartCount})
        </button>
      </div>

      {tab === "products" && (
        <>
          <div className="chips">
            {categories.map((c) => (
              <button
                key={c}
                className={"chip " + (category === c ? "active" : "")}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>

          {loading && <div className="muted">Загружаем ассортимент…</div>}
          {error && <div style={{ color: "#b91c1c", fontWeight: 800 }}>{error}</div>}

          <div className="list">
            {filtered.map((p) => {
              const inCartQty = cart[p.id]?.qty || 0;
              return (
                <div className="card" key={p.id}>
                  <div className="imgBox">
                    {p.image ? (
                      <img
                        src={p.image}
                        alt={p.name}
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <div>Нет фото</div>
                    )}
                  </div>

                  <div style={{ flex: 1 }}>
                    <div className="pTitle">{p.name}</div>
                    {p.description && <div className="pDesc">{p.description}</div>}
                    <div className="price">{formatRUB(p.price)} / {p.unit}</div>

                    {inCartQty === 0 ? (
                      <button className="btn" onClick={() => addToCart(p)}>
                        🛒 В корзину
                      </button>
                    ) : (
                      <div className="qtyRow">
                        <button className="qtyBtn" onClick={() => decFromCart(p.id)}>-</button>
                        <div className="qtyNum">{inCartQty}</div>
                        <button className="qtyBtn" onClick={() => addToCart(p)}>+</button>
                        <button
                          className="qtyBtn"
                          title="Удалить"
                          onClick={() => removeFromCart(p.id)}
                          style={{ width: 52 }}
                        >
                          ✕
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
        <>
          <div className="sectionTitle">Ваш заказ</div>

          <div className="cartBox">
            {cartCount === 0 ? (
              <div className="muted">Корзина пустая.</div>
            ) : (
              <>
                {Object.values(cart).map((x) => (
                  <div className="cartItem" key={x.id}>
                    <div className="cartMiniImg">
                      {x.image ? (
                        <img
                          src={x.image}
                          alt={x.name}
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = "none";
                          }}
                        />
                      ) : (
                        <div>—</div>
                      )}
                    </div>

                    <div style={{ minWidth: 0 }}>
                      <div className="cartName">{x.name}</div>
                      <div className="cartSub">
                        {x.qty} × {formatRUB(x.price)} • {x.unit}
                      </div>
                    </div>

                    <div className="cartRight">
                      <div className="sum">{formatRUB(x.price * x.qty)}</div>
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
                        <button className="qtyBtn" onClick={() => decFromCart(x.id)}>-</button>
                        <button className="qtyBtn" onClick={() => addToCart({
                          id: x.id, name: x.name, unit: x.unit, price: x.price, image: x.image, description: x.description, category: ""
                        } as any)}>+</button>
                      </div>
                    </div>
                  </div>
                ))}

                <div style={{ marginTop: 10, fontWeight: 900 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span className="muted">Товары</span>
                    <span>{formatRUB(subtotal)}</span>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span className="muted">
                      Доставка {subtotal < FREE_DELIVERY_FROM ? `(до ${FREE_DELIVERY_FROM} ₽)` : "(бесплатно)"}
                    </span>
                    <span>{formatRUB(delivery)}</span>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18 }}>
                    <span>Итого</span>
                    <span>{formatRUB(total)}</span>
                  </div>

                  <button className="bigAction" onClick={goCheckout}>
                    Оформить заказ
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {tab === "checkout" && (
        <>
          <div className="sectionTitle">Оформление</div>

          <div className="cartBox">
            <div className="label">Имя *</div>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Как к вам обращаться?"
            />

            <div className="label">Телефон *</div>
            <input
              className="input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+7..."
              inputMode="tel"
            />

            <div className="label">Адрес доставки *</div>
            <input
              className="input"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="улица, дом, подъезд, этаж, кв."
            />

            <div className="label">Комментарий (необязательно)</div>
            <textarea
              className="input"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="код домофона, удобное время"
              rows={3}
              style={{ resize: "vertical" }}
            />

            <div style={{ marginTop: 12, fontWeight: 900 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span className="muted">Товары</span>
                <span>{formatRUB(subtotal)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span className="muted">Доставка</span>
                <span>{formatRUB(delivery)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18 }}>
                <span>Итого</span>
                <span>{formatRUB(total)}</span>
              </div>
            </div>

            <button className="bigAction" onClick={submitOrder}>
              Подтвердить заказ
            </button>

            <button className="bigAction secondary" onClick={() => setTab("cart")}>
              Назад в корзину
            </button>

            <div style={{ marginTop: 10 }} className="muted">
              Оплата пока не принимается в приложении — мы свяжемся после оформления.
            </div>
          </div>
        </>
      )}

      {modal && (
        <div className="modalBack" onClick={() => setModal("")}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modalTitle">Сообщение</div>
            <div style={{ fontWeight: 700, color: "#111827" }}>{modal}</div>
            <button className="modalBtn" onClick={() => setModal("")}>
              ОК
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useMemo, useRef, useState } from "react";
import { API_URL } from "./config";

type Product = {
  id: string;
  category: string;
  name: string;
  description?: string;
  unit: string;
  price: number;
  sort: number;
  image?: string; // e.g. "/images/milk.jpg"
};

type CartItem = {
  productId: string;
  qty: number;
};

type TgUser = {
  id?: number;
  username?: string;
  first_name?: string;
  last_name?: string;
};

type ToastType = "success" | "error" | "info";
type Toast = { id: string; type: ToastType; text: string };

declare global {
  interface Window {
    Telegram?: any;
  }
}

const PRODUCTS_CACHE_KEY = "farmshop_products_cache_v1";
const PRODUCTS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

const formatPrice = (n: number) =>
  new Intl.NumberFormat("ru-RU").format(Math.round(n));

function safeJsonParse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function getTgUser(): TgUser | null {
  try {
    const w = window.Telegram?.WebApp;
    const u = w?.initDataUnsafe?.user;
    if (!u) return null;
    return {
      id: u.id,
      username: u.username,
      first_name: u.first_name,
      last_name: u.last_name,
    };
  } catch {
    return null;
  }
}

export default function App() {
  // ----- Telegram WebApp init (safe) -----
  useEffect(() => {
    const w = window.Telegram?.WebApp;
    if (!w) return;
    try {
      w.ready?.();
      w.expand?.();
      // Можно принудительно сделать светлую тему:
      // w.setHeaderColor?.("#ffffff");
      // w.setBackgroundColor?.("#eef1f5");
    } catch {}
  }, []);

  // ----- Toasts -----
  const [toasts, setToasts] = useState<Toast[]>([]);
  const pushToast = (type: ToastType, text: string) => {
    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    setToasts((t) => [...t, { id, type, text }]);
    window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 2600);
  };

  // ----- Tabs -----
  const [tab, setTab] = useState<"catalog" | "cart" | "checkout">("catalog");

  // ----- Products -----
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("__all__");

  // ----- Cart -----
  const [cart, setCart] = useState<CartItem[]>(() => {
    const raw = localStorage.getItem("farmshop_cart_v1");
    return raw ? safeJsonParse<CartItem[]>(raw, []) : [];
  });

  useEffect(() => {
    localStorage.setItem("farmshop_cart_v1", JSON.stringify(cart));
  }, [cart]);

  const cartCount = useMemo(
    () => cart.reduce((sum, it) => sum + it.qty, 0),
    [cart]
  );

  const productById = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  const categories = useMemo(() => {
    const uniq = new Set<string>();
    for (const p of products) uniq.add(p.category || "Без категории");
    // Приоритетные категории как ты хотел:
    const preferred = ["Молочка", "Сыры", "Колбасные изделия", "Курица"];
    const rest = Array.from(uniq).filter((c) => !preferred.includes(c));
    return [
      ...preferred.filter((c) => uniq.has(c)),
      ...rest.sort((a, b) => a.localeCompare(b, "ru")),
    ];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const list =
      selectedCategory === "__all__"
        ? products
        : products.filter((p) => p.category === selectedCategory);
    return [...list].sort(
      (a, b) =>
        (a.category || "").localeCompare(b.category || "", "ru") ||
        (a.sort || 0) - (b.sort || 0) ||
        (a.name || "").localeCompare(b.name || "", "ru")
    );
  }, [products, selectedCategory]);

  const cartDetailed = useMemo(() => {
    return cart
      .map((it) => {
        const p = productById.get(it.productId);
        if (!p) return null;
        return { ...it, product: p, lineTotal: p.price * it.qty };
      })
      .filter(Boolean) as Array<
      CartItem & { product: Product; lineTotal: number }
    >;
  }, [cart, productById]);

  const cartTotal = useMemo(
    () => cartDetailed.reduce((sum, it) => sum + it.lineTotal, 0),
    [cartDetailed]
  );

  const getQty = (productId: string) =>
    cart.find((x) => x.productId === productId)?.qty || 0;

  const setQty = (productId: string, qty: number) => {
    setCart((prev) => {
      const next = prev.filter((x) => x.productId !== productId);
      if (qty > 0) next.push({ productId, qty });
      next.sort((a, b) => a.productId.localeCompare(b.productId));
      return next;
    });
  };

  const inc = (productId: string) => setQty(productId, getQty(productId) + 1);
  const dec = (productId: string) => setQty(productId, getQty(productId) - 1);

  // ----- Checkout fields -----
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);

  // ----- Fetch products with caching -----
  useEffect(() => {
    const load = async () => {
      setLoading(true);

      // cache first
      const cachedRaw = localStorage.getItem(PRODUCTS_CACHE_KEY);
      if (cachedRaw) {
        const cached = safeJsonParse<{ ts: number; products: Product[] }>(
          cachedRaw,
          { ts: 0, products: [] }
        );
        if (cached.ts && Date.now() - cached.ts < PRODUCTS_CACHE_TTL_MS) {
          setProducts(cached.products || []);
          setLoading(false);
          // background refresh (optional)
          try {
            const fresh = await fetchProducts();
            setProducts(fresh);
            localStorage.setItem(
              PRODUCTS_CACHE_KEY,
              JSON.stringify({ ts: Date.now(), products: fresh })
            );
          } catch {}
          return;
        }
      }

      try {
        const list = await fetchProducts();
        setProducts(list);
        localStorage.setItem(
          PRODUCTS_CACHE_KEY,
          JSON.stringify({ ts: Date.now(), products: list })
        );
      } catch (e: any) {
        pushToast("error", `Не удалось загрузить товары: ${e?.message || e}`);
      } finally {
        setLoading(false);
      }
    };

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchProducts = async (): Promise<Product[]> => {
    const url = `${API_URL}?action=products`;
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const list = (data?.products || []) as any[];
    return list.map((p) => ({
      id: String(p.id),
      category: String(p.category || ""),
      name: String(p.name || ""),
      description: p.description ? String(p.description) : "",
      unit: String(p.unit || ""),
      price: Number(p.price) || 0,
      sort: Number(p.sort) || 0,
      image: p.image ? String(p.image) : "",
    }));
  };

  const canCheckout = cartCount > 0;

  const goCart = () => setTab("cart");
  const goCatalog = () => setTab("catalog");
  const goCheckout = () => {
    if (!canCheckout) {
      pushToast("info", "Корзина пустая.");
      return;
    }
    setTab("checkout");
  };

  // ----- Submit order -----
  const submitOrder = async () => {
    const nm = name.trim();
    const ph = phone.trim();
    const ad = address.trim();

    if (nm.length < 2) {
      pushToast("error", "Укажи имя (минимум 2 символа).");
      return;
    }
    if (ph.length < 6) {
      pushToast("error", "Укажи телефон (минимум 6 символов).");
      return;
    }
    if (ad.length < 5) {
      pushToast("error", "Укажи адрес доставки (минимум 5 символов).");
      return;
    }
    if (cartDetailed.length === 0) {
      pushToast("error", "Корзина пустая.");
      return;
    }

    const tg = getTgUser() || {};
    const items = cartDetailed.map((it) => ({
      id: it.product.id,
      name: it.product.name,
      unit: it.product.unit,
      price: it.product.price,
      qty: it.qty,
      total: it.lineTotal,
    }));

    const payload = {
      // IMPORTANT: токен не светим в коде, он должен браться из ENV на Vercel.
      // Если у тебя сейчас токен захардкожен в Apps Script и ты хочешь быстро — временно можно хранить тут,
      // но правильно: VITE_API_TOKEN.
      token: (import.meta as any).env?.VITE_API_TOKEN || "",
      tg,
      client: buildClientSignature(tg),
      name: nm,
      phone: ph,
      address: ad,
      comment: comment.trim(),
      items,
      total: cartTotal,
    };

    if (!payload.token) {
      pushToast(
        "error",
        "Нет токена VITE_API_TOKEN на Vercel. Добавь переменную окружения."
      );
      return;
    }

    setSending(true);
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      pushToast("success", "Заказ отправлен! Мы свяжемся с вами.");
      setCart([]);
      setName("");
      setPhone("");
      setAddress("");
      setComment("");
      setTab("catalog");
    } catch (e: any) {
      pushToast("error", `Не удалось отправить заказ: ${e?.message || e}`);
    } finally {
      setSending(false);
    }
  };

  // ----- Render -----
  return (
    <div className="appRoot">
      <style>{css}</style>

      {/* TOP HERO (как на твоей картинке) */}
      <div className="hero">
        <div className="heroOverlay" />
        <div className="heroContent">
          <div className="heroTitleRow">
            <div className="heroTitle">Нашенское</div>
          </div>

          {/* Tabs pill */}
          <div className="tabsPill">
            <button
              className={"tabBtn " + (tab === "catalog" ? "active" : "")}
              onClick={goCatalog}
            >
              Товары
            </button>
            <button
              className={"tabBtn " + (tab !== "catalog" ? "active" : "")}
              onClick={goCart}
            >
              🛒 Корзина ({cartCount})
            </button>
          </div>

          {/* Category chips only on catalog */}
          {tab === "catalog" && (
            <div className="chipsRow">
              <button
                className={"chip " + (selectedCategory === "__all__" ? "on" : "")}
                onClick={() => setSelectedCategory("__all__")}
              >
                Все
              </button>
              {categories.map((c) => (
                <button
                  key={c}
                  className={"chip " + (selectedCategory === c ? "on" : "")}
                  onClick={() => setSelectedCategory(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* BODY */}
      <div className="body">
        {loading && (
          <div className="loadingCard">
            <div className="spinner" />
            <div>Загружаем ассортимент…</div>
          </div>
        )}

        {!loading && tab === "catalog" && (
          <div className="list">
            {filteredProducts.map((p) => {
              const qty = getQty(p.id);
              return (
                <div key={p.id} className="productCard">
                  <div className="productMedia">
                    {p.image ? (
                      <img className="productImg" src={p.image} alt={p.name} />
                    ) : (
                      <div className="noPhoto">
                        <div className="noPhotoIcon" />
                        <div>Нет фото</div>
                      </div>
                    )}
                  </div>

                  <div className="productInfo">
                    <div className="productName">{p.name}</div>

                    {p.description ? (
                      <div className="productDesc">{p.description}</div>
                    ) : null}

                    <div className="productPriceRow">
                      <span className="price">
                        {formatPrice(p.price)} ₽
                      </span>
                      <span className="unit"> / {p.unit}</span>
                    </div>

                    <div className="productActions">
                      {qty <= 0 ? (
                        <button className="addBtn" onClick={() => inc(p.id)}>
                          🛒 В корзину
                        </button>
                      ) : (
                        <div className="qtyPill">
                          <button className="qtyBtn" onClick={() => dec(p.id)}>
                            −
                          </button>
                          <div className="qtyVal">{qty}</div>
                          <button className="qtyBtn" onClick={() => inc(p.id)}>
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {filteredProducts.length === 0 && (
              <div className="emptyCard">В этой категории пока нет товаров.</div>
            )}
          </div>
        )}

        {!loading && tab === "cart" && (
          <div className="panel">
            <div className="panelTitle">Корзина</div>

            {cartDetailed.length === 0 ? (
              <div className="emptyCard">
                Корзина пустая. Вернись в товары и добавь позиции.
                <div style={{ marginTop: 12 }}>
                  <button className="ghostBtn" onClick={goCatalog}>
                    ← В каталог
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="cartList">
                  {cartDetailed.map((it) => (
                    <div key={it.productId} className="cartRow">
                      <div className="cartLeft">
                        <div className="cartName">{it.product.name}</div>
                        <div className="cartMeta">
                          {formatPrice(it.product.price)} ₽ / {it.product.unit}
                        </div>
                      </div>

                      <div className="cartRight">
                        <div className="qtyPill small">
                          <button
                            className="qtyBtn"
                            onClick={() => dec(it.productId)}
                          >
                            −
                          </button>
                          <div className="qtyVal">{it.qty}</div>
                          <button
                            className="qtyBtn"
                            onClick={() => inc(it.productId)}
                          >
                            +
                          </button>
                        </div>

                        <div className="lineTotal">
                          {formatPrice(it.lineTotal)} ₽
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="totalBar">
                  <div>Итого</div>
                  <div className="totalVal">{formatPrice(cartTotal)} ₽</div>
                </div>

                <button className="primaryBtn" onClick={goCheckout}>
                  Оформить заказ
                </button>
                <button className="ghostBtn" onClick={goCatalog}>
                  ← Вернуться к товарам
                </button>
              </>
            )}
          </div>
        )}

        {!loading && tab === "checkout" && (
          <div className="panel">
            <div className="panelTitle">Оформление</div>

            <div className="form">
              <label className="label">
                Имя <span className="req">*</span>
              </label>
              <input
                className="input"
                placeholder="Как к вам обращаться?"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />

              <label className="label">
                Телефон <span className="req">*</span>
              </label>
              <input
                className="input"
                placeholder="+7 999 000-00-00"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />

              <label className="label">
                Адрес доставки <span className="req">*</span>
              </label>
              <input
                className="input"
                placeholder="улица, дом, подъезд, этаж, кв."
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />

              <label className="label">Комментарий (необязательно)</label>
              <textarea
                className="textarea"
                placeholder="код домофона, удобное время"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />

              <div className="totalBar">
                <div>Итого</div>
                <div className="totalVal">{formatPrice(cartTotal)} ₽</div>
              </div>

              <button
                className="primaryBtn"
                onClick={submitOrder}
                disabled={sending}
              >
                {sending ? "Отправляем…" : "Подтвердить заказ"}
              </button>

              <button
                className="ghostBtn"
                onClick={() => setTab("cart")}
                disabled={sending}
              >
                ← Назад в корзину
              </button>

              <div className="hint">
                Оплата пока не принимается в приложении — мы свяжемся после
                оформления.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Toasts */}
      <div className="toastStack">
        {toasts.map((t) => (
          <div key={t.id} className={"toast " + t.type}>
            {t.text}
          </div>
        ))}
      </div>

      <div className="footerHandle">@FarmShopingbot</div>
    </div>
  );
}

function buildClientSignature(tg: TgUser | null): string {
  if (!tg) return "unknown";
  const parts: string[] = [];
  if (tg.first_name) parts.push(tg.first_name);
  if (tg.last_name) parts.push(tg.last_name);
  if (tg.username) parts.push(`@${tg.username}`);
  if (tg.id) parts.push(`id:${tg.id}`);
  const s = parts.join(" ").trim();
  return s || "unknown";
}

const css = `
:root{
  --bg:#eef1f5;
  --card:#ffffff;
  --text:#101828;
  --muted:#667085;
  --shadow: 0 10px 30px rgba(16,24,40,0.12);
  --shadow2: 0 8px 18px rgba(16,24,40,0.10);
  --green:#2e7d32;
  --green2:#1f6b2b;
  --chip:#ffffff;
  --chipBorder: rgba(16,24,40,0.10);
  --line: rgba(16,24,40,0.10);
  --orange:#ff7a00;
}

*{ box-sizing:border-box; }
body{ margin:0; background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; }

.appRoot{
  min-height:100vh;
  background: var(--bg);
}

.hero{
  position: relative;
  height: 240px;
  background: url("/images/hero.jpg") center/cover no-repeat;
  border-bottom-left-radius: 18px;
  border-bottom-right-radius: 18px;
  overflow: hidden;
}
.heroOverlay{
  position:absolute; inset:0;
  background: linear-gradient(180deg, rgba(0,0,0,0.30), rgba(0,0,0,0.05) 60%, rgba(0,0,0,0.00));
}
.heroContent{
  position:relative;
  padding: 18px 16px 14px;
  max-width: 520px;
  margin: 0 auto;
}
.heroTitleRow{
  display:flex;
  flex-direction: column;
  gap: 6px;
  color:#fff;
  text-shadow: 0 2px 12px rgba(0,0,0,0.35);
  margin-bottom: 12px;
}
.heroTitle{
  font-size: 38px;
  font-weight: 900;
  letter-spacing: 0.2px;
}
.heroSub{
  font-size: 16px;
  font-weight: 700;
  opacity: 0.95;
}

.tabsPill{
  display:flex;
  background: rgba(255,255,255,0.92);
  border: 1px solid rgba(255,255,255,0.55);
  border-radius: 18px;
  padding: 8px;
  gap: 8px;
  box-shadow: var(--shadow2);
}
.tabBtn{
  flex:1;
  border: 0;
  border-radius: 14px;
  padding: 12px 12px;
  font-weight: 900;
  background: transparent;
  cursor: pointer;
  color: #0b1220;
}
.tabBtn.active{
  background: linear-gradient(180deg, var(--green), var(--green2));
  color:#fff;
  box-shadow: 0 8px 16px rgba(46,125,50,0.25);
}

.chipsRow{
  display:flex;
  gap: 10px;
  margin-top: 12px;
  overflow:auto;
  padding-bottom: 4px;
}
.chip{
  border: 1px solid var(--chipBorder);
  background: rgba(255,255,255,0.92);
  padding: 10px 16px;
  border-radius: 999px;
  font-weight: 900;
  cursor:pointer;
  white-space: nowrap;
  box-shadow: 0 6px 14px rgba(16,24,40,0.08);
}
.chip.on{
  background: linear-gradient(180deg, var(--green), var(--green2));
  color:#fff;
  border-color: rgba(46,125,50,0.35);
}

.body{
  max-width: 520px;
  margin: 0 auto;
  padding: 14px 14px 70px;
}

.loadingCard{
  background: var(--card);
  border-radius: 18px;
  padding: 18px;
  box-shadow: var(--shadow2);
  display:flex;
  gap: 12px;
  align-items:center;
}
.spinner{
  width:18px; height:18px; border-radius:999px;
  border: 2px solid rgba(16,24,40,0.15);
  border-top-color: rgba(16,24,40,0.55);
  animation: spin 0.9s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.list{
  display:flex;
  flex-direction: column;
  gap: 14px;
}

.productCard{
  display:flex;
  gap: 14px;
  background: var(--card);
  border-radius: 22px;
  padding: 14px;
  box-shadow: var(--shadow);
  border: 1px solid rgba(255,255,255,0.65);
}

.productMedia{
  width: 130px;
  min-width: 130px;
  height: 130px;
  border-radius: 16px;
  overflow:hidden;
  background: #f0f2f6;
  border: 1px solid rgba(16,24,40,0.08);
}
.productImg{
  width:100%;
  height:100%;
  object-fit: cover;
}
.noPhoto{
  width:100%; height:100%;
  display:flex;
  flex-direction: column;
  gap: 8px;
  align-items:center;
  justify-content:center;
  color: #667085;
  font-weight: 800;
}
.noPhotoIcon{
  width:54px; height:42px;
  border-radius: 10px;
  border: 2px solid rgba(102,112,133,0.45);
  position: relative;
}
.noPhotoIcon:before{
  content:'';
  position:absolute;
  left:10px; top:12px;
  width:10px; height:10px;
  border-radius:99px;
  background: rgba(102,112,133,0.45);
}
.noPhotoIcon:after{
  content:'';
  position:absolute;
  left:10px; bottom:10px;
  width:34px; height:16px;
  border-left: 2px solid rgba(102,112,133,0.45);
  border-bottom: 2px solid rgba(102,112,133,0.45);
  transform: skewX(-20deg);
}

.productInfo{
  flex:1;
  display:flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.productName{
  font-size: 24px;
  font-weight: 1000;
  line-height: 1.05;
}
.productDesc{
  color: var(--muted);
  font-weight: 650;
  font-size: 13px;
  line-height: 1.25;
}
.productPriceRow{
  display:flex;
  align-items: baseline;
  gap: 6px;
}
.price{
  font-size: 22px;
  font-weight: 1000;
  color: var(--orange);
}
.unit{
  color: var(--muted);
  font-weight: 800;
}

.productActions{
  margin-top: 4px;
  display:flex;
}
.addBtn{
  border:0;
  border-radius: 14px;
  padding: 12px 14px;
  font-weight: 1000;
  cursor:pointer;
  color:#fff;
  background: linear-gradient(180deg, var(--green), var(--green2));
  box-shadow: 0 10px 18px rgba(46,125,50,0.25);
}

.qtyPill{
  display:flex;
  align-items:center;
  background: rgba(46,125,50,0.12);
  border: 1px solid rgba(46,125,50,0.22);
  border-radius: 14px;
  overflow:hidden;
}
.qtyPill.small{ border-radius: 12px; }
.qtyBtn{
  border:0;
  background: transparent;
  width: 42px;
  height: 42px;
  cursor:pointer;
  font-size: 22px;
  font-weight: 1000;
  color: var(--green2);
}
.qtyVal{
  min-width: 38px;
  text-align:center;
  font-weight: 1000;
  color: #0b1220;
}

.panel{
  background: var(--card);
  border-radius: 22px;
  padding: 16px;
  box-shadow: var(--shadow);
}
.panelTitle{
  font-size: 22px;
  font-weight: 1000;
  margin-bottom: 12px;
}
.cartList{
  display:flex;
  flex-direction: column;
  gap: 10px;
}
.cartRow{
  display:flex;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border-radius: 16px;
  background: #f7f8fb;
  border: 1px solid rgba(16,24,40,0.06);
}
.cartName{
  font-weight: 1000;
}
.cartMeta{
  color: var(--muted);
  font-weight: 700;
  margin-top: 4px;
  font-size: 13px;
}
.cartRight{
  display:flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}
.lineTotal{
  font-weight: 1000;
}

.totalBar{
  display:flex;
  justify-content: space-between;
  align-items:center;
  margin: 14px 0 12px;
  padding: 12px 12px;
  border-radius: 16px;
  background: #f7f8fb;
  border: 1px solid rgba(16,24,40,0.06);
  font-weight: 1000;
}
.totalVal{
  font-size: 18px;
}

.primaryBtn{
  width:100%;
  border:0;
  border-radius: 16px;
  padding: 14px 14px;
  font-weight: 1000;
  cursor:pointer;
  color:#fff;
  background: linear-gradient(180deg, var(--green), var(--green2));
  box-shadow: 0 10px 18px rgba(46,125,50,0.25);
}
.primaryBtn:disabled{
  opacity: 0.65;
  cursor:not-allowed;
}

.ghostBtn{
  width:100%;
  margin-top: 10px;
  border-radius: 16px;
  padding: 13px 14px;
  font-weight: 1000;
  cursor:pointer;
  background: transparent;
  border: 1px solid rgba(16,24,40,0.14);
  color: #0b1220;
}

.form{
  display:flex;
  flex-direction: column;
  gap: 8px;
}
.label{
  font-weight: 900;
  margin-top: 8px;
}
.req{ color:#d92d20; margin-left: 2px; }
.input{
  border-radius: 14px;
  border: 1px solid rgba(16,24,40,0.12);
  padding: 12px 12px;
  font-weight: 800;
  outline:none;
  background: #fff;
}
.textarea{
  border-radius: 14px;
  border: 1px solid rgba(16,24,40,0.12);
  padding: 12px 12px;
  font-weight: 800;
  min-height: 84px;
  outline:none;
  background: #fff;
  resize: vertical;
}
.hint{
  margin-top: 10px;
  color: var(--muted);
  font-weight: 700;
  font-size: 13px;
}

.emptyCard{
  background: var(--card);
  border-radius: 18px;
  padding: 16px;
  box-shadow: var(--shadow2);
  color: var(--muted);
  font-weight: 800;
}

.toastStack{
  position: fixed;
  left: 0;
  right: 0;
  bottom: 64px;
  display:flex;
  flex-direction: column;
  align-items:center;
  gap: 10px;
  z-index: 9999;
  pointer-events: none;
}
.toast{
  pointer-events: none;
  max-width: 520px;
  width: calc(100% - 28px);
  border-radius: 14px;
  padding: 12px 14px;
  font-weight: 900;
  box-shadow: var(--shadow2);
  background: #0b1220;
  color: #fff;
}
.toast.success{ background: rgba(46,125,50,0.96); }
.toast.error{ background: rgba(217,45,32,0.96); }
.toast.info{ background: rgba(17,24,39,0.92); }

.footerHandle{
  position: fixed;
  left: 0; right: 0;
  bottom: 10px;
  text-align:center;
  color: rgba(255,255,255,0.85);
  font-weight: 900;
  text-shadow: 0 2px 10px rgba(0,0,0,0.35);
  pointer-events:none;
}
`;



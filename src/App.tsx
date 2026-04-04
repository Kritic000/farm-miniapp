import React, { useEffect, useMemo, useState } from "react";
import {
  API_PRODUCTS_URL,
  API_ORDER_URL,
  API_ORDERS_URL,
  API_CANCEL_URL,
} from "./config";

declare global {
  interface Window {
    ym?: (...args: any[]) => void;
    Telegram?: any;
  }
}

type Product = {
  id: string;
  category: string;
  name: string;
  unit: string;
  price: number;
  sort: number;
  description?: string;
  image?: string;
  sellMode?: "weight" | "piece" | string;
  minQty?: number;
  stepQty?: number;
  groupId?: string;
  variantName?: string;
  shortName?: string;
  badge?: string;
  storageType?: string;
  storageDays?: number | string;
  composition?: string;
  subtitle?: string;
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

type OrderItem = {
  id?: string;
  name: string;
  unit?: string;
  price: number;
  qty: number;
  sum: number;
};

type Order = {
  orderId: string;
  createdAt: string;
  status: string;
  name?: string;
  phone?: string;
  total: number;
  delivery: number;
  grandTotal: number;
  items: OrderItem[];
  cancelReason?: string;
};

type Toast = { type: "error" | "success" | "info"; text: string } | null;

const PRODUCTS_CACHE_KEY = "farm_products_cache_v3";
const PRODUCTS_CACHE_TTL_MS = 5 * 60 * 1000;
const LAST_PHONE_KEY = "farm_last_phone_v1";
const PENDING_ORDER_ID_KEY = "farm_pending_order_id_v1";

const DELIVERY_FEE = 200;
const FREE_DELIVERY_FROM = 2000;
const METRIKA_ID = 108236605;

function getTelegramWebApp() {
  try {
    const tg = window.Telegram?.WebApp;
    if (!tg) return null;
    return tg;
  } catch {
    return null;
  }
}

function getTgUser(): TgUser | null {
  try {
    const tg = getTelegramWebApp();
    return tg?.initDataUnsafe?.user || null;
  } catch {
    return null;
  }
}

function money(n: number) {
  const value = Number(n) || 0;
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: value % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 2,
  }).format(value);
}

function normalizePhone(p: string) {
  return String(p || "").replace(/\D+/g, "");
}

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function humanStatus(s: string) {
  const v = String(s || "").toLowerCase();
  if (v === "new") return "Новый";
  if (v === "accepted") return "Принят";
  if (v === "cooking" || v === "in_work") return "В работе";
  if (v === "delivering") return "Доставляется";
  if (v === "done" || v === "completed") return "Выполнен";
  if (v === "canceled" || v === "cancelled") return "Отменён";
  return s || "—";
}

function normalizeImagePath(img?: string): string | undefined {
  const s = String(img || "").trim();
  if (!s) return undefined;
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  if (s.startsWith("/")) return s;
  if (s.startsWith("public/")) return "/" + s.replace(/^public\//, "");
  return "/" + s;
}

function getGroupKey(product: Product) {
  return String(product.groupId || product.id || "").trim();
}

function sanitizeGroupTitle(value: string) {
  return String(value || "")
    .replace(/[\s,;:/|._-]+$/, "")
    .replace(/[\s]+$/, "")
    .trim();
}

function getSharedPrefix(values: string[]) {
  if (!values.length) return "";
  let prefix = values[0] || "";

  for (let i = 1; i < values.length; i += 1) {
    const current = values[i] || "";
    let j = 0;
    const max = Math.min(prefix.length, current.length);

    while (j < max && prefix[j].toLowerCase() === current[j].toLowerCase()) {
      j += 1;
    }

    prefix = prefix.slice(0, j);
    if (!prefix) break;
  }

  return sanitizeGroupTitle(prefix);
}

function getGroupTitle(group: Product[]) {
  if (!group.length) return "";

  const names = group
    .map((p) => String(p.name || "").trim())
    .filter(Boolean);

  if (!names.length) return "";

  const prefix = getSharedPrefix(names);
  if (prefix.length >= 3) return prefix;

  return names[0];
}

function getProductSubtitle(product: Product, fallbackTitle?: string) {
  const explicit = String(product.subtitle || "").trim();
  if (explicit) return explicit;

  const raw = String(product.description || "").trim();
  if (!raw) return "";

  const firstSentence = raw.split(/\n|[.!?]/).map((s) => s.trim()).find(Boolean) || "";
  if (!firstSentence) return "";

  if (fallbackTitle) {
    const normalizedTitle = fallbackTitle.toLowerCase();
    if (firstSentence.toLowerCase() === normalizedTitle) return "";
  }

  if (/^состав\s*:/i.test(firstSentence)) return "";
  if (/^срок\s*хранения\s*:/i.test(firstSentence)) return "";

  return firstSentence;
}

function getVariantLabel(product: Product) {
  const shortName = String(product.shortName || "").trim();
  if (shortName) return shortName;

  const variantName = String(product.variantName || "").trim();
  if (variantName) return variantName;

  return String(product.unit || "").trim() || String(product.name || "").trim();
}

function getBadgeText(group: Product[], selected: Product) {
  const direct = String(selected.badge || "").trim();
  if (direct) return direct;

  const fromGroup = group
    .map((p) => String(p.badge || "").trim())
    .find(Boolean);

  return fromGroup || "";
}

function getStorageTypeLabel(product: Product) {
  return String(product.storageType || "").trim();
}

function loadProductsCache(): { ts: number; products: Product[] } | null {
  try {
    const raw = localStorage.getItem(PRODUCTS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.ts || !Array.isArray(parsed?.products)) return null;
    return { ts: parsed.ts, products: parsed.products };
  } catch {
    return null;
  }
}

function saveProductsCache(products: Product[]) {
  try {
    localStorage.setItem(
      PRODUCTS_CACHE_KEY,
      JSON.stringify({ ts: Date.now(), products })
    );
  } catch {}
}

function loadLastPhone(): string {
  try {
    return localStorage.getItem(LAST_PHONE_KEY) || "";
  } catch {
    return "";
  }
}

function saveLastPhone(phone: string) {
  try {
    localStorage.setItem(LAST_PHONE_KEY, phone);
  } catch {}
}

async function fetchWithTimeout(
  input: RequestInfo,
  init: RequestInit & { timeoutMs?: number } = {}
) {
  const { timeoutMs = 35000, ...rest } = init;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(input, { ...rest, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

function makeOrderId() {
  const pending = sessionStorage.getItem(PENDING_ORDER_ID_KEY);
  if (pending) return pending;

  const id =
    (crypto as any)?.randomUUID?.() ||
    `oid_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  sessionStorage.setItem(PENDING_ORDER_ID_KEY, id);
  return id;
}

function clearPendingOrderId() {
  try {
    sessionStorage.removeItem(PENDING_ORDER_ID_KEY);
  } catch {}
}

function getUtmData() {
  try {
    const params = new URLSearchParams(window.location.search);
    return {
      utmSource: (params.get("utm_source") || "").trim(),
      utmMedium: (params.get("utm_medium") || "").trim(),
      utmCampaign: (params.get("utm_campaign") || "").trim(),
    };
  } catch {
    return {
      utmSource: "",
      utmMedium: "",
      utmCampaign: "",
    };
  }
}

function detectSource() {
  const { utmSource } = getUtmData();
  if (utmSource) return utmSource.toLowerCase();
  return "direct";
}

function trackVisitSource() {
  try {
    const source = detectSource();
    const ymReady = typeof window.ym === "function";

    if (ymReady) {
      window.ym(METRIKA_ID, "hit", window.location.href);
    }

    console.log("Metrika visit sent:", {
      source,
      url: window.location.href,
      ymReady,
    });
  } catch (err) {
    console.error("Metrika visit error:", err);
  }
}

function trackOrderCreated() {
  try {
    const source = detectSource();
    const ymReady = typeof window.ym === "function";

    if (ymReady) {
      window.ym(METRIKA_ID, "reachGoal", "order_created", {
        source,
        medium: "social",
        campaign: "orders",
      });
    }

    console.log("Metrika goal sent:", {
      goal: "order_created",
      source,
      medium: "social",
      campaign: "orders",
      ymReady,
    });
  } catch (err) {
    console.error("Metrika track error:", err);
  }
}

function getSellMode(product: Product): "weight" | "piece" {
  return String(product.sellMode || "").toLowerCase() === "weight"
    ? "weight"
    : "piece";
}

function getMinQty(product: Product) {
  const raw = Number(product.minQty);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return getSellMode(product) === "weight" ? 300 : 1;
}

function getStepQty(product: Product) {
  const raw = Number(product.stepQty);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return getSellMode(product) === "weight" ? 50 : 1;
}

function formatKg(kg: number) {
  return Number.isInteger(kg) ? String(kg) : String(kg).replace(".", ",");
}

function getQtyLabel(product: Product, qty: number) {
  if (getSellMode(product) !== "weight") {
    return `${qty} шт`;
  }

  if (qty >= 1000) {
    return `${formatKg(qty / 1000)} кг`;
  }

  return `${qty} г`;
}

function getDisplayUnit(product: Product) {
  return getSellMode(product) === "weight" ? "г" : "шт";
}

function getWeightPriceBase(product: Product) {
  const unit = String(product.unit || "").trim().toLowerCase();

  if (
    unit.includes("0,1 кг") ||
    unit.includes("0.1 кг") ||
    unit.includes("100 г") ||
    unit.includes("100г")
  ) {
    return 100;
  }

  return 1000;
}

function normalizeQtyForProduct(product: Product, rawQty: number) {
  const mode = getSellMode(product);
  const minQty = getMinQty(product);
  const stepQty = getStepQty(product);

  if (!Number.isFinite(rawQty)) return minQty;

  if (mode === "weight") {
    const rounded = Math.round(rawQty / stepQty) * stepQty;
    return Math.max(minQty, rounded);
  }

  const rounded = Math.round(rawQty / stepQty) * stepQty;
  return Math.max(minQty, rounded);
}

function calcLineSum(product: Product, qty: number) {
  if (getSellMode(product) === "weight") {
    const base = getWeightPriceBase(product);
    return (qty / base) * product.price;
  }
  return qty * product.price;
}

function useIsMobile(breakpoint = 720) {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth <= breakpoint;
  });

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= breakpoint);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpoint]);

  return isMobile;
}

export default function App() {
  const isMobile = useIsMobile();

  const [loading, setLoading] = useState(true);
  const [loadingHint, setLoadingHint] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [toast, setToast] = useState<Toast>(null);

  const [products, setProducts] = useState<Product[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("Все");
  const [tab, setTab] = useState<"catalog" | "cart" | "checkout" | "orders">(
    "catalog"
  );

  const [cart, setCart] = useState<Record<string, CartItem>>({});
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({});
  const [selectedVariantByGroup, setSelectedVariantByGroup] = useState<Record<string, string>>({});

  const [address, setAddress] = useState("");
  const [comment, setComment] = useState("");

  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState(() => loadLastPhone());

  const [sending, setSending] = useState(false);

  const [zoomSrc, setZoomSrc] = useState<string | null>(null);

  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);

  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  useEffect(() => {
    const tg = getTelegramWebApp();

    if (tg?.initDataUnsafe) {
      try {
        tg.ready();
        tg.expand();
      } catch {}
    }

    const t = setTimeout(() => {
      trackVisitSource();
    }, 700);

    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const p = phone.trim();
    if (p.length >= 6) saveLastPhone(p);
  }, [phone]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const cached = loadProductsCache();
      const hasFreshCache = !!(
        cached && Date.now() - cached.ts < PRODUCTS_CACHE_TTL_MS
      );

      try {
        setLoading(true);
        setError("");
        setLoadingHint("");

        if (hasFreshCache && cached) {
          setProducts(cached.products);
          setLoading(false);
          setLoadingHint("Показан сохранённый ассортимент. Обновляем данные…");
        }

        const url = `${API_PRODUCTS_URL}?nocache=1&t=${Date.now()}`;
        const res = await fetchWithTimeout(url, {
          method: "GET",
          timeoutMs: 35000,
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        if (data?.error) throw new Error(data.error);

        const list: Product[] = (data.products || []).map((p: Product) => ({
          ...p,
          image: normalizeImagePath(p.image),
        }));

        if (cancelled) return;

        setProducts(list);
        saveProductsCache(list);

        setLoading(false);
        setError("");
        setLoadingHint(hasFreshCache ? "Ассортимент обновлён." : "");
      } catch (e: any) {
        if (cancelled) return;

        if (cached) {
          setProducts(cached.products);
          setLoading(false);
          setError("");
          setLoadingHint(
            "Не удалось получить свежие данные. Показан сохранённый ассортимент."
          );
          return;
        }

        if (e?.name === "AbortError") {
          setError("Сервер долго отвечает. Попробуйте ещё раз.");
        } else {
          setError(e?.message || "Ошибка загрузки товаров");
        }

        setLoading(false);
        setLoadingHint("");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();

    products.forEach((p) => {
      const cat = String(p.category || "").trim();
      if (!cat) return;
      if (cat.toLowerCase() === "акции") return;
      set.add(cat);
    });

    return ["Акции", "Все", ...Array.from(set)];
  }, [products]);

  useEffect(() => {
    if (!categories.includes(activeCategory)) {
      setActiveCategory("Все");
    }
  }, [categories, activeCategory]);

  const filteredProducts = useMemo(() => {
    if (activeCategory === "Все") return products;

    if (activeCategory === "Акции") {
      return products.filter(
        (p) => String(p.category || "").trim().toLowerCase() === "акции"
      );
    }

    return products.filter((p) => p.category === activeCategory);
  }, [products, activeCategory]);

  const groupedProducts = useMemo(() => {
    const map = new Map<string, Product[]>();

    filteredProducts.forEach((product) => {
      const key = getGroupKey(product);
      const current = map.get(key) || [];
      current.push(product);
      map.set(key, current);
    });

    return Array.from(map.entries())
      .map(([groupKey, items]) => {
        const sorted = [...items].sort((a, b) => {
          const aSort = Number(a.sort) || 0;
          const bSort = Number(b.sort) || 0;
          return aSort - bSort;
        });

        const minSort = Math.min(
          ...sorted.map((item) => Number(item.sort) || Number.MAX_SAFE_INTEGER)
        );

        return {
          groupKey,
          items: sorted,
          minSort,
        };
      })
      .sort((a, b) => a.minSort - b.minSort);
  }, [filteredProducts]);

  const cartItems = useMemo(() => Object.values(cart), [cart]);

  const cartCount = useMemo(() => cartItems.length, [cartItems]);

  const total = useMemo(
    () => cartItems.reduce((s, it) => s + calcLineSum(it.product, it.qty), 0),
    [cartItems]
  );

  const delivery = useMemo(() => {
    if (total <= 0) return 0;
    return total < FREE_DELIVERY_FROM ? DELIVERY_FEE : 0;
  }, [total]);

  const grandTotal = useMemo(() => total + delivery, [total, delivery]);

  function qtyOf(productId: string) {
    return cart[productId]?.qty || 0;
  }

  function clearQtyDraft(productId: string) {
    setQtyDrafts((prev) => {
      const next = { ...prev };
      delete next[productId];
      return next;
    });
  }

  function addToCart(p: Product) {
    const initialQty = getMinQty(p);

    setCart((prev) => {
      const next = { ...prev };
      const cur = next[p.id];
      next[p.id] = {
        product: p,
        qty: cur ? cur.qty : initialQty,
      };
      return next;
    });

    clearQtyDraft(p.id);
    setToast({ type: "info", text: "Добавлено в корзину" });
  }

  function removeFromCart(productId: string) {
    setCart((prev) => {
      const next = { ...prev };
      delete next[productId];
      return next;
    });
    clearQtyDraft(productId);
  }

  function setQty(product: Product, rawQty: number) {
    const qty = normalizeQtyForProduct(product, rawQty);

    setCart((prev) => {
      const next = { ...prev };
      next[product.id] = { product, qty };
      return next;
    });

    clearQtyDraft(product.id);
  }

  function increaseQty(product: Product) {
    const current = qtyOf(product.id) || getMinQty(product);
    setQty(product, current + getStepQty(product));
  }

  function decreaseQty(product: Product) {
    const current = qtyOf(product.id) || getMinQty(product);
    const minQty = getMinQty(product);
    const stepQty = getStepQty(product);
    const next = current - stepQty;
    setQty(product, next < minQty ? minQty : next);
  }

  function handleDraftChange(productId: string, value: string) {
    const digits = value.replace(/[^\d]/g, "");
    setQtyDrafts((prev) => ({ ...prev, [productId]: digits }));
  }

  function commitDraft(product: Product) {
    const currentQty = qtyOf(product.id) || getMinQty(product);
    const raw = qtyDrafts[product.id];

    if (!raw) {
      clearQtyDraft(product.id);
      setQty(product, currentQty);
      return;
    }

    const parsed = Number(raw);
    setQty(product, parsed);
  }

  function validateCheckout(): string | null {
    if (customerName.trim().length < 2) return "Укажи имя (минимум 2 символа).";
    if (phone.trim().length < 6) return "Укажи телефон (минимум 6 символов).";
    if (address.trim().length < 5)
      return "Укажи адрес доставки (минимум 5 символов).";
    if (cartItems.length === 0) return "Корзина пустая.";
    return null;
  }

  async function submitOrder() {
    const validationError = validateCheckout();
    if (validationError) {
      setToast({ type: "error", text: validationError });
      return;
    }

    const orderId = makeOrderId();
    const tgUser = getTgUser();
    const { utmSource, utmMedium, utmCampaign } = getUtmData();

    const items = cartItems.map((it) => ({
      id: it.product.id,
      name: it.product.name,
      unit: getDisplayUnit(it.product),
      price: it.product.price,
      qty: it.qty,
      sum: Number(calcLineSum(it.product, it.qty).toFixed(2)),
    }));

    const payload = {
      name: customerName,
      phone,
      address,
      comment,
      items,
      total: Number(total.toFixed(2)),
      delivery: Number(delivery.toFixed(2)),
      grandTotal: Number(grandTotal.toFixed(2)),
      orderId,
      utmSource,
      utmMedium,
      utmCampaign,
      tg: tgUser
        ? {
            id: tgUser.id || "",
            username: tgUser.username || "",
            first_name: tgUser.first_name || "",
            last_name: tgUser.last_name || "",
          }
        : {},
    };

    try {
      setSending(true);

      const res = await fetch(API_ORDER_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      if (data?.error) throw new Error(data.error);

      if (!data?.duplicate) {
        trackOrderCreated();
      }

      setToast({
        type: "success",
        text: data?.duplicate
          ? "✅ Заказ уже был отправлен (повтор не записан)."
          : "✅ Заказ отправлен! Мы свяжемся для подтверждения.",
      });

      clearPendingOrderId();
      setCart({});
      setQtyDrafts({});
      setAddress("");
      setComment("");
      setCustomerName("");
      setTab("catalog");
    } catch (e: any) {
      setToast({
        type: "error",
        text: `Не удалось отправить заказ: ${e?.message || "Ошибка"}`,
      });
    } finally {
      setSending(false);
    }
  }

  async function loadMyOrders() {
    const tg = getTgUser();
    const tgUserId = tg?.id ? String(tg.id) : "";
    const phoneDigits = normalizePhone(phone);

    if (phoneDigits.length < 6 && !tgUserId) {
      setOrders([]);
      setOrdersError("Укажи телефон, чтобы показать твои заказы.");
      return;
    }

    try {
      setOrdersLoading(true);
      setOrdersError("");

      const url =
        `${API_ORDERS_URL}` +
        `?tgUserId=${encodeURIComponent(tgUserId)}` +
        `&phone=${encodeURIComponent(phoneDigits)}` +
        `&limit=30`;

      const res = await fetchWithTimeout(url, {
        method: "GET",
        timeoutMs: 35000,
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      if (data?.error) throw new Error(data.error);

      const list: Order[] = Array.isArray(data.orders) ? data.orders : [];
      setOrders(list);
    } catch (e: any) {
      setOrdersError(e?.message || "Не удалось загрузить заказы");
    } finally {
      setOrdersLoading(false);
    }
  }

  async function cancelOrderRequest(orderId: string, reason: string) {
    const r = reason.trim();
    if (r.length < 3) {
      setToast({
        type: "error",
        text: "Укажи причину отмены (минимум 3 символа).",
      });
      return;
    }

    const tg = getTgUser();
    const tgUserId = tg?.id ? String(tg.id) : "";
    const phoneDigits = normalizePhone(phone);

    try {
      const res = await fetch(API_CANCEL_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          orderId,
          reason: r,
          tgUserId,
          phone: phoneDigits,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      if (data?.error) throw new Error(data.error);

      setToast({ type: "success", text: "Заказ отменён." });
      setCancelOrderId(null);
      setCancelReason("");
      loadMyOrders();
    } catch (e: any) {
      setToast({
        type: "error",
        text: e?.message || "Не удалось отменить заказ",
      });
    }
  }

  useEffect(() => {
    if (tab !== "orders") return;
    loadMyOrders();
  }, [tab]);


  function getSelectedProduct(group: Product[]) {
    const fallback = group[0];
    const groupKey = getGroupKey(fallback);
    const selectedId = selectedVariantByGroup[groupKey];
    return group.find((item) => item.id === selectedId) || fallback;
  }

  function selectVariant(groupKey: string, productId: string) {
    setSelectedVariantByGroup((prev) => ({
      ...prev,
      [groupKey]: productId,
    }));
  }

  function renderQtyControls(product: Product) {
    const q = qtyOf(product.id);
    const mode = getSellMode(product);
    const draftValue = qtyDrafts[product.id];
    const displayValue = draftValue !== undefined ? draftValue : String(q);

    if (q === 0) {
      return (
        <button style={styles.buyBtn} onClick={() => addToCart(product)}>
          {mode === "weight" ? `Выбрать от ${getMinQty(product)} г` : "В корзину"}
        </button>
      );
    }

    return (
      <div style={styles.qtyBlock}>
        <div style={styles.qtyTopLine}>
          <button style={styles.qtyBtnWide} onClick={() => decreaseQty(product)}>
            −{mode === "weight" ? `${getStepQty(product)} г` : "1"}
          </button>

          <input
            style={styles.qtyInput}
            value={displayValue}
            onChange={(e) => handleDraftChange(product.id, e.target.value)}
            onBlur={() => commitDraft(product)}
            inputMode="numeric"
          />

          <button style={styles.qtyBtnWide} onClick={() => increaseQty(product)}>
            +{mode === "weight" ? `${getStepQty(product)} г` : "1"}
          </button>
        </div>

        <div style={styles.qtyHint}>
          {mode === "weight"
            ? `Мин. ${getQtyLabel(product, getMinQty(product))}, шаг ${getStepQty(
                product
              )} г`
            : `Мин. ${getMinQty(product)} шт, шаг ${getStepQty(product)} шт`}
        </div>

        <button
          style={styles.removeBtnText}
          onClick={() => removeFromCart(product.id)}
        >
          Удалить
        </button>
      </div>
    );
  }

  const mobileCartRowStyle: React.CSSProperties = isMobile
    ? {
        display: "grid",
        gridTemplateColumns: "1fr",
        gap: 12,
        alignItems: "start",
        padding: "14px 0",
        borderBottom: "1px solid #f0e7dc",
      }
    : styles.cartRow2;

  const mobileCartRightStyle: React.CSSProperties = isMobile
    ? {
        display: "grid",
        gap: 8,
        minWidth: 0,
      }
    : styles.cartRightColumn;

  const mobileCartControlsStyle: React.CSSProperties = isMobile
    ? {
        display: "grid",
        gridTemplateColumns: "1fr 80px 1fr",
        gap: 8,
        alignItems: "center",
        width: "100%",
      }
    : styles.cartQtyWeight;

  return (
    <div style={styles.page}>
      {toast && (
        <div
          style={{
            ...styles.toast,
            ...(toast.type === "error" ? styles.toastError : {}),
            ...(toast.type === "success" ? styles.toastSuccess : {}),
            ...(toast.type === "info" ? styles.toastInfo : {}),
          }}
        >
          <div style={{ fontWeight: 700 }}>{toast.text}</div>
          <button style={styles.toastClose} onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      )}

      {zoomSrc && (
        <div style={styles.zoomOverlay} onClick={() => setZoomSrc(null)}>
          <div style={styles.zoomBox} onClick={(e) => e.stopPropagation()}>
            <button style={styles.zoomClose} onClick={() => setZoomSrc(null)}>
              ×
            </button>
            <img src={zoomSrc} alt="Фото товара" style={styles.zoomImg} />
          </div>
        </div>
      )}

      {cancelOrderId && (
        <div style={styles.zoomOverlay} onClick={() => setCancelOrderId(null)}>
          <div style={styles.zoomBox} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 800, marginBottom: 10 }}>
              Причина отмены заказа
            </div>

            <textarea
              style={styles.textarea}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Например: ошибся адресом, не актуально, изменились планы…"
            />

            <button
              style={styles.primaryBtn}
              onClick={() => cancelOrderRequest(cancelOrderId, cancelReason)}
            >
              Подтвердить отмену
            </button>

            <button
              style={styles.secondaryBtn}
              onClick={() => {
                setCancelOrderId(null);
                setCancelReason("");
              }}
            >
              Закрыть
            </button>
          </div>
        </div>
      )}

      {tab === "catalog" && cartCount > 0 && (
  <button
    style={styles.floatingCartBtn}
    onClick={() => setTab("cart")}
    aria-label="Открыть корзину"
  >
    <span style={styles.floatingCartIcon}>🛒</span>
    <span style={styles.floatingCartText}>Корзина</span>
    <span style={styles.floatingCartCount}>{cartCount}</span>
  </button>
)}

      <div style={styles.container}>
        <div style={styles.headerGrid}>
          <div style={styles.headerLeft}>
            <div style={styles.title}>Нашенское</div>

            <button
              style={{
                ...styles.navBtn,
                ...(tab === "catalog" ? styles.navBtnActive : {}),
              }}
              onClick={() => setTab("catalog")}
            >
              Товары
            </button>
          </div>

          <div style={styles.headerRight}>
            <button
              style={{
                ...styles.navBtn,
                ...(tab === "cart" || tab === "checkout"
                  ? styles.navBtnActive
                  : {}),
              }}
              onClick={() => setTab("cart")}
            >
              🛒 Корзина ({cartCount})
            </button>

            <button
              style={{
                ...styles.navBtn,
                ...(tab === "orders" ? styles.navBtnActive : {}),
              }}
              onClick={() => setTab("orders")}
            >
              📦 Мои заказы
            </button>
          </div>
        </div>

        {!getTelegramWebApp() && (
          <div style={styles.infoMuted}>
            Обычная веб-версия сайта. История заказов работает по номеру телефона.
          </div>
        )}

        {loading && <div style={styles.info}>Загрузка ассортимента…</div>}
        {!loading && loadingHint && (
          <div style={styles.infoMuted}>{loadingHint}</div>
        )}
        {error && (
          <div style={{ ...styles.info, color: "#c62828" }}>{error}</div>
        )}

        {!loading && !error && (
          <>
            {tab === "catalog" && (
              <>
                <div style={styles.chipsRow}>
                  {categories.map((c) => (
                    <button
                      key={c}
                      style={{
                        ...styles.chip,
                        ...(c === "Акции" ? styles.chipPromo : {}),
                        ...(activeCategory === c
                          ? c === "Акции"
                            ? styles.chipPromoActive
                            : styles.chipActive
                          : {}),
                      }}
                      onClick={() => setActiveCategory(c)}
                    >
                      {c === "Акции" ? "🔥 Акции" : c}
                    </button>
                  ))}
                </div>

                <div style={styles.list}>
                  {groupedProducts.map(({ groupKey, items }) => {
                    const selected = getSelectedProduct(items);
                    const groupTitle = getGroupTitle(items);
                    const subtitle = getProductSubtitle(selected, groupTitle);
                    const badgeText = getBadgeText(items, selected);
                    const hasVariants = items.length > 1;
                    const selectedQty = qtyOf(selected.id);
                    const minPrice = Math.min(...items.map((item) => Number(item.price) || 0));
                    const imageSrc =
                      selected.image ||
                      items.map((item) => item.image).find(Boolean) ||
                      "";
                    const storageTypeLabel = getStorageTypeLabel(selected);
                    const selectedUnit = String(selected.unit || "").trim();

                    return (
                      <div key={groupKey} style={styles.card}>
                        {imageSrc ? (
                          <img
                            src={imageSrc}
                            alt={groupTitle || selected.name}
                            style={styles.cardImg}
                            loading="lazy"
                            decoding="async"
                            onClick={() => setZoomSrc(imageSrc || null)}
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display =
                                "none";
                            }}
                          />
                        ) : (
                          <div style={styles.cardImgPlaceholder}>Нет фото</div>
                        )}

                        <div style={styles.cardBody}>
                          {badgeText ? (
                            <div style={styles.topBadgesRow}>
                              <span style={styles.sellingBadge}>{badgeText}</span>
                            </div>
                          ) : null}

                          <div style={styles.cardName} title={groupTitle || selected.name}>
                            {groupTitle || selected.name}
                          </div>

                          {subtitle ? (
                            <div style={styles.cardDesc} title={subtitle}>
                              {subtitle}
                            </div>
                          ) : null}

                          <div style={styles.cardMeta}>
                            <span style={styles.price}>
                              {hasVariants ? `от ${money(minPrice)} ₽` : `${money(selected.price)} ₽`}
                            </span>
                            {selectedUnit ? (
                              <span style={styles.unit}> / {selectedUnit}</span>
                            ) : null}
                          </div>

                          {hasVariants ? (
                            <div style={styles.variantBlock}>
                              <div style={styles.variantTitle}>Варианты</div>

                              <div style={styles.variantList}>
                                {items.map((item) => {
                                  const isActive = item.id === selected.id;
                                  return (
                                    <button
                                      key={item.id}
                                      style={{
                                        ...styles.variantChip,
                                        ...(isActive ? styles.variantChipActive : {}),
                                      }}
                                      onClick={() => selectVariant(groupKey, item.id)}
                                    >
                                      {getVariantLabel(item)}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}

                          {storageTypeLabel ? (
                            <div style={styles.metaLine}>
                              <span style={styles.metaLabel}>Тип:</span> {storageTypeLabel}
                            </div>
                          ) : null}

                          {String(selected.storageDays || "").trim() ? (
                            <div style={styles.metaLine}>
                              <span style={styles.metaLabel}>Срок хранения:</span>{" "}
                              {String(selected.storageDays).trim()}
                              {String(selected.storageDays).trim().match(/д|сут|day/i) ? "" : " дней"}
                            </div>
                          ) : null}

                          {String(selected.composition || "").trim() ? (
                            <div style={styles.metaLine}>
                              <span style={styles.metaLabel}>Состав:</span>{" "}
                              {String(selected.composition).trim()}
                            </div>
                          ) : null}

                          {getSellMode(selected) === "weight" && (
                            <div style={styles.weightBadge}>
                              От {getQtyLabel(selected, getMinQty(selected))}, шаг{" "}
                              {getStepQty(selected)} г
                            </div>
                          )}

                          {selectedQty > 0 && (
                            <div style={styles.currentQtyLabel}>
                              В корзине: {getQtyLabel(selected, selectedQty)}
                            </div>
                          )}

                          {renderQtyControls(selected)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {tab === "cart" && (
              <div style={styles.panel}>
                {cartItems.length === 0 ? (
                  <div style={styles.info}>Корзина пустая</div>
                ) : (
                  <>
                    {cartItems.map((it) => {
                      const product = it.product;
                      const mode = getSellMode(product);
                      const draftValue = qtyDrafts[product.id];
                      const displayValue =
                        draftValue !== undefined ? draftValue : String(it.qty);

                      return (
                        <div key={it.product.id} style={mobileCartRowStyle}>
                          <div style={styles.cartLeft2}>
                            <div style={styles.cartName2} title={it.product.name}>
                              {it.product.name}
                            </div>
                            <div style={styles.cartMeta2}>
                              {money(it.product.price)} ₽ / {it.product.unit}
                            </div>
                            <div style={styles.cartMeta2}>
                              Выбрано: {getQtyLabel(product, it.qty)}
                            </div>
                          </div>

                          <div style={mobileCartRightStyle}>
                            <div
                              style={{
                                ...styles.cartSum2,
                                ...(isMobile ? { textAlign: "left" } : {}),
                              }}
                            >
                              {money(calcLineSum(product, it.qty))} ₽
                            </div>

                            <div style={mobileCartControlsStyle}>
                              <button
                                style={styles.qtyBtnWide}
                                onClick={() => decreaseQty(product)}
                              >
                                −{mode === "weight" ? `${getStepQty(product)} г` : "1"}
                              </button>

                              <input
                                style={styles.qtyInput}
                                value={displayValue}
                                onChange={(e) =>
                                  handleDraftChange(product.id, e.target.value)
                                }
                                onBlur={() => commitDraft(product)}
                                inputMode="numeric"
                              />

                              <button
                                style={styles.qtyBtnWide}
                                onClick={() => increaseQty(product)}
                              >
                                +{mode === "weight" ? `${getStepQty(product)} г` : "1"}
                              </button>
                            </div>

                            <div
                              style={{
                                ...styles.qtyHint,
                                ...(isMobile ? { textAlign: "left" } : {}),
                              }}
                            >
                              {mode === "weight"
                                ? `Мин. ${getQtyLabel(product, getMinQty(product))}`
                                : `Мин. ${getMinQty(product)} шт`}
                            </div>

                            <button
                              style={styles.removeBtnText}
                              onClick={() => removeFromCart(product.id)}
                            >
                              Удалить
                            </button>
                          </div>
                        </div>
                      );
                    })}

                    <div style={styles.totalBlock}>
                      <div style={styles.totalRow}>
                        <div>Товары</div>
                        <div style={{ fontWeight: 700 }}>{money(total)} ₽</div>
                      </div>

                      <div style={styles.totalRow}>
                        <div>
                          Доставка{" "}
                          {delivery === 0 ? (
                            <span style={styles.freeTag}>бесплатно</span>
                          ) : (
                            <span style={styles.mutedTag}>
                              до {money(FREE_DELIVERY_FROM)} ₽
                            </span>
                          )}
                        </div>
                        <div style={{ fontWeight: 700 }}>{money(delivery)} ₽</div>
                      </div>

                      <div style={styles.totalRowBig}>
                        <div>Итого</div>
                        <div style={{ fontWeight: 800 }}>
                          {money(grandTotal)} ₽
                        </div>
                      </div>
                    </div>

                    <button
                      style={styles.primaryBtn}
                      onClick={() => setTab("checkout")}
                    >
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
                  Имя <span style={{ color: "#c62828" }}>*</span>
                </label>
                <input
                  style={styles.input}
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Как к вам обращаться?"
                  autoComplete="name"
                />

                <label style={styles.label}>
                  Телефон <span style={{ color: "#c62828" }}>*</span>
                </label>
                <input
                  style={styles.input}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+7..."
                  autoComplete="tel"
                  inputMode="tel"
                />

                <label style={styles.label}>
                  Адрес <span style={{ color: "#c62828" }}>*</span>
                </label>
                <textarea
                  style={styles.textarea}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Улица, дом, квартира / подъезд / код домофона"
                />

                <label style={styles.label}>Комментарий к заказу</label>
                <textarea
                  style={styles.textarea}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Например: позвонить за 10 минут"
                />

                <div style={styles.totalBlock}>
                  <div style={styles.totalRow}>
                    <div>Товары</div>
                    <div style={{ fontWeight: 700 }}>{money(total)} ₽</div>
                  </div>
                  <div style={styles.totalRow}>
                    <div>Доставка</div>
                    <div style={{ fontWeight: 700 }}>{money(delivery)} ₽</div>
                  </div>
                  <div style={styles.totalRowBig}>
                    <div>Итого</div>
                    <div style={{ fontWeight: 800 }}>{money(grandTotal)} ₽</div>
                  </div>
                </div>

                <button
                  style={{
                    ...styles.primaryBtn,
                    ...(sending ? styles.primaryBtnDisabled : {}),
                  }}
                  onClick={submitOrder}
                  disabled={sending}
                >
                  {sending ? "Отправляем..." : "Подтвердить заказ"}
                </button>

                <button
                  style={styles.secondaryBtn}
                  onClick={() => setTab("cart")}
                >
                  Назад в корзину
                </button>
              </div>
            )}

            {tab === "orders" && (
              <div style={styles.panel}>
                <div style={styles.h2}>Мои заказы</div>

                <label style={styles.label}>Телефон</label>
                <input
                  style={styles.input}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+7..."
                  autoComplete="tel"
                  inputMode="tel"
                />

                <button
                  style={styles.primaryBtn}
                  onClick={loadMyOrders}
                  disabled={ordersLoading}
                >
                  {ordersLoading ? "Загрузка..." : "Обновить"}
                </button>

                {ordersError && (
                  <div style={{ ...styles.info, color: "#c62828" }}>
                    {ordersError}
                  </div>
                )}

                {!ordersLoading && !ordersError && orders.length === 0 && (
                  <div style={styles.info}>Заказы не найдены</div>
                )}

                <div style={styles.ordersList}>
                  {orders.map((o) => {
                    const canCancel =
                      String(o.status || "").toLowerCase() === "new";

                    return (
                      <div key={o.orderId} style={styles.orderCard}>
                        <div style={styles.orderTop}>
                          <div style={styles.orderMain}>
                            <div style={styles.orderId}>Заказ #{o.orderId}</div>
                            <div style={styles.orderDate}>
                              {formatDate(o.createdAt)}
                            </div>
                          </div>

                          <div style={styles.orderStatus}>
                            {humanStatus(o.status)}
                          </div>
                        </div>

                        <div style={styles.orderPrices}>
                          <div>Товары: {money(o.total)} ₽</div>
                          <div>Доставка: {money(o.delivery)} ₽</div>
                          <div style={{ fontWeight: 800 }}>
                            Итого: {money(o.grandTotal)} ₽
                          </div>
                        </div>

                        <div style={styles.orderItems}>
                          {o.items?.map((it, idx) => (
                            <div key={`${o.orderId}_${idx}`} style={styles.orderItem}>
                              • {it.name} — {it.qty} {it.unit || ""} ={" "}
                              {money(it.sum)} ₽
                            </div>
                          ))}
                        </div>

                        {o.cancelReason ? (
                          <div style={styles.cancelReason}>
                            Причина отмены: {o.cancelReason}
                          </div>
                        ) : null}

                        {canCancel && (
                          <button
                            style={styles.dangerBtn}
                            onClick={() => setCancelOrderId(o.orderId)}
                          >
                            Отменить заказ
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#f7f4ef",
    color: "#2d251d",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
    padding: 12,
    paddingBottom: 96,
  },

  container: {
    maxWidth: 1120,
    margin: "0 auto",
  },

  headerGrid: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: 12,
    alignItems: "center",
    marginBottom: 12,
  },

  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },

  headerRight: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },

  title: {
    fontSize: 28,
    fontWeight: 900,
    letterSpacing: 0.2,
  },

  navBtn: {
    border: "1px solid #e7ddd2",
    background: "#fff",
    color: "#2d251d",
    borderRadius: 12,
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: 700,
  },

  navBtnActive: {
    background: "#8a5a36",
    color: "#fff",
    borderColor: "#8a5a36",
  },

  info: {
    background: "#fff",
    border: "1px solid #e7ddd2",
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },

  infoMuted: {
    background: "#fffaf4",
    border: "1px solid #f0e0c7",
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    color: "#6f665d",
  },

  chipsRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 14,
  },

  chip: {
    border: "1px solid #e7ddd2",
    background: "#efe5d8",
    color: "#2d251d",
    borderRadius: 999,
    padding: "9px 14px",
    cursor: "pointer",
    fontWeight: 700,
  },

  chipActive: {
    background: "#8a5a36",
    color: "#fff",
    borderColor: "#8a5a36",
  },

  chipPromo: {
    background: "#fff0e2",
    borderColor: "#f0c9a8",
    color: "#8a4b16",
  },

  chipPromoActive: {
    background: "#d56d1f",
    color: "#fff",
    borderColor: "#d56d1f",
  },

  list: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
    gap: 16,
  },

  card: {
    background: "#fff",
    border: "1px solid #e7ddd2",
    borderRadius: 18,
    overflow: "hidden",
    boxShadow: "0 2px 10px rgba(0,0,0,0.04)",
    display: "flex",
    flexDirection: "column",
  },

  cardImg: {
    width: "100%",
    aspectRatio: "1 / 0.9",
    objectFit: "cover",
    background: "#f5efe8",
    cursor: "zoom-in",
  },

  cardImgPlaceholder: {
    width: "100%",
    aspectRatio: "1 / 0.9",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f5efe8",
    color: "#8d8379",
    fontWeight: 700,
  },

  cardBody: {
    padding: 14,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    flex: 1,
  },

  cardName: {
    fontSize: 17,
    fontWeight: 800,
    lineHeight: 1.25,
  },

  cardDesc: {
    fontSize: 14,
    color: "#6f665d",
    lineHeight: 1.4,
  },

  cardMeta: {
    display: "flex",
    alignItems: "baseline",
    gap: 4,
  },

  price: {
    fontSize: 22,
    fontWeight: 900,
    color: "#8a5a36",
  },

  unit: {
    color: "#6f665d",
    fontSize: 14,
  },


  topBadgesRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 2,
  },

  sellingBadge: {
    display: "inline-flex",
    alignItems: "center",
    alignSelf: "flex-start",
    background: "#f4eadf",
    color: "#8a5a36",
    border: "1px solid #ead7c4",
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
  },

  variantBlock: {
    display: "grid",
    gap: 8,
  },

  variantTitle: {
    fontSize: 13,
    fontWeight: 800,
    color: "#6f665d",
  },

  variantList: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
  },

  variantChip: {
    border: "1px solid #e7ddd2",
    background: "#f7f1e8",
    color: "#5e4d3f",
    borderRadius: 999,
    padding: "8px 12px",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 13,
  },

  variantChipActive: {
    background: "#8a5a36",
    color: "#fff",
    borderColor: "#8a5a36",
  },

  metaLine: {
    fontSize: 14,
    lineHeight: 1.45,
    color: "#54483d",
  },

  metaLabel: {
    fontWeight: 800,
    color: "#2d251d",
  },

  weightBadge: {
    display: "inline-block",
    alignSelf: "flex-start",
    background: "#f5eee4",
    color: "#7c5431",
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
  },

  currentQtyLabel: {
    fontSize: 13,
    color: "#6f665d",
    fontWeight: 700,
  },

  buyBtn: {
    marginTop: "auto",
    border: "none",
    background: "#8a5a36",
    color: "#fff",
    borderRadius: 12,
    padding: "12px 14px",
    cursor: "pointer",
    fontWeight: 800,
  },

  qtyBlock: {
    marginTop: "auto",
    display: "grid",
    gap: 8,
  },

  qtyTopLine: {
    display: "grid",
    gridTemplateColumns: "1fr 80px 1fr",
    gap: 8,
    alignItems: "center",
  },

  qtyBtnWide: {
    border: "1px solid #e7ddd2",
    background: "#fff",
    color: "#2d251d",
    minHeight: 42,
    borderRadius: 10,
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 800,
    padding: "0 10px",
  },

  qtyInput: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #e7ddd2",
    borderRadius: 10,
    minHeight: 42,
    padding: "0 10px",
    textAlign: "center",
    fontSize: 16,
    fontWeight: 800,
    outline: "none",
  },

  qtyHint: {
    fontSize: 12,
    color: "#7b736a",
    textAlign: "center",
  },

  panel: {
    background: "#fff",
    border: "1px solid #e7ddd2",
    borderRadius: 18,
    padding: 16,
    boxShadow: "0 2px 10px rgba(0,0,0,0.04)",
  },

  h2: {
    fontSize: 24,
    fontWeight: 900,
    marginBottom: 14,
  },

  label: {
    display: "block",
    fontSize: 14,
    fontWeight: 700,
    marginBottom: 6,
    marginTop: 12,
  },

  input: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #e7ddd2",
    borderRadius: 12,
    padding: "12px 14px",
    fontSize: 16,
    outline: "none",
    background: "#fff",
  },

  textarea: {
    width: "100%",
    minHeight: 96,
    boxSizing: "border-box",
    border: "1px solid #e7ddd2",
    borderRadius: 12,
    padding: "12px 14px",
    fontSize: 16,
    outline: "none",
    background: "#fff",
    resize: "vertical",
  },

  primaryBtn: {
    marginTop: 14,
    width: "100%",
    border: "none",
    background: "#8a5a36",
    color: "#fff",
    borderRadius: 12,
    padding: "14px 16px",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 16,
  },

  primaryBtnDisabled: {
    opacity: 0.65,
    cursor: "not-allowed",
  },

  secondaryBtn: {
    marginTop: 10,
    width: "100%",
    border: "1px solid #e7ddd2",
    background: "#fff",
    color: "#2d251d",
    borderRadius: 12,
    padding: "14px 16px",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 16,
  },

  dangerBtn: {
    marginTop: 12,
    border: "none",
    background: "#c62828",
    color: "#fff",
    borderRadius: 12,
    padding: "12px 14px",
    cursor: "pointer",
    fontWeight: 800,
  },

  totalBlock: {
    marginTop: 14,
    background: "#faf7f2",
    border: "1px solid #eee1d2",
    borderRadius: 14,
    padding: 14,
  },

  totalRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "6px 0",
  },

  totalRowBig: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingTop: 10,
    marginTop: 10,
    borderTop: "1px solid #eadfce",
    fontSize: 18,
  },

  freeTag: {
    display: "inline-block",
    marginLeft: 6,
    padding: "2px 8px",
    borderRadius: 999,
    background: "#e8f5e9",
    color: "#2e7d32",
    fontSize: 12,
    fontWeight: 800,
    verticalAlign: "middle",
  },

  mutedTag: {
    display: "inline-block",
    marginLeft: 6,
    padding: "2px 8px",
    borderRadius: 999,
    background: "#f2eee8",
    color: "#6f665d",
    fontSize: 12,
    fontWeight: 700,
    verticalAlign: "middle",
  },

  cartRow2: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: 12,
    alignItems: "start",
    padding: "14px 0",
    borderBottom: "1px solid #f0e7dc",
  },

  cartLeft2: {
    minWidth: 0,
  },

  cartName2: {
    fontWeight: 800,
    lineHeight: 1.3,
    marginBottom: 4,
    wordBreak: "break-word",
  },

  cartMeta2: {
    color: "#6f665d",
    fontSize: 14,
    marginTop: 2,
    wordBreak: "break-word",
  },

  cartRightColumn: {
    display: "grid",
    gap: 8,
    minWidth: 320,
  },

  cartSum2: {
    fontWeight: 900,
    textAlign: "right",
  },

  cartQtyWeight: {
    display: "grid",
    gridTemplateColumns: "1fr 80px 1fr",
    gap: 8,
    alignItems: "center",
  },

  removeBtnText: {
    border: "1px solid #f3cdcd",
    background: "#fff5f5",
    color: "#c62828",
    borderRadius: 10,
    padding: "10px 12px",
    cursor: "pointer",
    fontWeight: 800,
  },

  ordersList: {
    display: "grid",
    gap: 12,
    marginTop: 14,
  },

  orderCard: {
    border: "1px solid #e7ddd2",
    borderRadius: 16,
    padding: 14,
    background: "#fffdfb",
  },

  orderTop: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: 12,
    alignItems: "start",
    marginBottom: 10,
  },

  orderMain: {
    minWidth: 0,
  },

  orderId: {
    fontWeight: 900,
    fontSize: 16,
    marginBottom: 4,
    wordBreak: "break-word",
  },

  orderDate: {
    color: "#6f665d",
    fontSize: 14,
  },

  orderStatus: {
    background: "#f3e7da",
    color: "#8a5a36",
    borderRadius: 999,
    padding: "6px 10px",
    fontWeight: 800,
    fontSize: 13,
    whiteSpace: "nowrap",
  },

  orderPrices: {
    display: "grid",
    gap: 4,
    marginBottom: 10,
  },

  orderItems: {
    display: "grid",
    gap: 4,
    color: "#3d342b",
  },

  orderItem: {
    lineHeight: 1.4,
  },

  cancelReason: {
    marginTop: 10,
    background: "#fff5f5",
    color: "#8b1f1f",
    border: "1px solid #f3cdcd",
    borderRadius: 12,
    padding: "10px 12px",
  },

  toast: {
    position: "fixed",
    top: 12,
    right: 12,
    zIndex: 3000,
    minWidth: 260,
    maxWidth: 420,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    padding: "12px 14px",
    borderRadius: 14,
    border: "1px solid #e7ddd2",
    background: "#fff",
    boxShadow: "0 10px 24px rgba(0,0,0,0.12)",
  },

  toastError: {
    background: "#fdeaea",
    borderColor: "#f0c0c0",
    color: "#8b1f1f",
  },

  toastSuccess: {
    background: "#e8f5e9",
    borderColor: "#bfe1c1",
    color: "#1f5e24",
  },

  toastInfo: {
    background: "#e8f1fd",
    borderColor: "#bfd3f5",
    color: "#174c91",
  },

  toastClose: {
    border: "none",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
    fontSize: 20,
    fontWeight: 800,
    lineHeight: 1,
    padding: 0,
  },

  zoomOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.65)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2500,
    padding: 16,
  },

  zoomBox: {
    position: "relative",
    maxWidth: "min(92vw, 860px)",
    maxHeight: "90vh",
    background: "#fff",
    borderRadius: 18,
    padding: 12,
    boxShadow: "0 18px 42px rgba(0,0,0,0.28)",
  },

  zoomClose: {
    position: "absolute",
    top: 6,
    right: 8,
    border: "none",
    background: "rgba(255,255,255,0.94)",
    width: 34,
    height: 34,
    borderRadius: 999,
    cursor: "pointer",
    fontSize: 20,
    fontWeight: 900,
    zIndex: 2,
  },

  zoomImg: {
    display: "block",
    maxWidth: "100%",
    maxHeight: "calc(90vh - 24px)",
    borderRadius: 12,
    objectFit: "contain",
  },

  floatingCartBtn: {
  position: "fixed",
  left: 16,
  bottom: 20,
  zIndex: 2600,
  border: "2px solid #ffffff",
  background: "linear-gradient(135deg, #8a5a36 0%, #a56a3f 100%)",
  color: "#fff",
  minWidth: 132,
  height: 56,
  borderRadius: 999,
  boxShadow: "0 12px 28px rgba(0,0,0,0.24)",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "0 16px",
},

floatingCartIcon: {
  fontSize: 20,
  lineHeight: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
},

floatingCartText: {
  fontSize: 15,
  fontWeight: 800,
  lineHeight: 1,
  whiteSpace: "nowrap",
},

floatingCartCount: {
  minWidth: 24,
  height: 24,
  borderRadius: 999,
  background: "#ffffff",
  color: "#8a5a36",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 12,
  fontWeight: 900,
  padding: "0 7px",
  boxSizing: "border-box",
  boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
  },
};

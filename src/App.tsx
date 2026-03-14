import React, { useEffect, useMemo, useState } from "react";

const API_URL =
  "https://script.google.com/macros/s/AKfycbxKXAVN8SbZ_DoY-k743zaDAGlzgfdhga_x_IWkxsyyDHvTIUIhLOhLApqJzFFs3Wg/exec";
const API_TOKEN = "Kjhytccb18@";

type Order = {
  createdAt?: string;
  orderId: string;
  name: string;
  phone: string;
  tgUserId?: string;
  tgUsername?: string;
  address: string;
  normalizedAddress?: string;
  itemsText?: string;
  notes?: string;
  total: number;
  status?: string;
  lat?: string;
  lon?: string;
  geocodedAddress?: string;
};

const COLORS = {
  olive: "#606c38",
  darkOlive: "#283618",
  cream: "#fefae0",
  sand: "#dda15e",
  brown: "#bc6c25",
  softCream: "#fffaf0",
};

export default function App() {
  const [tab, setTab] = useState<"active" | "archive">("active");
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [archiveOrders, setArchiveOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [buildingRoute, setBuildingRoute] = useState(false);
  const [copyingRoute, setCopyingRoute] = useState(false);

  useEffect(() => {
    loadOrders();
  }, [tab]);

  async function loadOrders() {
    try {
      setLoading(true);

      const action = tab === "active" ? "courierOrders" : "courierDoneOrders";
      const res = await fetch(`${API_URL}?action=${action}&token=${API_TOKEN}`);
      const data = await res.json();

      if (tab === "active") {
        setActiveOrders(Array.isArray(data.orders) ? data.orders : []);
      } else {
        setArchiveOrders(Array.isArray(data.orders) ? data.orders : []);
      }
    } catch (e) {
      console.error(e);
      alert("Не удалось загрузить заказы");
    } finally {
      setLoading(false);
    }
  }

  function getTelegramWebApp(): any {
    return (window as any)?.Telegram?.WebApp ?? null;
  }

  function openExternalLink(url: string) {
    const tg = getTelegramWebApp();

    try {
      if (tg?.openLink) {
        tg.openLink(url);
        return;
      }
    } catch (e) {
      console.warn("tg.openLink failed:", e);
    }

    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      console.error("window.open failed:", e);
      window.location.assign(url);
    }
  }

  async function copyText(text: string) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }

      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      textArea.style.top = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();

      const ok = document.execCommand("copy");
      document.body.removeChild(textArea);

      return ok;
    } catch (e) {
      console.error("copyText failed:", e);
      return false;
    }
  }

  function call(phone: string) {
    const cleanPhone = String(phone || "").trim();

    if (!cleanPhone) {
      alert("Номер телефона не указан");
      return;
    }

    window.location.href = `tel:${cleanPhone}`;
  }

  function openTelegram(username?: string, userId?: string) {
    const cleanUsername = String(username || "").replace(/^@/, "").trim();
    const cleanUserId = String(userId || "").trim();

    if (cleanUsername) {
      openExternalLink(`https://t.me/${cleanUsername}`);
      return;
    }

    if (cleanUserId) {
      openExternalLink(`https://t.me/user?id=${cleanUserId}`);
      return;
    }

    alert("У клиента не указан Telegram");
  }

  async function markDone(order: Order) {
    const ok = window.confirm("Отметить заказ как доставленный?");
    if (!ok) return;

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=utf-8",
        },
        body: JSON.stringify({
          token: API_TOKEN,
          action: "completeOrder",
          orderId: order.orderId,
          createdAt: order.createdAt,
        }),
      });

      const data = await res.json();

      if (data?.error) {
        alert(data.error);
        return;
      }

      await loadOrders();
    } catch (e) {
      console.error(e);
      alert("Не удалось обновить статус");
    }
  }

  async function geocodeOrdersNow() {
    try {
      setGeocoding(true);

      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=utf-8",
        },
        body: JSON.stringify({
          token: API_TOKEN,
          action: "geocodeOrders",
        }),
      });

      const data = await res.json();

      if (data?.error) {
        alert(data.error);
        return;
      }

      alert(
        `Координаты обновлены.\nОбработано: ${data?.updated || 0}\nНе найдено: ${data?.failed || 0}\nПропущено: ${data?.skipped || 0}`
      );

      await loadOrders();
    } catch (e) {
      console.error(e);
      alert("Не удалось получить координаты адресов");
    } finally {
      setGeocoding(false);
    }
  }

  function parseCoord(value: unknown): number | null {
    const n = Number(String(value ?? "").replace(",", ".").trim());
    return Number.isFinite(n) ? n : null;
  }

  function isValidLatLon(lat: number | null, lon: number | null): boolean {
    if (lat === null || lon === null) return false;
    return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  }

  async function getCurrentPosition(): Promise<{ lat: number; lon: number }> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Геолокация не поддерживается"));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
          });
        },
        (err) => reject(err),
        {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 0,
        }
      );
    });
  }

  function toRad(v: number) {
    return (v * Math.PI) / 180;
  }

  function distanceMeters(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ) {
    const R = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function sortOrdersNearest(
    start: { lat: number; lon: number },
    orders: Order[]
  ): Order[] {
    const remaining = [...orders];
    const result: Order[] = [];
    let current = { lat: start.lat, lon: start.lon };

    while (remaining.length > 0) {
      let bestIndex = 0;
      let bestDistance = Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const lat = parseCoord(remaining[i].lat);
        const lon = parseCoord(remaining[i].lon);

        if (!isValidLatLon(lat, lon)) continue;

        const dist = distanceMeters(current.lat, current.lon, lat!, lon!);

        if (dist < bestDistance) {
          bestDistance = dist;
          bestIndex = i;
        }
      }

      const next = remaining.splice(bestIndex, 1)[0];
      result.push(next);

      const nextLat = parseCoord(next.lat);
      const nextLon = parseCoord(next.lon);

      if (isValidLatLon(nextLat, nextLon)) {
        current = { lat: nextLat!, lon: nextLon! };
      }
    }

    return result;
  }

  function buildYandexWebRouteUrl(points: Array<{ lat: number; lon: number }>) {
    const routeText = points.map((p) => `${p.lat},${p.lon}`).join("~");
    return `https://yandex.ru/maps/?rtext=${encodeURIComponent(routeText)}&rtt=auto`;
  }

  function openYandexRoute(points: Array<{ lat: number; lon: number }>) {
    const webUrl = buildYandexWebRouteUrl(points);
    openExternalLink(webUrl);
  }

  function formatWeekLabel(createdAt?: string) {
    if (!createdAt) return "—";

    const d = new Date(createdAt);
    if (Number.isNaN(d.getTime())) return createdAt;

    return d.toLocaleDateString("ru-RU");
  }

  function formatMoney(value: unknown) {
    const n = Number(value);

    if (!Number.isFinite(n)) return "0 ₽";

    const rounded = Math.round(n);

    return `${rounded.toLocaleString("ru-RU")} ₽`;
  }

  async function copySingleClientRoute(order: Order) {
    const lat = parseCoord(order.lat);
    const lon = parseCoord(order.lon);

    if (!isValidLatLon(lat, lon)) {
      alert(
        "У этого заказа ещё нет корректных координат. Сначала нажми '📍 Координаты'."
      );
      return;
    }

    try {
      const pos = await getCurrentPosition();

      const url = buildYandexWebRouteUrl([
        { lat: pos.lat, lon: pos.lon },
        { lat: lat!, lon: lon! },
      ]);

      const copied = await copyText(url);

      if (copied) {
        alert("Ссылка на маршрут скопирована");
      } else {
        alert("Не удалось скопировать ссылку");
      }
    } catch (e) {
      console.error(e);
      alert("Не удалось получить текущее местоположение");
    }
  }

  async function openSingleClientRoute(order: Order) {
    const lat = parseCoord(order.lat);
    const lon = parseCoord(order.lon);

    if (!isValidLatLon(lat, lon)) {
      alert(
        "У этого заказа ещё нет корректных координат. Сначала нажми '📍 Координаты'."
      );
      return;
    }

    try {
      const pos = await getCurrentPosition();

      openYandexRoute([
        { lat: pos.lat, lon: pos.lon },
        { lat: lat!, lon: lon! },
      ]);
    } catch (e) {
      console.error(e);
      alert("Не удалось получить текущее местоположение");
    }
  }

  const orders = tab === "active" ? activeOrders : archiveOrders;

  const activeOrdersWithCoords = useMemo(() => {
    return activeOrders.filter((o) => {
      const lat = parseCoord(o.lat);
      const lon = parseCoord(o.lon);
      return isValidLatLon(lat, lon);
    });
  }, [activeOrders]);

  async function openRouteAll() {
    if (activeOrdersWithCoords.length === 0) {
      alert("Нет активных заказов с координатами. Сначала нажми '📍 Координаты'.");
      return;
    }

    try {
      setBuildingRoute(true);

      const pos = await getCurrentPosition();
      const sortedOrders = sortOrdersNearest(pos, activeOrdersWithCoords);

      const points = [
        { lat: pos.lat, lon: pos.lon },
        ...sortedOrders.map((o) => ({
          lat: parseCoord(o.lat)!,
          lon: parseCoord(o.lon)!,
        })),
      ];

      openYandexRoute(points);
    } catch (e) {
      console.error(e);
      alert(
        "Не удалось получить текущее местоположение. Разреши доступ к геолокации и попробуй ещё раз."
      );
    } finally {
      setBuildingRoute(false);
    }
  }

  async function copyRouteAll() {
    if (activeOrdersWithCoords.length === 0) {
      alert("Нет активных заказов с координатами. Сначала нажми '📍 Координаты'.");
      return;
    }

    try {
      setCopyingRoute(true);

      const pos = await getCurrentPosition();
      const sortedOrders = sortOrdersNearest(pos, activeOrdersWithCoords);

      const points = [
        { lat: pos.lat, lon: pos.lon },
        ...sortedOrders.map((o) => ({
          lat: parseCoord(o.lat)!,
          lon: parseCoord(o.lon)!,
        })),
      ];

      const url = buildYandexWebRouteUrl(points);
      const copied = await copyText(url);

      if (copied) {
        alert("Ссылка на маршрут по всем заказам скопирована");
      } else {
        alert("Не удалось скопировать ссылку");
      }
    } catch (e) {
      console.error(e);
      alert("Не удалось получить текущее местоположение");
    } finally {
      setCopyingRoute(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.bgShape1} />
      <div style={styles.bgShape2} />

      <div style={styles.container}>
        <div style={styles.hero}>
          <div style={styles.heroTop}>
            <div style={styles.brandRow}>
              <div style={styles.logoDot} />
              <div style={styles.brand}>Farm Courier</div>
            </div>
          </div>

          <div style={styles.heroTitle}>Доставки</div>

          <div style={styles.heroActions}>
            <button style={styles.ghostBtn} onClick={loadOrders}>
              ↻ Обновить
            </button>

            <button
              style={styles.goldBtn}
              onClick={geocodeOrdersNow}
              disabled={geocoding}
            >
              {geocoding ? "..." : "📍 Координаты"}
            </button>
          </div>
        </div>

        {tab === "active" && (
          <div style={styles.topTools}>
            <button
              style={styles.bigPrimaryBtn}
              onClick={openRouteAll}
              disabled={buildingRoute}
            >
              {buildingRoute
                ? "Строю маршрут..."
                : "🧭 Маршрут по всем активным заказам"}
            </button>

            <button
              style={styles.bigSecondaryBtn}
              onClick={copyRouteAll}
              disabled={copyingRoute}
            >
              {copyingRoute
                ? "Копирую..."
                : "📋 Скопировать маршрут по всем заказам"}
            </button>
          </div>
        )}

        <div style={styles.tabsWrap}>
          <button
            style={{
              ...styles.tabBtn,
              ...(tab === "active" ? styles.tabBtnActive : {}),
            }}
            onClick={() => setTab("active")}
          >
            Активные
          </button>

          <button
            style={{
              ...styles.tabBtn,
              ...(tab === "archive" ? styles.tabBtnActive : {}),
            }}
            onClick={() => setTab("archive")}
          >
            Архив
          </button>
        </div>

        {loading ? (
          <div style={styles.infoBox}>Загрузка…</div>
        ) : orders.length === 0 ? (
          <div style={styles.infoBox}>
            {tab === "active"
              ? "Активных заказов на текущую неделю нет"
              : "Архив пока пуст"}
          </div>
        ) : (
          orders.map((o, index) => (
            <div key={`${o.orderId}-${o.createdAt || ""}-${index}`} style={styles.card}>
              <div style={styles.cardHeader}>
                <div style={styles.cardHeaderLeft}>
                  <div style={styles.orderPill}>Заказ</div>
                  <div style={styles.orderNumber}>№ {o.orderId || "—"}</div>
                  <div style={styles.orderDate}>{formatWeekLabel(o.createdAt)}</div>
                </div>

                <div style={styles.priceBadge}>{formatMoney(o.total)}</div>
              </div>

              <div style={styles.quickGrid}>
                <div style={styles.quickItem}>
                  <div style={styles.quickLabel}>Имя</div>
                  <div style={styles.quickValue}>{o.name || "—"}</div>
                </div>

                <div style={styles.quickItem}>
                  <div style={styles.quickLabel}>Телефон</div>
                  <div style={styles.quickValue}>{o.phone || "—"}</div>
                </div>
              </div>

              <div style={styles.addressBox}>
                <div style={styles.sectionLabel}>Адрес</div>
                <div style={styles.addressText}>{o.address || "—"}</div>
              </div>

              {o.itemsText ? (
                <div style={styles.sectionCard}>
                  <div style={styles.sectionLabel}>Состав заказа</div>
                  <div style={styles.sectionText}>{o.itemsText}</div>
                </div>
              ) : null}

              {o.notes ? (
                <div style={styles.notesCard}>
                  <div style={styles.sectionLabel}>Примечание</div>
                  <div style={styles.sectionText}>{o.notes}</div>
                </div>
              ) : null}

              <div style={styles.coordsCard}>
                <div style={styles.sectionLabel}>Координаты</div>

                <div style={styles.coordLine}>
                  <span style={styles.coordName}>LAT</span>
                  <span style={styles.coordNum}>{o.lat || "—"}</span>
                </div>

                <div style={styles.coordLine}>
                  <span style={styles.coordName}>LON</span>
                  <span style={styles.coordNum}>{o.lon || "—"}</span>
                </div>

                {o.geocodedAddress ? (
                  <div style={styles.geoText}>
                    Геокод найден как: {o.geocodedAddress}
                  </div>
                ) : null}
              </div>

              <div style={styles.actionsGrid}>
                <button style={styles.callBtn} onClick={() => call(o.phone)}>
                  Позвонить
                </button>

                <button
                  style={styles.lightBtn}
                  onClick={() => openTelegram(o.tgUsername, o.tgUserId)}
                >
                  Telegram
                </button>

                <button
                  style={styles.darkBtn}
                  onClick={() => openSingleClientRoute(o)}
                >
                  Маршрут
                </button>

                <button
                  style={styles.lightBtn}
                  onClick={() => copySingleClientRoute(o)}
                >
                  Скопировать ссылку
                </button>
              </div>

              {tab === "active" ? (
                <button
                  style={styles.doneBtn}
                  onClick={() => markDone(o)}
                >
                  ✅ Доставлено
                </button>
              ) : (
                <div style={styles.archiveBadge}>В архиве</div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    padding: 16,
    boxSizing: "border-box",
    fontFamily: "Arial, sans-serif",
    background: `radial-gradient(circle at top left, rgba(221,161,94,0.18), transparent 26%),
                 linear-gradient(180deg, ${COLORS.darkOlive} 0%, #364722 34%, ${COLORS.cream} 100%)`,
    position: "relative",
    overflowX: "hidden",
    color: COLORS.darkOlive,
  },

  bgShape1: {
    position: "fixed",
    top: -60,
    right: -40,
    width: 180,
    height: 180,
    borderRadius: "50%",
    background: "rgba(221,161,94,0.14)",
    filter: "blur(34px)",
    pointerEvents: "none",
  },
  bgShape2: {
    position: "fixed",
    bottom: -80,
    left: -60,
    width: 180,
    height: 180,
    borderRadius: "50%",
    background: "rgba(188,108,37,0.12)",
    filter: "blur(36px)",
    pointerEvents: "none",
  },

  container: {
    maxWidth: 700,
    margin: "0 auto",
    position: "relative",
    zIndex: 1,
  },

  hero: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(254,250,224,0.14)",
    borderRadius: 28,
    padding: 16,
    marginBottom: 14,
    backdropFilter: "blur(12px)",
    boxShadow: "0 18px 38px rgba(0,0,0,0.18)",
  },
  heroTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  brandRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  logoDot: {
    width: 14,
    height: 14,
    borderRadius: "50%",
    background: `linear-gradient(180deg, ${COLORS.sand} 0%, ${COLORS.brown} 100%)`,
    boxShadow: "0 0 0 6px rgba(221,161,94,0.12)",
    flexShrink: 0,
  },
  brand: {
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: COLORS.sand,
  },
  heroTitle: {
    fontSize: 30,
    fontWeight: 800,
    color: COLORS.cream,
    lineHeight: 1.05,
    marginBottom: 12,
  },
  heroActions: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },

  ghostBtn: {
    flex: 1,
    minWidth: 120,
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid rgba(254,250,224,0.18)",
    background: "rgba(254,250,224,0.06)",
    color: COLORS.cream,
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 6px 14px rgba(0,0,0,0.1)",
  },
  goldBtn: {
    flex: 1,
    minWidth: 140,
    padding: "10px 12px",
    borderRadius: 14,
    border: "none",
    background: `linear-gradient(180deg, ${COLORS.sand} 0%, ${COLORS.brown} 100%)`,
    color: COLORS.cream,
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "0 12px 20px rgba(188,108,37,0.24)",
  },

  topTools: {
    background: "rgba(254,250,224,0.97)",
    borderRadius: 24,
    padding: 14,
    marginBottom: 14,
    border: "1px solid rgba(188,108,37,0.14)",
    boxShadow: "0 16px 30px rgba(40,54,24,0.12)",
  },
  bigPrimaryBtn: {
    width: "100%",
    marginBottom: 10,
    padding: "14px 16px",
    borderRadius: 18,
    border: "none",
    background: `linear-gradient(180deg, ${COLORS.darkOlive} 0%, ${COLORS.olive} 100%)`,
    color: COLORS.cream,
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 15,
    boxShadow: "0 12px 22px rgba(40,54,24,0.18)",
  },
  bigSecondaryBtn: {
    width: "100%",
    padding: "14px 16px",
    borderRadius: 18,
    border: `1px solid ${COLORS.sand}`,
    background: COLORS.softCream,
    color: COLORS.brown,
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 15,
    boxShadow: "0 8px 14px rgba(40,54,24,0.08)",
  },

  tabsWrap: {
    display: "flex",
    gap: 8,
    background: "rgba(254,250,224,0.14)",
    borderRadius: 22,
    padding: 6,
    marginBottom: 16,
    backdropFilter: "blur(8px)",
    boxShadow: "0 12px 22px rgba(0,0,0,0.14)",
  },
  tabBtn: {
    flex: 1,
    padding: "13px 14px",
    borderRadius: 16,
    border: "1px solid transparent",
    background: "transparent",
    color: COLORS.cream,
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 15,
  },
  tabBtnActive: {
    background: COLORS.cream,
    color: COLORS.darkOlive,
    boxShadow: "0 8px 16px rgba(0,0,0,0.12)",
  },

  infoBox: {
    background: COLORS.cream,
    borderRadius: 22,
    padding: 18,
    border: "1px solid rgba(188,108,37,0.14)",
    boxShadow: "0 14px 24px rgba(40,54,24,0.12)",
  },

  card: {
    background: "linear-gradient(180deg, rgba(254,250,224,0.99) 0%, rgba(250,245,226,0.98) 100%)",
    borderRadius: 30,
    padding: 18,
    marginBottom: 18,
    border: "1px solid rgba(188,108,37,0.16)",
    boxShadow: "0 20px 36px rgba(40,54,24,0.14)",
  },

  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 14,
    alignItems: "flex-start",
    marginBottom: 16,
  },
  cardHeaderLeft: {
    minWidth: 0,
  },
  orderPill: {
    display: "inline-flex",
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: COLORS.olive,
    background: "rgba(96,108,56,0.12)",
    marginBottom: 10,
  },
  orderNumber: {
    fontSize: 34,
    fontWeight: 800,
    color: COLORS.darkOlive,
    lineHeight: 1,
    marginBottom: 6,
  },
  orderDate: {
    fontSize: 14,
    fontWeight: 700,
    color: COLORS.brown,
  },
  priceBadge: {
    padding: "12px 16px",
    borderRadius: 20,
    background: `linear-gradient(180deg, rgba(221,161,94,0.18) 0%, rgba(188,108,37,0.1) 100%)`,
    border: "1px solid rgba(188,108,37,0.18)",
    fontSize: 28,
    fontWeight: 800,
    color: COLORS.brown,
    whiteSpace: "nowrap",
    boxShadow: "0 8px 16px rgba(188,108,37,0.08)",
  },

  quickGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
    marginBottom: 12,
  },
  quickItem: {
    padding: 14,
    borderRadius: 20,
    background: "rgba(255,255,255,0.56)",
    border: "1px solid rgba(221,161,94,0.24)",
  },
  quickLabel: {
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: COLORS.olive,
    marginBottom: 8,
  },
  quickValue: {
    fontSize: 18,
    fontWeight: 700,
    color: COLORS.darkOlive,
    lineHeight: 1.35,
    wordBreak: "break-word",
  },

  addressBox: {
    marginBottom: 12,
    padding: 16,
    borderRadius: 22,
    background:
      "linear-gradient(180deg, rgba(221,161,94,0.12) 0%, rgba(254,250,224,0.82) 100%)",
    border: "1px solid rgba(221,161,94,0.3)",
  },
  sectionCard: {
    marginTop: 10,
    padding: 16,
    borderRadius: 22,
    background: "rgba(255,255,255,0.42)",
    border: "1px solid rgba(221,161,94,0.24)",
  },
  notesCard: {
    marginTop: 10,
    padding: 16,
    borderRadius: 22,
    background: "linear-gradient(180deg, rgba(221,161,94,0.14) 0%, rgba(255,245,232,0.76) 100%)",
    border: "1px solid rgba(188,108,37,0.28)",
  },
  coordsCard: {
    marginTop: 12,
    padding: 16,
    borderRadius: 22,
    background: "rgba(255,255,255,0.38)",
    border: "1px solid rgba(221,161,94,0.22)",
  },

  sectionLabel: {
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 0.9,
    textTransform: "uppercase",
    color: COLORS.olive,
    marginBottom: 10,
  },
  addressText: {
    fontSize: 20,
    fontWeight: 700,
    lineHeight: 1.4,
    color: COLORS.darkOlive,
  },
  sectionText: {
    fontSize: 15,
    lineHeight: 1.5,
    color: COLORS.darkOlive,
    whiteSpace: "pre-wrap",
  },

  coordLine: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginBottom: 8,
  },
  coordName: {
    fontSize: 13,
    fontWeight: 800,
    letterSpacing: 0.8,
    color: COLORS.olive,
  },
  coordNum: {
    fontSize: 16,
    fontWeight: 700,
    color: COLORS.darkOlive,
    wordBreak: "break-all",
    textAlign: "right",
  },
  geoText: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 1.4,
    color: COLORS.brown,
  },

  actionsGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
    marginTop: 16,
  },
  callBtn: {
    padding: "13px 14px",
    borderRadius: 18,
    border: "none",
    background: `linear-gradient(180deg, ${COLORS.brown} 0%, #9f581f 100%)`,
    color: COLORS.cream,
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 15,
    boxShadow: "0 12px 18px rgba(188,108,37,0.18)",
  },
  lightBtn: {
    padding: "13px 14px",
    borderRadius: 18,
    border: "1px solid rgba(221,161,94,0.42)",
    background: COLORS.softCream,
    color: COLORS.darkOlive,
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 15,
    boxShadow: "0 8px 14px rgba(40,54,24,0.06)",
  },
  darkBtn: {
    padding: "13px 14px",
    borderRadius: 18,
    border: "none",
    background: `linear-gradient(180deg, ${COLORS.olive} 0%, ${COLORS.darkOlive} 100%)`,
    color: COLORS.cream,
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 15,
    boxShadow: "0 12px 18px rgba(40,54,24,0.18)",
  },

  doneBtn: {
    marginTop: 16,
    width: "100%",
    padding: "14px 16px",
    borderRadius: 20,
    border: "none",
    background: `linear-gradient(180deg, ${COLORS.olive} 0%, ${COLORS.darkOlive} 100%)`,
    color: COLORS.cream,
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 16,
    boxShadow: "0 14px 20px rgba(40,54,24,0.18)",
  },
  archiveBadge: {
    marginTop: 16,
    width: "100%",
    padding: "14px 16px",
    borderRadius: 20,
    background: `linear-gradient(180deg, ${COLORS.sand} 0%, ${COLORS.brown} 100%)`,
    color: COLORS.cream,
    fontWeight: 800,
    fontSize: 15,
    textAlign: "center",
    boxShadow: "0 12px 18px rgba(188,108,37,0.16)",
  },
};

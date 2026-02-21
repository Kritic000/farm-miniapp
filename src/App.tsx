import { useEffect, useState } from "react";
import { API_URL } from "./config";

type Product = {
  id: string;
  name: string;
  price: number;
  unit: string;
};

export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API_URL}?action=products`)
      .then(res => res.json())
      .then(data => setProducts(data.products || []))
      .catch(() => setError("Не удалось загрузить каталог"));
  }, []);

  return (
    <div style={{ padding: 20, fontFamily: "Arial" }}>
      <h1>Каталог</h1>

      {error && <p style={{ color: "red" }}>{error}</p>}

      {products.map(p => (
        <div
          key={p.id}
          style={{
            border: "1px solid #ddd",
            padding: 10,
            marginBottom: 10,
            borderRadius: 6
          }}
        >
          <b>{p.name}</b>
          <div>
            {p.price} ₽ / {p.unit}
          </div>
        </div>
      ))}

      {products.length === 0 && !error && <p>Загрузка...</p>}
    </div>
  );
}

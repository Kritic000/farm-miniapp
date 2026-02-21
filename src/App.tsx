import React from "react";

const products = [
  {
    id: 1,
    name: "Молоко",
    price: "188 ₽ / 1л",
    image: "/images/milk.jpg"
  }
];

export default function App() {
  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Каталог</h1>

      {products.map((product) => (
        <div key={product.id} style={styles.card}>
          <img src={product.image} alt={product.name} style={styles.image} />
          <div style={styles.info}>
            <h3>{product.name}</h3>
            <p>{product.price}</p>
            <button
  style={styles.button}
  onClick={() => alert("Товар добавлен в корзину")}
>
  В корзину
</button>
          </div>
        </div>
      ))}
    </div>
  );
}

const styles = {
  container: {
    background: "#f4f6f9",
    minHeight: "100vh",
    padding: "20px",
    fontFamily: "Arial"
  },
  title: {
    marginBottom: "20px"
  },
  card: {
    background: "#ffffff",
    borderRadius: "12px",
    overflow: "hidden",
    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
    marginBottom: "20px"
  },
  image: {
    width: "100%",
    height: "180px",
    objectFit: "cover"
  },
  info: {
    padding: "15px"
  },
  button: {
    background: "#2e7d32",
    color: "white",
    border: "none",
    padding: "10px 15px",
    borderRadius: "8px",
    cursor: "pointer"
  }
};



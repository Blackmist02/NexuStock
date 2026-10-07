'use client';
import { useState, useEffect } from 'react';

export default function Home() {
  const [health, setHealth] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Probar conexión con el Backend en localhost:4000
    Promise.all([
      fetch('http://localhost:4000/api/health').then(res => res.json()),
      fetch('http://localhost:4000/api/products').then(res => res.json())
    ])
      .then(([healthData, productsData]) => {
        setHealth(healthData);
        setProducts(productsData.data || []);
        setLoading(false);
      })
      .catch(err => {
        console.error('Error conectando al backend:', err);
        setLoading(false);
      });
  }, []);

  return (
    <main style={{ padding: '2rem', fontFamily: 'sans-serif', maxWidth: '800px', margin: '0 auto' }}>
      <h1>🥩 NexuStock - Dashboard Inicial</h1>
      <p>Sistema inteligente de gestión y predicción de inventario para carnicerías.</p>

      <section style={{ marginTop: '2rem', padding: '1rem', border: '1px solid #ccc', borderRadius: '8px' }}>
        <h2>Estado de la API (Backend)</h2>
        {loading ? (
          <p>Cargando conexión...</p>
        ) : health ? (
          <div>
            <p><strong>Estado:</strong> <span style={{ color: 'green' }}>{health.status}</span></p>
            <p><strong>Mensaje:</strong> {health.message}</p>
          </div>
        ) : (
          <p style={{ color: 'red' }}>⚠️ No se pudo conectar con el Backend (Asegúrate de correr el backend en el puerto 4000).</p>
        )}
      </section>

      <section style={{ marginTop: '2rem', padding: '1rem', border: '1px solid #ccc', borderRadius: '8px' }}>
        <h2>Vista Previa de Inventario (Mock)</h2>
        {products.length > 0 ? (
          <ul>
            {products.map(p => (
              <li key={p.id}>
                <strong>{p.name}</strong> ({p.category}): {p.stock_kg} kg en stock
              </li>
            ))}
          </ul>
        ) : (
          <p>No hay productos disponibles.</p>
        )}
      </section>
    </main>
  );
}

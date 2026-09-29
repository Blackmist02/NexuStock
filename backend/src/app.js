const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

// Middlewares
app.use(cors());
app.use(express.json());

// Ruta de prueba (Healthcheck)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Backend de NexuStock operativo',
    timestamp: new Date().toISOString()
  });
});

// Ruta base provisional para productos / inventario
app.get('/api/products', (req, res) => {
  res.json({
    data: [
      { id: 1, name: 'Lomo Vetado', stock_kg: 45.5, category: 'Vacuno' },
      { id: 2, name: 'Pechuga Entera', stock_kg: 80.0, category: 'Pollo' }
    ]
  });
});

// Inicialización del servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor NexuStock corriendo en http://localhost:${PORT}`);
});

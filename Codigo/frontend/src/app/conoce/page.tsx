import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import s from "./conoce.module.css";

/**
 * Página pública «Conoce NexuStock»: muestra qué hace la plataforma y qué logra, sin iniciar sesión.
 * Es el destino del código QR de la presentación. Contenido estático (cifras de la evaluación 2024).
 */
export const metadata: Metadata = {
  title: "Conoce NexuStock",
  description:
    "Inventario predictivo para carnicerías independientes: proyecta la demanda de cada producto y sugiere cuánto y cuándo pedir. Con los datos reales de 2024, $8,3 millones de ahorro.",
};

const IMPACTO = [
  { cifra: "$8,3 M", texto: "de ahorro anual con los datos reales de 2024" },
  { cifra: "−83 %", texto: "de merma por vencimiento" },
  { cifra: "−12 %", texto: "de venta perdida por quiebre de stock" },
];

const PASOS = [
  {
    n: "01",
    titulo: "Registrar",
    texto: "Ventas, compras y mermas quedan registradas en transacciones seguras: el stock de cada producto está siempre al día.",
  },
  {
    n: "02",
    titulo: "Proyectar",
    texto: "Un modelo de Machine Learning estima la demanda semanal de cada corte, considerando feriados, Fiestas Patrias, quincena y fin de mes.",
  },
  {
    n: "03",
    titulo: "Alertar",
    texto: "Un semáforo (quiebre, bajo, óptimo) indica qué pedir, cuánto y hasta cuándo, según los días de entrega de cada proveedor.",
  },
];

const VISTAS = [
  { src: "/conoce/dashboard.webp", titulo: "Dashboard", texto: "Semáforo de stock, indicadores y sugerencias de compra de la semana." },
  { src: "/conoce/alertas.webp", titulo: "Alertas", texto: "Productos en riesgo con la cantidad sugerida y la fecha límite de pedido." },
  { src: "/conoce/prediccion.webp", titulo: "Predicción", texto: "Demanda proyectada por producto frente a lo vendido realmente." },
  { src: "/conoce/precision.webp", titulo: "Precisión del modelo", texto: "Error medio (MAE) por producto, transparente para el usuario." },
];

const MOTOR = [
  { cifra: "5,1 kg", texto: "error medio por producto y semana (MAE)" },
  { cifra: "−9 %", texto: "de error frente al promedio simple" },
  { cifra: "59 ms", texto: "tiempo de respuesta de la predicción" },
  { cifra: "Respaldo", texto: "si el modelo no responde, se usa el promedio histórico" },
];

const STACK = ["Next.js", "Node.js · Express", "Python · scikit-learn", "PostgreSQL", "Docker", "CI/CD"];
const SEGURIDAD = ["Contraseñas con bcrypt", "Sesiones JWT y roles", "HTTPS", "Protección CSRF"];

export default function ConocePage() {
  return (
    <div className={s.page}>
      <header className={s.top}>
        <Link href="/conoce" aria-label="NexuStock">
          <Logo width={120} height={44} />
        </Link>
        <Link href="/login" className={s.btnGhost}>
          Iniciar sesión
        </Link>
      </header>

      <main>
        <section className={s.hero}>
          <p className={s.eyebrow}>Inventario predictivo para carnicerías</p>
          <h1 className={s.h1}>
            Compra lo justo.
            <br />
            <span className={s.accent}>Vende lo que tu cliente busca.</span>
          </h1>
          <p className={s.lead}>
            NexuStock proyecta la demanda de cada producto y te dice cuánto y cuándo pedir, para que la carne no se
            venza en la cámara ni falte en el mesón.
          </p>
          <div className={s.impacto}>
            {IMPACTO.map((i) => (
              <div key={i.cifra} className={s.stat}>
                <span className={s.cifra}>{i.cifra}</span>
                <span className={s.statTxt}>{i.texto}</span>
              </div>
            ))}
          </div>
          <p className={s.nota}>Simulación día a día sobre los registros reales de una carnicería en 2024.</p>
        </section>

        <section className={s.section}>
          <p className={s.label}>El problema</p>
          <h2 className={s.h2}>Comprar sin datos cuesta caro</h2>
          <div className={s.problema}>
            <div className={s.card}>
              <span className={s.cifraSm}>6,2 %</span>
              <span>de lo comprado se perdió por vencimiento</span>
            </div>
            <div className={s.card}>
              <span className={s.cifraSm}>3,0 %</span>
              <span>de la demanda no se pudo atender por falta de stock</span>
            </div>
            <div className={`${s.card} ${s.cardDark}`}>
              <span className={s.cifraSm}>$12,6 M</span>
              <span>perdidos en un año entre merma y ventas que no se concretaron</span>
            </div>
          </div>
        </section>

        <section className={s.section}>
          <p className={s.label}>Cómo funciona</p>
          <h2 className={s.h2}>Registrar, proyectar, alertar</h2>
          <ol className={s.pasos}>
            {PASOS.map((p) => (
              <li key={p.n} className={s.card}>
                <span className={s.paso}>{p.n}</span>
                <h3 className={s.h3}>{p.titulo}</h3>
                <p className={s.p}>{p.texto}</p>
              </li>
            ))}
          </ol>
          <p className={s.formula}>
            Pedido sugerido = demanda proyectada × (1 + margen de seguridad) − stock actual
          </p>
        </section>

        <section className={s.section}>
          <p className={s.label}>La plataforma</p>
          <h2 className={s.h2}>Pensada para decidir de un vistazo</h2>
          <div className={s.vistas}>
            {VISTAS.map((v, i) => (
              <figure key={v.src} className={s.vista}>
                <Image
                  src={v.src}
                  alt={`Vista ${v.titulo} de NexuStock`}
                  width={1440}
                  height={900}
                  sizes="(max-width: 760px) 100vw, 50vw"
                  className={s.img}
                  loading={i === 0 ? "eager" : "lazy"}
                />
                <figcaption>
                  <strong>{v.titulo}</strong>
                  <span>{v.texto}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className={s.section}>
          <p className={s.label}>Motor predictivo</p>
          <h2 className={s.h2}>Entrenado con 2022–2023, probado a ciegas en 2024</h2>
          <div className={s.motor}>
            {MOTOR.map((m) => (
              <div key={m.cifra} className={s.card}>
                <span className={s.cifraSm}>{m.cifra}</span>
                <span>{m.texto}</span>
              </div>
            ))}
          </div>
        </section>

        <section className={s.section}>
          <p className={s.label}>Tecnología y seguridad</p>
          <h2 className={s.h2}>Una plataforma web en la nube</h2>
          <div className={s.chips}>
            {STACK.map((t) => (
              <span key={t} className={s.chip}>
                {t}
              </span>
            ))}
          </div>
          <div className={s.chips}>
            {SEGURIDAD.map((t) => (
              <span key={t} className={`${s.chip} ${s.chipSoft}`}>
                {t}
              </span>
            ))}
          </div>
        </section>

        <section className={`${s.section} ${s.equipo}`}>
          <p className={s.label}>Equipo</p>
          <div className={s.personas}>
            <div className={s.persona}>
              <span className={s.ini}>IM</span>
              <div>
                <strong>Ignacio Mella</strong>
                <span>Software Engineer</span>
              </div>
            </div>
            <div className={s.persona}>
              <span className={s.ini}>MB</span>
              <div>
                <strong>Manuel Bustamante</strong>
                <span>Data Scientist</span>
              </div>
            </div>
          </div>
          <p className={s.nota}>Proyecto Capstone · Ingeniería en Informática · Duoc UC, sede Alameda · 2026</p>
        </section>
      </main>

      <footer className={s.foot}>
        <span>¿Ya tienes una cuenta?</span>
        <Link href="/login" className={s.btn}>
          Iniciar sesión
        </Link>
      </footer>
    </div>
  );
}

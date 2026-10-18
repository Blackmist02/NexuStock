"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { SubNav } from "@/components/SubNav";
import { Modal } from "@/components/ui/Modal";
import { Button, SelectField, TextField } from "@/components/ui/Field";
import { ErrorState, Loading } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/lib/auth";
import { ApiClientError, api, errorMessage } from "@/lib/api";
import { fmtFecha, hoyISO } from "@/lib/format";
import { puede } from "@/lib/permisos";
import type { Evento } from "@/lib/tipos";
import { useApi } from "@/lib/useApi";
import { tabsPrediccion } from "../tabs";

const TIPOS: { v: string; l: string }[] = [
  { v: "feriado", l: "Feriado" },
  { v: "feriado_largo", l: "Feriado largo" },
  { v: "fiestas_patrias", l: "Fiestas Patrias" },
  { v: "semana_santa", l: "Semana Santa" },
  { v: "otro", l: "Otro evento" },
];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const claseEv = (t: Evento["tipo"]) => (t === "quincena" || t === "fin_de_mes" ? "ev qui" : t === "otro" ? "ev own" : "ev fer");

export function CalendarioView() {
  const { user } = useAuth();
  const toast = useToast();
  const hoy = hoyISO();
  const [y0, m0] = hoy.split("-").map(Number);
  const [ym, setYm] = useState({ y: y0, m: m0 - 1 });
  const [nuevo, setNuevo] = useState(false);
  const edita = puede(user?.rol, "calendario");

  const dias = useMemo(() => {
    const primero = new Date(Date.UTC(ym.y, ym.m, 1));
    const offset = (primero.getUTCDay() + 6) % 7; // lunes = 0
    const total = new Date(Date.UTC(ym.y, ym.m + 1, 0)).getUTCDate();
    const celdas: { fecha: string; dia: number; fuera: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(Date.UTC(ym.y, ym.m, 1 - offset + i));
      celdas.push({ fecha: iso(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), dia: d.getUTCDate(), fuera: d.getUTCMonth() !== ym.m });
    }
    return { celdas, desde: celdas[0].fecha, hasta: celdas[41].fecha, total };
  }, [ym]);

  const { data, error, loading, reload } = useApi<{ data: Evento[] }>("/events", { desde: dias.desde, hasta: dias.hasta });
  const porDia = useMemo(() => {
    const m = new Map<string, Evento[]>();
    for (const e of data?.data ?? []) m.set(e.fecha, [...(m.get(e.fecha) ?? []), e]);
    return m;
  }, [data]);
  const delMes = (data?.data ?? []).filter((e) => e.fecha.startsWith(iso(ym.y, ym.m, 1).slice(0, 7)) && e.tipo !== "quincena" && e.tipo !== "fin_de_mes");

  const mover = (d: number) => setYm((x) => { const n = new Date(Date.UTC(x.y, x.m + d, 1)); return { y: n.getUTCFullYear(), m: n.getUTCMonth() }; });

  async function borrar(e: Evento) {
    if (e.id_evento == null) return;
    try {
      await api.delete(`/events/${e.id_evento}`);
      toast.ok("Evento eliminado");
      void reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <AppShell active="prediccion">
      <div className="topbar">
        <div>
          <h1 className="h1">Calendario de eventos</h1>
          <div className="subtitle">Feriados, fiestas y fechas de mayor demanda que el motor tiene en cuenta</div>
        </div>
        <div className="topbar-right">{edita ? <Button size="sm" variant="primary" onClick={() => setNuevo(true)}>Agregar evento</Button> : null}</div>
      </div>
      <SubNav items={tabsPrediccion(user?.rol)} activa="/prediccion/calendario" />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="title">
          <div className="calnav">
            <Button size="sm" aria-label="Mes anterior" onClick={() => mover(-1)}>‹</Button>
            <span className="titulo">{MESES[ym.m]} {ym.y}</span>
            <Button size="sm" aria-label="Mes siguiente" onClick={() => mover(1)}>›</Button>
          </div>
          <Button size="sm" onClick={() => setYm({ y: y0, m: m0 - 1 })}>Hoy</Button>
        </div>
        {error ? <ErrorState message={error} onRetry={() => void reload()} /> : null}
        {loading && !data ? <Loading /> : null}
        <div className="cal" role="grid" aria-label={`Calendario de ${MESES[ym.m]} ${ym.y}`}>
          <div className="calgrid">
            {DIAS.map((d) => <div key={d} className="calh">{d}</div>)}
            {dias.celdas.map((c, i) => (
              <div key={c.fecha} className={`cell${c.fuera ? " out" : ""}${c.fecha === hoy ? " today" : ""}${i >= 35 ? " last" : ""}`}>
                <span className="d">{c.dia}</span>
                {(porDia.get(c.fecha) ?? []).map((e, k) => (
                  <div key={k} className={claseEv(e.tipo)} title={e.nombre}>{e.nombre}</div>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="legend" style={{ marginTop: 12, marginBottom: 0 }}>
          <span><i className="sq" style={{ color: "var(--alerta)" }} />Feriados</span>
          <span><i className="sq" style={{ color: "var(--accent)" }} />Eventos propios</span>
          <span><i className="sq" style={{ color: "var(--accent)", opacity: 0.5 }} />Quincena y fin de mes (automático)</span>
        </div>
      </div>

      <div className="card">
        <div className="title">Eventos de {MESES[ym.m]}</div>
        {delMes.length === 0 ? <div className="hint">No hay feriados ni eventos este mes.</div> : null}
        {delMes.map((e, i) => (
          <div key={i} className={`rowline${i === 0 ? " first" : ""}`}>
            <span>{fmtFecha(e.fecha)} · {e.nombre}</span>
            {edita && !e.derivado && e.id_evento != null ? <Button size="sm" variant="danger" onClick={() => void borrar(e)}>Quitar</Button> : <span className="hint">{TIPOS.find((t) => t.v === e.tipo)?.l ?? "Evento"}</span>}
          </div>
        ))}
      </div>

      {nuevo ? <NuevoEvento onClose={() => setNuevo(false)} onHecho={() => { setNuevo(false); void reload(); }} /> : null}
    </AppShell>
  );
}

function NuevoEvento({ onClose, onHecho }: { onClose: () => void; onHecho: () => void }) {
  const toast = useToast();
  const [fecha, setFecha] = useState(hoyISO());
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState("otro");
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function guardar() {
    const c: Record<string, string> = {};
    if (!fecha) c.fecha = "Elige una fecha";
    if (nombre.trim().length < 2) c.nombre = "Ingresa el nombre";
    setCampos(c);
    if (Object.keys(c).length) return;
    setEnviando(true);
    setError(null);
    try {
      await api.post("/events", { fecha, nombre: nombre.trim(), tipo });
      toast.ok("Evento agregado");
      onHecho();
    } catch (e) {
      setEnviando(false);
      if (e instanceof ApiClientError && Object.keys(e.fieldErrors).length) setCampos(e.fieldErrors);
      else setError(errorMessage(e));
    }
  }

  return (
    <Modal titulo="Agregar evento" subtitulo="Los días con más demanda ayudan a anticipar las compras." onClose={onClose} ocupado={enviando} ancho={440}
      pie={<><Button onClick={onClose} disabled={enviando}>Cancelar</Button><Button variant="primary" loading={enviando} onClick={() => void guardar()}>Agregar</Button></>}>
      <div className="form-grid">
        <TextField className="full" label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} error={campos.fecha} />
        <TextField className="full" label="Nombre" placeholder="Ej.: Aniversario del barrio" value={nombre} onChange={(e) => setNombre(e.target.value)} error={campos.nombre} />
        <SelectField className="full" label="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} error={campos.tipo}>
          {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
        </SelectField>
      </div>
      {error ? <div className="form-err" role="alert" style={{ marginTop: 14 }}>{error}</div> : null}
    </Modal>
  );
}

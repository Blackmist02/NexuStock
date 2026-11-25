import type { ReactNode } from "react";

export function Loading({ texto = "Cargando…" }: { texto?: string }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <span className="spin lg" aria-hidden="true" />
      <div className="state-t">{texto}</div>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state err" role="alert">
      <div className="state-h">No pudimos cargar esta información</div>
      <div className="state-t">{message}</div>
      {onRetry ? (
        <button type="button" className="btn ghost sm" onClick={onRetry}>
          Reintentar
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="state">
      <div className="state-h">{title}</div>
      {text ? <div className="state-t">{text}</div> : null}
      {action}
    </div>
  );
}

/** Pagina datos: «Mostrando 1–25 de 120» + anterior/siguiente. */
export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="pager">
      <span>
        Mostrando {from}–{to} de {total}
      </span>
      <div className="pager-btns">
        <button type="button" className="btn ghost sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          ← Anterior
        </button>
        <button type="button" className="btn ghost sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Siguiente →
        </button>
      </div>
    </div>
  );
}

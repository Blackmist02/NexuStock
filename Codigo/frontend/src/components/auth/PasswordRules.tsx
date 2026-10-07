/** Política de contraseña de la API (lib/password.ts): ≥ 8 caracteres, una mayúscula y un dígito. */
export interface ReglaPassword {
  id: string;
  texto: string;
  ok: boolean;
}

export function reglasPassword(pw: string): ReglaPassword[] {
  return [
    { id: "len", texto: "Al menos 8 caracteres", ok: pw.length >= 8 },
    { id: "may", texto: "Una letra mayúscula", ok: /[A-Z]/.test(pw) },
    { id: "num", texto: "Un número", ok: /[0-9]/.test(pw) },
  ];
}

export const passwordValida = (pw: string): boolean => reglasPassword(pw).every((r) => r.ok);

/** Reglas en vivo (clases .rule/.ok del diseño). */
export function PasswordRules({ password }: { password: string }) {
  return (
    <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0 }} aria-label="Requisitos de la contraseña">
      {reglasPassword(password).map((r) => (
        <li key={r.id} className={`rule${r.ok ? " ok" : ""}`} style={{ position: "relative" }}>
          <span className="ck" aria-hidden="true">
            {r.ok ? "✓" : ""}
          </span>
          {r.texto}
          <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
            {r.ok ? " (cumplido)" : " (pendiente)"}
          </span>
        </li>
      ))}
    </ul>
  );
}

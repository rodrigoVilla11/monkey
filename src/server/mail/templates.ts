import type { MailMessage } from "./mailer";

/**
 * Plantillas de los mails transaccionales.
 *
 * HTML deliberadamente simple: tablas y estilos en línea. Los clientes de mail
 * (sobre todo Outlook y Gmail) ignoran hojas de estilo y buena parte de CSS
 * moderno, así que nada de flexbox ni de clases.
 *
 * Todos los mails llevan versión de texto plano: mejora la entregabilidad y es
 * lo que ve quien tiene el HTML desactivado.
 */

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const layout = (
  title: string,
  body: string,
  action?: { label: string; url: string },
): string => `
<!doctype html>
<html lang="es">
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;padding:32px;">
        <tr><td style="font-size:28px;padding-bottom:8px;">🐒</td></tr>
        <tr><td style="font-size:20px;font-weight:600;color:#18181b;padding-bottom:16px;">${escapeHtml(title)}</td></tr>
        <tr><td style="font-size:15px;line-height:1.6;color:#3f3f46;">${body}</td></tr>
        ${
          action
            ? `<tr><td style="padding-top:24px;">
                 <a href="${escapeHtml(action.url)}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:500;">${escapeHtml(action.label)}</a>
               </td></tr>
               <tr><td style="padding-top:20px;font-size:13px;line-height:1.5;color:#71717a;">
                 Si el botón no funciona, copiá este enlace en tu navegador:<br>
                 <span style="color:#3f3f46;word-break:break-all;">${escapeHtml(action.url)}</span>
               </td></tr>`
            : ""
        }
        <tr><td style="padding-top:28px;border-top:1px solid #e4e4e7;margin-top:24px;font-size:12px;color:#a1a1aa;">
          Monkey · finanzas personales y compartidas
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

export const verifyEmailTemplate = (
  name: string,
  url: string,
  hours: number,
): Omit<MailMessage, "to"> => ({
  subject: "Verificá tu email · Monkey",
  html: layout(
    `Hola, ${name}`,
    `Confirmá tu dirección de email para empezar a usar Monkey. El enlace vence en ${String(hours)} horas.`,
    { label: "Verificar email", url },
  ),
  text: [
    `Hola, ${name}`,
    "",
    "Confirmá tu dirección de email para empezar a usar Monkey:",
    url,
    "",
    `El enlace vence en ${String(hours)} horas.`,
  ].join("\n"),
});

export const passwordResetTemplate = (
  name: string,
  url: string,
  minutes: number,
): Omit<MailMessage, "to"> => ({
  subject: "Restablecer tu contraseña · Monkey",
  html: layout(
    `Hola, ${name}`,
    `Pediste restablecer tu contraseña. El enlace vence en ${String(minutes)} minutos y solo se puede usar una vez.<br><br>` +
      `Si no fuiste vos, ignorá este mail: tu contraseña no cambió.`,
    { label: "Cambiar contraseña", url },
  ),
  text: [
    `Hola, ${name}`,
    "",
    "Pediste restablecer tu contraseña:",
    url,
    "",
    `El enlace vence en ${String(minutes)} minutos y solo se puede usar una vez.`,
    "Si no fuiste vos, ignorá este mail: tu contraseña no cambió.",
  ].join("\n"),
});

export const passwordChangedTemplate = (
  name: string,
): Omit<MailMessage, "to"> => ({
  subject: "Tu contraseña cambió · Monkey",
  html: layout(
    `Hola, ${name}`,
    "Tu contraseña de Monkey se cambió recién y se cerraron todas las sesiones abiertas.<br><br>" +
      "<strong>Si no fuiste vos</strong>, restablecé tu contraseña de inmediato.",
  ),
  text: [
    `Hola, ${name}`,
    "",
    "Tu contraseña de Monkey se cambió recién y se cerraron todas las sesiones abiertas.",
    "",
    "Si no fuiste vos, restablecé tu contraseña de inmediato.",
  ].join("\n"),
});

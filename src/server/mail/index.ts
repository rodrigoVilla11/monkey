import { createTransport, type Transporter } from "nodemailer";
import { Resend } from "resend";

import { env } from "@/env";
import { logger } from "@/server/logger";
import { maskEmail } from "@/shared/email";

import type { Mailer, MailMessage } from "./mailer";

/**
 * Selección del driver de mail según el entorno.
 *
 * `src/env.ts` ya impide que producción arranque con el driver `console`: los
 * mails de verificación e invitación nunca llegarían y las cuentas quedarían
 * inutilizables sin que nadie se entere.
 */

/** Imprime el mail por stdout. Solo desarrollo, y solo si no hay SMTP a mano. */
class ConsoleMailer implements Mailer {
  public send(message: MailMessage): Promise<void> {
    logger.info(
      { to: maskEmail(message.to), subject: message.subject },
      "mail (driver console — no se envió nada)",
    );
    logger.debug({ text: message.text }, "cuerpo del mail");
    return Promise.resolve();
  }
}

/** SMTP genérico. En desarrollo apunta a Mailpit (http://localhost:8025). */
class SmtpMailer implements Mailer {
  private readonly transporter: Transporter;

  public constructor() {
    this.transporter = createTransport({
      host: env.SMTP_HOST ?? "localhost",
      port: env.SMTP_PORT ?? 1025,
      secure: env.SMTP_SECURE,
      ...(env.SMTP_USER !== undefined && env.SMTP_USER !== ""
        ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? "" } }
        : {}),
    });
  }

  public async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: env.MAIL_FROM,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  }
}

class ResendMailer implements Mailer {
  private readonly client: Resend;

  public constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  public async send(message: MailMessage): Promise<void> {
    const { error } = await this.client.emails.send({
      from: env.MAIL_FROM,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });

    if (error) {
      // Se loguea con el email enmascarado y se propaga: quien llama decide
      // si un mail que no salió debe abortar la operación.
      logger.error(
        { to: maskEmail(message.to), error: error.message },
        "falló el envío de mail",
      );
      throw new Error(`No se pudo enviar el mail: ${error.message}`);
    }
  }
}

let instance: Mailer | undefined;

export const getMailer = (): Mailer => {
  instance ??= (() => {
    switch (env.MAIL_DRIVER) {
      case "resend":
        // env.ts garantiza que la clave existe cuando el driver es resend.
        return new ResendMailer(env.RESEND_API_KEY ?? "");
      case "smtp":
        return new SmtpMailer();
      case "console":
        return new ConsoleMailer();
    }
  })();

  return instance;
};

export type { Mailer, MailMessage };

/**
 * Envío de mail detrás de una interfaz.
 *
 * Los services nunca hablan con Resend ni con SMTP: reciben un `Mailer`. Eso
 * permite cambiar de proveedor sin tocar lógica de negocio, y que los tests
 * usen una implementación en memoria que captura lo enviado.
 */

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Guarda los mensajes en memoria. Solo para tests. */
export class InMemoryMailer implements Mailer {
  public readonly sent: MailMessage[] = [];

  public send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }

  public clear(): void {
    this.sent.length = 0;
  }

  public lastTo(to: string): MailMessage | undefined {
    return this.sent.filter((m) => m.to === to).at(-1);
  }
}

import { describe, expect, it } from "vitest";

import {
  detectMimeType,
  formatBytes,
  sanitizeFilename,
} from "@/shared/file-type";

/**
 * Detección del tipo real de un archivo.
 *
 * El caso que da sentido a todo el módulo es el último de "no se fía de lo que
 * diga el cliente": un ejecutable renombrado a .jpg pasa cualquier validación
 * basada en el `Content-Type`, y no pasa esta.
 */

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

/** ASCII a bytes. `TextEncoder` y no un spread: es lo que hace un archivo real. */
const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("formatos admitidos", () => {
  it("reconoce JPEG", () => {
    expect(detectMimeType(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10))).toBe(
      "image/jpeg",
    );
  });

  it("reconoce PNG", () => {
    expect(
      detectMimeType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
    ).toBe("image/png");
  });

  it("reconoce PDF", () => {
    expect(detectMimeType(ascii("%PDF-1.7"))).toBe("application/pdf");
  });

  it("reconoce WebP, cuya firma está desplazada", () => {
    // "RIFF" + 4 bytes de tamaño + "WEBP"
    const webp = new Uint8Array([
      ...ascii("RIFF"),
      0x24,
      0x00,
      0x00,
      0x00,
      ...ascii("WEBP"),
    ]);
    expect(detectMimeType(webp)).toBe("image/webp");
  });

  it("reconoce HEIC, que es lo que saca la cámara de un iPhone", () => {
    // 4 bytes de tamaño + "ftyp" + marca
    const heic = new Uint8Array([
      0x00,
      0x00,
      0x00,
      0x18,
      ...ascii("ftyp"),
      ...ascii("heic"),
    ]);
    expect(detectMimeType(heic)).toBe("image/heic");
  });

  it("reconoce las otras marcas de la familia HEIF", () => {
    for (const brand of ["heix", "mif1", "msf1"]) {
      const file = new Uint8Array([
        0x00,
        0x00,
        0x00,
        0x18,
        ...ascii("ftyp"),
        ...ascii(brand),
      ]);
      expect(detectMimeType(file)).toBe("image/heic");
    }
  });
});

describe("no se fía de lo que diga el cliente", () => {
  it("rechaza un ejecutable aunque se llame foto.jpg", () => {
    // "MZ" es la firma de un PE de Windows.
    expect(detectMimeType(ascii("MZ\u0090\u0000\u0003"))).toBeNull();
  });

  it("rechaza un ELF", () => {
    expect(detectMimeType(bytes(0x7f, 0x45, 0x4c, 0x46))).toBeNull();
  });

  it("rechaza un ZIP, y por lo tanto un docx o un jar", () => {
    expect(detectMimeType(bytes(0x50, 0x4b, 0x03, 0x04))).toBeNull();
  });

  it("rechaza un SVG: es XML y puede traer scripts", () => {
    expect(detectMimeType(ascii("<svg xmlns="))).toBeNull();
  });

  it("rechaza HTML", () => {
    expect(detectMimeType(ascii("<!DOCTYPE html>"))).toBeNull();
  });

  it("rechaza texto plano", () => {
    expect(detectMimeType(ascii("hola que tal"))).toBeNull();
  });

  it("rechaza un archivo vacío o demasiado corto", () => {
    expect(detectMimeType(new Uint8Array())).toBeNull();
    expect(detectMimeType(bytes(0xff, 0xd8))).toBeNull();
  });

  it("un MP4 no pasa por HEIC: comparte el ftyp pero no la marca", () => {
    const mp4 = new Uint8Array([
      0x00,
      0x00,
      0x00,
      0x18,
      ...ascii("ftyp"),
      ...ascii("isom"),
    ]);
    expect(detectMimeType(mp4)).toBeNull();
  });

  it("un RIFF que no es WebP tampoco pasa", () => {
    // Un WAV: "RIFF" + tamaño + "WAVE".
    const wav = new Uint8Array([
      ...ascii("RIFF"),
      0x24,
      0x00,
      0x00,
      0x00,
      ...ascii("WAVE"),
    ]);
    expect(detectMimeType(wav)).toBeNull();
  });
});

describe("nombre de archivo", () => {
  it("quita las barras: nada de rutas", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("..-..-etc-passwd");
    expect(sanitizeFilename("C:\\temp\\foto.jpg")).toBe("C-temp-foto.jpg");
  });

  it("quita saltos de línea y comillas, que permiten inyectar cabeceras", () => {
    // Va en el Content-Disposition: un salto ahí abre la puerta a inyectar.
    // Los dos puntos caen también, por ser inválidos en Windows.
    expect(sanitizeFilename('recibo.pdf"\r\nX-Malo: 1')).toBe(
      "recibo.pdfX-Malo 1",
    );
  });

  it("conserva tildes y espacios, que son legítimos", () => {
    expect(sanitizeFilename("Factura luz – marzo.pdf")).toBe(
      "Factura luz – marzo.pdf",
    );
  });

  it("recorta los nombres larguísimos", () => {
    expect(sanitizeFilename(`${"a".repeat(300)}.pdf`).length).toBe(120);
  });

  it("cae al nombre por defecto si no queda nada", () => {
    expect(sanitizeFilename("")).toBe("adjunto");
    expect(sanitizeFilename("..")).toBe("adjunto");
    expect(sanitizeFilename('"""')).toBe("adjunto");
  });
});

describe("tamaño legible", () => {
  it("formatea en la unidad que corresponde", () => {
    expect(formatBytes(512, "es-ES")).toBe("512 B");
    expect(formatBytes(2048, "es-ES")).toBe("2 kB");
    expect(formatBytes(1024 * 1024 * 3, "es-ES")).toBe("3 MB");
  });

  it("usa el separador decimal del locale", () => {
    expect(formatBytes(1536, "es-ES")).toBe("1,5 kB");
    expect(formatBytes(1536, "en-US")).toBe("1.5 kB");
  });
});

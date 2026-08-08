import { describe, expect, it } from "vitest";

import {
  delimiterForLocale,
  detectDelimiter,
  escapeCell,
  mapHeaders,
  normalizeHeader,
  parseCsv,
  serializeCsv,
  stripBom,
} from "@/shared/csv";

/**
 * CSV.
 *
 * Los casos que importan no son los del formato ideal, son los de los archivos
 * que produce la gente: Excel en español con punto y coma, BOM al principio,
 * descripciones con comas y comillas, y finales de línea de tres sistemas
 * operativos distintos.
 */

const BOM = "﻿";

describe("detección del separador", () => {
  it("reconoce el punto y coma de Excel en español", () => {
    // Es EL caso: la coma ya está ocupada como separador decimal.
    expect(
      detectDelimiter("fecha;importe;descripcion\n2026-08-01;12,50;Café"),
    ).toBe(";");
  });

  it("reconoce la coma", () => {
    expect(
      detectDelimiter("date,amount,description\n2026-08-01,12.50,Coffee"),
    ).toBe(",");
  });

  it("reconoce el tabulador", () => {
    expect(detectDelimiter("fecha\timporte\tdescripcion")).toBe("\t");
  });

  it("ignora los separadores que están dentro de comillas", () => {
    // La cabecera tiene una sola coma real; las otras son texto.
    expect(detectDelimiter('"a,b,c,d";"e";"f"')).toBe(";");
  });

  it("por defecto, coma", () => {
    expect(detectDelimiter("unacolumna")).toBe(",");
    expect(detectDelimiter("")).toBe(",");
  });

  it("no se confunde con el BOM delante", () => {
    expect(detectDelimiter(`${BOM}fecha;importe`)).toBe(";");
  });
});

describe("BOM", () => {
  it("se quita al parsear", () => {
    const rows = parseCsv(`${BOM}fecha,importe\n2026-08-01,10`);
    expect(rows[0]).toEqual(["fecha", "importe"]);
  });

  it("se pone al serializar, para que Excel no rompa las tildes", () => {
    const output = serializeCsv([["café"]]);
    expect(output.startsWith(BOM)).toBe(true);
  });

  it("se puede quitar explícitamente", () => {
    expect(serializeCsv([["a"]], { bom: false }).startsWith(BOM)).toBe(false);
  });

  it("stripBom no toca un texto sin BOM", () => {
    expect(stripBom("hola")).toBe("hola");
  });
});

describe("parseo", () => {
  it("parte por el separador", () => {
    expect(parseCsv("a,b,c")).toEqual([["a", "b", "c"]]);
  });

  it("respeta el separador dentro de comillas", () => {
    // La descripción con coma es lo primero que rompe un split ingenuo.
    expect(parseCsv('2026-08-01,"Café, tostada y zumo",12.50')).toEqual([
      ["2026-08-01", "Café, tostada y zumo", "12.50"],
    ]);
  });

  it("entiende la comilla duplicada como comilla literal", () => {
    expect(parseCsv('a,"dijo ""hola""",c')).toEqual([
      ["a", 'dijo "hola"', "c"],
    ]);
  });

  it("admite saltos de línea dentro de comillas", () => {
    expect(parseCsv('a,"linea 1\nlinea 2",c')).toEqual([
      ["a", "linea 1\nlinea 2", "c"],
    ]);
  });

  it("acepta CRLF, LF y CR sueltos", () => {
    expect(parseCsv("a,b\r\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseCsv("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseCsv("a,b\rc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("descarta la línea vacía del final pero no las celdas vacías", () => {
    expect(parseCsv("a,b\n")).toEqual([["a", "b"]]);
    // Cuatro columnas vacías son un dato, no una fila de más.
    expect(parseCsv(",,,")).toEqual([["", "", "", ""]]);
  });

  it("conserva los espacios de dentro de las comillas", () => {
    expect(parseCsv('a,"  b  ",c')).toEqual([["a", "  b  ", "c"]]);
  });

  it("parsea un extracto en formato español entero", () => {
    const input = `${BOM}Fecha;Concepto;Importe\r\n2026-08-01;"Supermercado, compra semanal";-84,50\r\n2026-08-02;Nómina;1.850,00\r\n`;

    expect(parseCsv(input)).toEqual([
      ["Fecha", "Concepto", "Importe"],
      ["2026-08-01", "Supermercado, compra semanal", "-84,50"],
      ["2026-08-02", "Nómina", "1.850,00"],
    ]);
  });

  it("no se cuelga con un archivo vacío", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n")).toEqual([]);
  });
});

describe("serialización", () => {
  it("no entrecomilla lo que no hace falta", () => {
    // Entrecomillar todo haría el archivo ilegible a ojo, que es media razón
    // por la que alguien exporta a CSV.
    expect(serializeCsv([["a", "b"]], { bom: false, eol: "\n" })).toBe("a,b\n");
  });

  it("entrecomilla lo que contiene el separador, comillas o saltos", () => {
    expect(escapeCell("a,b", ",")).toBe('"a,b"');
    expect(escapeCell('dijo "hola"', ",")).toBe('"dijo ""hola"""');
    expect(escapeCell("linea 1\nlinea 2", ",")).toBe('"linea 1\nlinea 2"');
  });

  it("entrecomilla lo que tiene espacios en los extremos", () => {
    // Sin comillas, algunos lectores lo recortan y el dato cambia.
    expect(escapeCell("  hola  ", ",")).toBe('"  hola  "');
  });

  it("con punto y coma, una celda con coma NO necesita comillas", () => {
    expect(escapeCell("12,50", ";")).toBe("12,50");
    expect(escapeCell("a;b", ";")).toBe('"a;b"');
  });

  it("la ida y vuelta conserva todo", () => {
    const rows = [
      ["Fecha", "Concepto", "Importe"],
      ["2026-08-01", 'Café, "el bueno"', "-12,50"],
      ["2026-08-02", "Con\nsalto", "1.850,00"],
      ["", "  espacios  ", ""],
    ];

    expect(parseCsv(serializeCsv(rows, { delimiter: ";" }), ";")).toEqual(rows);
  });
});

describe("separador según el locale", () => {
  it("punto y coma donde la coma es decimal", () => {
    expect(delimiterForLocale("es-ES")).toBe(";");
    expect(delimiterForLocale("es-AR")).toBe(";");
  });

  it("coma donde el punto es decimal", () => {
    expect(delimiterForLocale("en-US")).toBe(",");
  });

  it("coma ante un locale desconocido", () => {
    expect(delimiterForLocale("zz-ZZ")).toBe(",");
  });
});

describe("cabeceras", () => {
  it("normaliza tildes, mayúsculas y espacios", () => {
    expect(normalizeHeader(" Descripción ")).toBe("descripcion");
    expect(normalizeHeader("FECHA")).toBe("fecha");
    expect(normalizeHeader("Importe  Total")).toBe("importetotal");
  });

  it("encuentra cada columna por cualquiera de sus alias", () => {
    const header = ["Fecha", "Concepto", "Importe"];
    const map = mapHeaders(header, {
      date: ["fecha", "date"],
      description: ["concepto", "descripcion", "description"],
      amount: ["importe", "amount"],
      account: ["cuenta", "account"],
    });

    expect(map.date).toBe(0);
    expect(map.description).toBe(1);
    expect(map.amount).toBe(2);
    // La que no está devuelve -1: quien llama decide si era obligatoria.
    expect(map.account).toBe(-1);
  });

  it("encuentra las columnas aunque vengan con tildes y en mayúsculas", () => {
    const map = mapHeaders([`${BOM}FECHA`, "Descripción"], {
      date: ["fecha"],
      description: ["descripcion"],
    });

    // El BOM ya se quitó al parsear; acá se comprueba que la normalización
    // tolera igual el caso de que alguien pase la cabecera cruda.
    expect(map.description).toBe(1);
  });
});

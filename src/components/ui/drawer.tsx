"use client";

import * as React from "react";
import { Drawer as DrawerPrimitive } from "vaul";

import { cn } from "@/lib/utils";

/**
 * `repositionInputs={false}`: el teclado lo maneja la app, no vaul.
 *
 * Vaul sube el drawer escribiéndole `height` y `bottom` en línea cada vez que
 * cambia el viewport visual, pero su handler arranca con un `return` temprano
 * si en ese momento no hay un input enfocado Y su bandera interna de "teclado
 * abierto" está en false. Esa bandera se da vuelta con cada `resize` de más de
 * 60px, y iOS manda varios por cada aparición del teclado (la animación, la
 * barra de sugerencias). Cuando quedan en número impar, la bandera termina al
 * revés: al cerrarse el teclado el handler corta antes de tiempo y el drawer
 * se queda con el `bottom` de 300px y el alto recortado que le habían puesto
 * — flotando sobre un hueco vacío, sin ningún evento futuro que lo acomode.
 *
 * Acá la posición sale de `--keyboard-inset` (ver `layout/keyboard-inset.tsx`),
 * que es una medida, no un estado: cuando el teclado se va vuelve a 0px y el
 * drawer baja solo. No hay forma de que quede trabado.
 *
 * Va antes del spread para que una pantalla puntual pueda volver atrás.
 */
function Drawer({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  return (
    <DrawerPrimitive.Root
      data-slot="drawer"
      repositionInputs={false}
      {...props}
    />
  );
}

function DrawerTrigger({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Trigger>) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

function DrawerPortal({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Portal>) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />;
}

function DrawerClose({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Close>) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

function DrawerOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Overlay>) {
  return (
    <DrawerPrimitive.Overlay
      data-slot="drawer-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  );
}

function DrawerContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Content>) {
  return (
    <DrawerPortal data-slot="drawer-portal">
      <DrawerOverlay />
      <DrawerPrimitive.Content
        data-slot="drawer-content"
        className={cn(
          // `overflow-hidden` es lo que obliga a que el scroll viva en
          // DrawerBody: sin esto, un formulario más alto que el máximo se
          // desborda hacia arriba fuera de la pantalla y no hay forma de
          // llegar al botón de abajo.
          "group/drawer-content fixed z-50 flex h-auto flex-col overflow-hidden bg-background",
          "data-[vaul-drawer-direction=top]:inset-x-0 data-[vaul-drawer-direction=top]:top-0 data-[vaul-drawer-direction=top]:mb-24 data-[vaul-drawer-direction=top]:max-h-[90dvh] data-[vaul-drawer-direction=top]:rounded-b-lg data-[vaul-drawer-direction=top]:border-b",
          // El teclado empuja el drawer hacia arriba y le come alto en la
          // misma medida: subirlo sin recortarlo le mandaría el encabezado
          // fuera de pantalla. `dvh` no se entera del teclado, por eso la resta.
          "data-[vaul-drawer-direction=bottom]:inset-x-0 data-[vaul-drawer-direction=bottom]:bottom-(--keyboard-inset) data-[vaul-drawer-direction=bottom]:mt-24 data-[vaul-drawer-direction=bottom]:max-h-[calc(90dvh-var(--keyboard-inset,0px))] data-[vaul-drawer-direction=bottom]:rounded-t-lg data-[vaul-drawer-direction=bottom]:border-t",
          "data-[vaul-drawer-direction=right]:inset-y-0 data-[vaul-drawer-direction=right]:right-0 data-[vaul-drawer-direction=right]:w-3/4 data-[vaul-drawer-direction=right]:border-l data-[vaul-drawer-direction=right]:sm:max-w-sm",
          "data-[vaul-drawer-direction=left]:inset-y-0 data-[vaul-drawer-direction=left]:left-0 data-[vaul-drawer-direction=left]:w-3/4 data-[vaul-drawer-direction=left]:border-r data-[vaul-drawer-direction=left]:sm:max-w-sm",
          className,
        )}
        {...props}
      >
        <div className="mx-auto mt-4 hidden h-2 w-[100px] shrink-0 rounded-full bg-muted group-data-[vaul-drawer-direction=bottom]/drawer-content:block" />
        {children}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  );
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn(
        "flex flex-col gap-0.5 p-4 group-data-[vaul-drawer-direction=bottom]/drawer-content:text-center group-data-[vaul-drawer-direction=top]/drawer-content:text-center md:gap-1.5 md:text-left",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Cuerpo con scroll del drawer.
 *
 * Existe para que no haya que acordarse: el patrón "div suelto con el
 * formulario adentro" ya se rompió una vez —un formulario creció, pasó del
 * alto máximo y el botón de guardar quedó fuera de alcance—, así que el
 * contenedor scrolleable es un componente y no una convención.
 *
 * Sin `flex-1` a propósito: un drawer corto tiene que medir lo que mide su
 * contenido, no estirarse hasta el máximo.
 */
function DrawerBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-body"
      className={cn("app-scroll min-h-0 px-4 pb-6", className)}
      {...props}
    />
  );
}

function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  );
}

function DrawerTitle({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn("font-semibold text-foreground", className)}
      {...props}
    />
  );
}

function DrawerDescription({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerBody,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
};

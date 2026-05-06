// Tipos del catálogo normativo. Sin dependencias en runtime: el catálogo se
// carga estáticamente y las citas se anclan al texto verbatim de
// `data/normativas/*.md`. Sin LLM en el path de citación.

export type LegalRefId = string;

export type LegalKind =
  | "ley"
  | "ncg"
  | "circular"
  | "resolucion"
  | "manual"
  | "protocolo"
  | "tos";

export interface CitaUbicacion {
  readonly localPath: string;
  readonly lineaInicio: number;
  readonly lineaFin: number;
}

export interface Cita {
  readonly articulo: string;
  readonly texto: string;
  readonly ubicacion: CitaUbicacion;
  readonly extractoCorto?: string;
}

export interface LegalReference {
  readonly id: LegalRefId;
  readonly kind: LegalKind;
  readonly titulo: string;
  readonly autoridad: string;
  readonly vigenciaDesde: string;
  readonly vigenciaHasta?: string;
  readonly urlOficial?: string;
  readonly localPath?: string;
  readonly citas: ReadonlyArray<Cita>;
}

export interface ResolvedLegalReference extends LegalReference {
  readonly citasInvocadas: ReadonlyArray<Cita>;
}

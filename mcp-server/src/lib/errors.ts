export interface ToolErrorOptions {
  source: string;
  cause?: unknown;
  retriable?: boolean;
  userFacing?: string;
}

interface ToolErrorJSON {
  name: string;
  message: string;
  source: string;
  retriable: boolean;
  userFacing: string;
  cause?: unknown;
}

export class ToolError extends Error {
  override readonly name: string = "ToolError";
  readonly source: string;
  readonly retriable: boolean;
  readonly userFacing: string;

  constructor(message: string, options: ToolErrorOptions) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.source = options.source;
    this.retriable = options.retriable ?? false;
    this.userFacing = options.userFacing ?? message;
  }

  toJSON(): ToolErrorJSON {
    const json: ToolErrorJSON = {
      name: this.name,
      message: this.message,
      source: this.source,
      retriable: this.retriable,
      userFacing: this.userFacing,
    };
    if (this.cause !== undefined) {
      json.cause =
        this.cause instanceof Error
          ? { name: this.cause.name, message: this.cause.message }
          : this.cause;
    }
    return json;
  }
}

export type SourceErrorOptions = Omit<ToolErrorOptions, "source">;

function defineSourceError(name: string, source: string) {
  return class extends ToolError {
    override readonly name: string = name;
    constructor(message: string, options: SourceErrorOptions = {}) {
      super(message, { ...options, source });
    }
  };
}

export const BCEError = defineSourceError("BCEError", "bce");
export const BCNError = defineSourceError("BCNError", "bcn-ley-facil");
export const ClaudeAPIError = defineSourceError("ClaudeAPIError", "claude-api");
export const CMFFetchError = defineSourceError("CMFFetchError", "cmf-alertas");
export const CSIRTError = defineSourceError("CSIRTError", "csirt");
export const DequienesError = defineSourceError("DequienesError", "dequienes");
export const FinteChileError = defineSourceError("FinteChileError", "fintechile");
export const NICError = defineSourceError("NICError", "nic-chile");
export const PhishTankError = defineSourceError("PhishTankError", "phishtank");
export const SafeBrowsingError = defineSourceError("SafeBrowsingError", "google-safe-browsing");
export const SIIError = defineSourceError("SIIError", "sii");
export const TLSError = defineSourceError("TLSError", "tls");
export const URLhausError = defineSourceError("URLhausError", "urlhaus");
export const WHOISError = defineSourceError("WHOISError", "whois");

export type BCEError = InstanceType<typeof BCEError>;
export type BCNError = InstanceType<typeof BCNError>;
export type ClaudeAPIError = InstanceType<typeof ClaudeAPIError>;
export type CMFFetchError = InstanceType<typeof CMFFetchError>;
export type CSIRTError = InstanceType<typeof CSIRTError>;
export type DequienesError = InstanceType<typeof DequienesError>;
export type FinteChileError = InstanceType<typeof FinteChileError>;
export type NICError = InstanceType<typeof NICError>;
export type PhishTankError = InstanceType<typeof PhishTankError>;
export type SafeBrowsingError = InstanceType<typeof SafeBrowsingError>;
export type SIIError = InstanceType<typeof SIIError>;
export type TLSError = InstanceType<typeof TLSError>;
export type URLhausError = InstanceType<typeof URLhausError>;
export type WHOISError = InstanceType<typeof WHOISError>;

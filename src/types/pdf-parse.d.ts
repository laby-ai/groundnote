declare module 'pdf-parse-fixed' {
  interface PdfParseResult {
    numpages: number;
    numrender: number;
    info: Record<string, unknown> | null;
    metadata: Record<string, unknown> | null;
    text: string;
    version: string | null;
  }

  function pdfParse(
    dataBuffer: Buffer | ArrayBuffer | Uint8Array,
    options?: { [key: string]: unknown }
  ): Promise<PdfParseResult>;

  export default pdfParse;
}

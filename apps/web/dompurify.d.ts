declare module "dompurify" {
  const DOMPurify: {
    sanitize(dirty: string, config?: unknown): string;
  };

  export default DOMPurify;
}

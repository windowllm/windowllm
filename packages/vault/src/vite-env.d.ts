/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Chrome extension API types (minimal subset for extension-entry.tsx)
declare namespace chrome {
  namespace runtime {
    function sendMessage(message: unknown): Promise<unknown>;
  }
}

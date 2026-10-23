/// <reference types="vite/client" />

declare const __NV_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_NV_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

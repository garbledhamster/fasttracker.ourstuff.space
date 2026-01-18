import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        console: "readonly",
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
        alert: "readonly",
        confirm: "readonly",
        prompt: "readonly",
        Blob: "readonly",
        URL: "readonly",
        crypto: "readonly",
        indexedDB: "readonly",
        IDBKeyRange: "readonly",
        atob: "readonly",
        btoa: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        requestAnimationFrame: "readonly",
        Notification: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-console": "off",
      "no-debugger": "warn",
      "prefer-const": "warn",
      "no-var": "warn",
    },
  },
  // Service Worker specific configuration
  {
    files: ["sw.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        self: "readonly",
        caches: "readonly",
        fetch: "readonly",
        console: "readonly",
      },
    },
  },
  {
    ignores: ["node_modules/", "dist/", "build/", "*.min.js"],
  },
];

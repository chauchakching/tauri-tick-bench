// client/src/tauri.d.ts
declare global {
  interface Window {
    __TAURI__?: {
      // Add Tauri API types as needed
    };
  }
}

export {};

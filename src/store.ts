import { create } from "zustand";

export interface FileInfo {
  path: string;
  name: string;
  size: number;
  isDir: boolean;
}

interface AppState {
  files: FileInfo[];
  format: "7z" | "zip" | "zstd";
  level: "fast" | "normal" | "max";
  isCompressing: boolean;
  progress: { current: number; total: number } | null;
  result: { originalBytes: number; compressedBytes: number; outputPath: string } | null;
  error: string | null;
  addFiles: (files: FileInfo[]) => void;
  removeFile: (path: string) => void;
  clearFiles: () => void;
  setFormat: (format: "7z" | "zip" | "zstd") => void;
  setLevel: (level: "fast" | "normal" | "max") => void;
  setCompressing: (value: boolean) => void;
  setProgress: (progress: { current: number; total: number } | null) => void;
  setResult: (result: { originalBytes: number; compressedBytes: number; outputPath: string } | null) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useStore = create<AppState>((set) => ({
  files: [],
  format: "zip",
  level: "normal",
  isCompressing: false,
  progress: null,
  result: null,
  error: null,
  addFiles: (files) =>
    set((state) => {
      const existing = new Set(state.files.map((f) => f.path));
      const newFiles = files.filter((f) => !existing.has(f.path));
      return { files: [...state.files, ...newFiles], result: null, error: null };
    }),
  removeFile: (path) =>
    set((state) => ({
      files: state.files.filter((f) => f.path !== path),
    })),
  clearFiles: () => set({ files: [], result: null, progress: null, error: null }),
  setFormat: (format) => set({ format }),
  setLevel: (level) => set({ level }),
  setCompressing: (isCompressing) => set({ isCompressing }),
  setProgress: (progress) => set({ progress }),
  setResult: (result) => set({ result }),
  setError: (error) => set({ error }),
  reset: () => set({ result: null, progress: null, error: null }),
}));

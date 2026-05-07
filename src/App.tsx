import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState } from "react";
import {
  Archive,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  Layers,
  Minus,
  Plus,
  Square,
  X,
  Zap,
} from "lucide-react";
import { useStore, type FileInfo } from "./store";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

const appWindow = getCurrentWindow();

export default function App() {
  const {
    files,
    format,
    level,
    isCompressing,
    progress,
    result,
    error,
    addFiles,
    removeFile,
    clearFiles,
    setFormat,
    setLevel,
    setCompressing,
    setProgress,
    setResult,
    setError,
    reset,
  } = useStore();

  const [isDragging, setIsDragging] = useState(false);

  const fetchAndAdd = useCallback(async (paths: string[]) => {
    reset();
    const newFiles: FileInfo[] = [];
    for (const path of paths) {
      try {
        const info = (await invoke("get_file_info", { path })) as FileInfo;
        newFiles.push(info);
      } catch {
        // skip
      }
    }
    if (newFiles.length > 0) addFiles(newFiles);
  }, [addFiles, reset]);

  useEffect(() => {
    const unlistenDrag = getCurrentWebview().onDragDropEvent((event) => {
      const p = event.payload;
      if (p.type === "enter" || p.type === "over") {
        setIsDragging(true);
      } else if (p.type === "leave") {
        setIsDragging(false);
      } else if (p.type === "drop") {
        setIsDragging(false);
        fetchAndAdd(p.paths);
      }
    });

    const unlistenProgress = listen("compress://progress", (event) => {
      setProgress(event.payload as { current: number; total: number });
    });

    const unlistenDone = listen("compress://done", (event) => {
      const p = event.payload as { original_bytes: number; compressed_bytes: number; output_path: string };
      setResult({ originalBytes: p.original_bytes, compressedBytes: p.compressed_bytes, outputPath: p.output_path });
      setCompressing(false);
      setProgress(null);
    });

    return () => {
      unlistenDrag.then((u) => u());
      unlistenProgress.then((u) => u());
      unlistenDone.then((u) => u());
    };
  }, [fetchAndAdd, setProgress, setResult, setCompressing]);

  const handleOpenFiles = async () => {
    const selected = await open({
      multiple: true,
      directory: false,
      title: "Seleccionar archivos",
    });
    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      fetchAndAdd(paths);
    }
  };

  const handleOpenFolders = async () => {
    const selected = await open({
      multiple: true,
      directory: true,
      title: "Seleccionar carpetas",
    });
    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      fetchAndAdd(paths);
    }
  };

  const handleCompress = async () => {
    if (files.length === 0) return;
    setError(null);
    reset();
    setCompressing(true);

    const firstPath = files[0].path;
    const separator = firstPath.includes("/") ? "/" : "\\";
    const dir = firstPath.substring(0, firstPath.lastIndexOf(separator));
    const timestamp = Date.now();
    const ext = format === "zstd" ? "tar.zst" : format;
    const output = `${dir}${separator}squish_${timestamp}.${ext}`;

    try {
      await invoke("compress_files", {
        inputPaths: files.map((f) => f.path),
        format,
        level,
        output,
      });
    } catch (e) {
      setError(String(e));
      setCompressing(false);
    }
  };

  const openOutputFolder = () => {
    if (files.length === 0) return;
    const firstPath = files[0].path;
    const separator = firstPath.includes("/") ? "/" : "\\";
    const dir = firstPath.substring(0, firstPath.lastIndexOf(separator));
    revealItemInDir(dir);
  };

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  const reduction =
    result && result.originalBytes > 0
      ? ((1 - result.compressedBytes / result.originalBytes) * 100).toFixed(1)
      : null;

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-200">
      <div
        data-tauri-drag-region
        className="flex items-center justify-between h-11 px-3 shrink-0 border-b border-zinc-900"
      >
        <div className="flex items-center gap-2" data-tauri-drag-region>
          <Layers className="w-4 h-4 text-violet-500" />
          <span className="text-sm font-semibold tracking-wide">Squish</span>
        </div>
        <div className="flex items-center">
          <button
            onClick={() => appWindow.minimize()}
            className="p-2 hover:bg-zinc-800 rounded-md transition-colors"
          >
            <Minus className="w-3.5 h-3.5 text-zinc-400" />
          </button>
          <button
            onClick={() => appWindow.toggleMaximize()}
            className="p-2 hover:bg-zinc-800 rounded-md transition-colors"
          >
            <Square className="w-3 h-3 text-zinc-400" />
          </button>
          <button
            onClick={() => appWindow.close()}
            className="p-2 hover:bg-red-600 rounded-md transition-colors"
          >
            <X className="w-3.5 h-3.5 text-zinc-400" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0 px-5 pt-4 pb-4 gap-4">
        {files.length === 0 ? (
          <div
            className={`flex-1 flex flex-col items-center justify-center rounded-xl border-2 border-dashed transition-all duration-200 ${
              isDragging
                ? "border-violet-500 bg-violet-500/5 scale-[1.01]"
                : "border-zinc-800 hover:border-zinc-700"
            }`}
          >
            <Archive className="w-10 h-10 text-zinc-600 mb-3" />
            <p className="text-zinc-400 text-sm mb-4">
              Arrastra archivos o carpetas aquí
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleOpenFiles}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors"
              >
                <File className="w-3.5 h-3.5" />
                Archivos
              </button>
              <button
                onClick={handleOpenFolders}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Carpetas
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  {files.length} {files.length === 1 ? "elemento" : "elementos"}
                </span>
                <span className="text-xs text-zinc-600">
                  {formatBytes(totalSize)}
                </span>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={handleOpenFiles}
                  disabled={isCompressing}
                  className="p-1.5 hover:bg-zinc-800 rounded-md transition-colors disabled:opacity-40"
                  title="Agregar archivos"
                >
                  <Plus className="w-3.5 h-3.5 text-zinc-400" />
                </button>
                <button
                  onClick={clearFiles}
                  disabled={isCompressing}
                  className="p-1.5 hover:bg-zinc-800 rounded-md transition-colors disabled:opacity-40"
                  title="Limpiar todo"
                >
                  <X className="w-3.5 h-3.5 text-zinc-400" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1 pr-1">
              {files.map((file) => (
                <div
                  key={file.path}
                  className="flex items-center justify-between bg-zinc-900/60 hover:bg-zinc-900 rounded-lg px-3 py-2 transition-colors group"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {file.isDir ? (
                      <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                    ) : (
                      <File className="w-4 h-4 text-violet-400 shrink-0" />
                    )}
                    <span className="text-sm truncate">{file.name}</span>
                    <span className="text-xs text-zinc-600 shrink-0">
                      {formatBytes(file.size)}
                    </span>
                  </div>
                  <button
                    onClick={() => removeFile(file.path)}
                    disabled={isCompressing}
                    className="p-1 hover:bg-zinc-800 rounded-md transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-0"
                  >
                    <X className="w-3 h-3 text-zinc-500" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {progress && (
          <div className="shrink-0">
            <div className="flex items-center justify-between text-xs text-zinc-400 mb-1.5">
              <span>Comprimiendo...</span>
              <span>
                {progress.current} / {progress.total}
                <span className="text-zinc-600 ml-1.5">
                  ({Math.round((progress.current / progress.total) * 100)}%)
                </span>
              </span>
            </div>
            <div className="h-1.5 bg-zinc-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-violet-500 rounded-full transition-all duration-300 ease-out"
                style={{
                  width: `${(progress.current / progress.total) * 100}%`,
                }}
              />
            </div>
          </div>
        )}

        {result && (
          <div className="shrink-0 bg-zinc-900/60 rounded-xl p-3.5 space-y-1.5 border border-zinc-800">
            {result.originalBytes > 0 && (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500">Original</span>
                  <span className="font-medium">{formatBytes(result.originalBytes)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500">Comprimido</span>
                  <span className="font-medium">{formatBytes(result.compressedBytes)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500">Reducción</span>
                  <span className="font-medium text-emerald-400">{reduction}%</span>
                </div>
              </>
            )}
            <button
              onClick={openOutputFolder}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm transition-colors mt-1"
            >
              <FolderOpen className="w-4 h-4" />
              Abrir carpeta de destino
            </button>
          </div>
        )}

        {error && (
          <div className="shrink-0 text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex items-center gap-2.5 shrink-0">
          <div className="relative">
            <select
              value={format}
              onChange={(e) =>
                setFormat(e.target.value as "7z" | "zip" | "zstd")
              }
              disabled={isCompressing}
              className="appearance-none bg-zinc-900 text-sm rounded-lg pl-3 pr-8 py-2 border border-zinc-800 focus:outline-none focus:border-violet-500 disabled:opacity-50 transition-colors"
            >
              <option value="7z">7z (LZMA2)</option>
              <option value="zip">ZIP</option>
              <option value="zstd">ZSTD</option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-zinc-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          <div className="relative">
            <select
              value={level}
              onChange={(e) =>
                setLevel(e.target.value as "fast" | "normal" | "max")
              }
              disabled={isCompressing}
              className="appearance-none bg-zinc-900 text-sm rounded-lg pl-3 pr-8 py-2 border border-zinc-800 focus:outline-none focus:border-violet-500 disabled:opacity-50 transition-colors"
            >
              <option value="fast">Fast</option>
              <option value="normal">Normal</option>
              <option value="max">Max</option>
            </select>
            <Zap className="w-3.5 h-3.5 text-zinc-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          <button
            onClick={handleCompress}
            disabled={files.length === 0 || isCompressing}
            className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white text-sm font-medium rounded-lg py-2 transition-colors"
          >
            {isCompressing ? "Comprimiendo..." : "Comprimir"}
          </button>
        </div>
      </div>
    </div>
  );
}

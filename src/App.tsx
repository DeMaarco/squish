import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState } from "react";
import {
  Archive,
  File,
  Folder,
  FolderOpen,
  Layers,
  Minus,
  Plus,
  Square,
  X,
} from "lucide-react";
import { useStore, type CompressionProgress, type FileInfo } from "./store";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function getParentDir(path: string): string {
  const separator = path.includes("/") ? "/" : "\\";
  const index = path.lastIndexOf(separator);
  return index > 0 ? path.substring(0, index) : ".";
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function progressPercent(progress: CompressionProgress): number {
  if (Number.isFinite(progress.percent)) return Math.min(100, Math.max(0, progress.percent));
  if (progress.totalBytes > 0) {
    return Math.min(100, Math.max(0, (progress.processedBytes / progress.totalBytes) * 100));
  }
  return 0;
}

const appWindow = getCurrentWindow();

export default function App() {
  const {
    files,
    isCompressing,
    progress,
    result,
    error,
    addFiles,
    removeFile,
    clearFiles,
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
    let failed = 0;
    for (const path of paths) {
      try {
        const info = (await invoke("get_file_info", { path })) as FileInfo;
        newFiles.push(info);
      } catch {
        failed += 1;
      }
    }
    if (newFiles.length > 0) addFiles(newFiles);
    if (failed > 0) {
      setError(
        failed === 1
          ? "No se pudo leer un elemento seleccionado."
          : `No se pudieron leer ${failed} elementos seleccionados.`,
      );
    }
  }, [addFiles, reset, setError]);

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
      setProgress(event.payload as CompressionProgress);
    });

    const unlistenDone = listen("compress://done", (event) => {
      const p = event.payload as {
        original_bytes: number;
        compressed_bytes: number;
        output_path: string;
        elapsed_ms: number;
      };
      setResult({
        originalBytes: p.original_bytes,
        compressedBytes: p.compressed_bytes,
        outputPath: p.output_path,
        elapsedMs: p.elapsed_ms,
      });
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

    const dir = getParentDir(files[0].path);
    const separator = files[0].path.includes("/") ? "/" : "\\";
    const timestamp = Date.now();
    const ext = "7z";
    const output = `${dir}${separator}squish_${timestamp}.${ext}`;

    try {
      await invoke("compress_files", {
        inputPaths: files.map((f) => f.path),
        output,
      });
    } catch (e) {
      setError(String(e));
      setCompressing(false);
    }
  };

  const openOutputFolder = () => {
    if (!result) return;
    revealItemInDir(result.outputPath);
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
          <div className="shrink-0 bg-zinc-900/70 border border-zinc-800 rounded-lg p-3">
            <div className="flex items-center justify-between text-xs text-zinc-400 mb-2">
              <span className="truncate pr-4">{progress.fileName}</span>
              <span className="text-zinc-300 tabular-nums">
                {Math.round(progressPercent(progress))}%
              </span>
            </div>
            <div className="h-2.5 bg-zinc-950 rounded-full overflow-hidden ring-1 ring-zinc-800">
              <div
                className="h-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-emerald-400 rounded-full transition-[width] duration-500 ease-out"
                style={{
                  width: `${progressPercent(progress)}%`,
                }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-zinc-600 mt-2">
              <span>
                {formatBytes(progress.processedBytes)} / {formatBytes(progress.totalBytes)}
              </span>
              <span>
                {progress.current} / {progress.total}
              </span>
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
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500">Tiempo</span>
                  <span className="font-medium">{formatElapsed(result.elapsedMs)}</span>
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
          <button
            onClick={handleCompress}
            disabled={files.length === 0 || isCompressing}
            className="w-full bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white text-sm font-medium rounded-lg py-2 transition-colors"
          >
            {isCompressing ? "Comprimiendo..." : "Comprimir"}
          </button>
        </div>
      </div>
    </div>
  );
}

mod compression;

use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

#[derive(serde::Serialize)]
struct FileInfo {
    path: String,
    name: String,
    size: u64,
    is_dir: bool,
}

#[tauri::command]
fn get_file_info(path: String) -> Result<FileInfo, String> {
    let path_obj = std::path::Path::new(&path);
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    let name = path_obj
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let is_dir = meta.is_dir();
    let size = if is_dir {
        WalkDir::new(&path)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .filter_map(|e| e.metadata().ok())
            .map(|m| m.len())
            .sum()
    } else {
        meta.len()
    };
    Ok(FileInfo {
        path,
        name,
        size,
        is_dir,
    })
}

#[tauri::command]
async fn compress_files(
    app: AppHandle,
    input_paths: Vec<String>,
    format: String,
    level: String,
    output: String,
) -> Result<(), String> {
    let handle = app.clone();
    let output_clone = output.clone();
    let (original, compressed) = tokio::spawn(async move {
        compression::compress(handle, input_paths, format, level, output_clone).await
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    app.emit(
        "compress://done",
        serde_json::json!({
            "original_bytes": original,
            "compressed_bytes": compressed,
            "output_path": output,
        }),
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![get_file_info, compress_files])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

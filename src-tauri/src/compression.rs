use anyhow::{Context, Result};
use std::fs::File;

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

pub async fn compress(
    app: AppHandle,
    input_paths: Vec<String>,
    format: String,
    level: String,
    output: String,
) -> Result<(u64, u64)> {
    let original_bytes = calc_original_size(&input_paths)?;

    match format.as_str() {
        "7z" => compress_7z(&input_paths, &level, &output, &app).await?,
        "zip" => compress_zip(&input_paths, &level, &output, &app).await?,
        "zstd" => compress_zstd(&input_paths, &level, &output, &app).await?,
        _ => anyhow::bail!("unsupported format"),
    }

    let compressed_bytes = std::fs::metadata(&output).map(|m| m.len()).unwrap_or(0);
    Ok((original_bytes, compressed_bytes))
}

fn calc_original_size(paths: &[String]) -> Result<u64> {
    let mut total = 0u64;
    for p in paths {
        let path = Path::new(p);
        let meta = std::fs::metadata(path).with_context(|| format!("metadata {}", p))?;
        if meta.is_file() {
            total += meta.len();
        } else {
            for entry in WalkDir::new(path).into_iter().filter_map(|e| e.ok()) {
                if entry.file_type().is_file() {
                    total += entry.metadata()?.len();
                }
            }
        }
    }
    Ok(total)
}

fn emit_progress(app: &AppHandle, current: usize, total: usize) {
    let _ = app.emit(
        "compress://progress",
        serde_json::json!({ "current": current, "total": total }),
    );
}

async fn compress_7z(
    input_paths: &[String],
    _level: &str,
    output: &str,
    app: &AppHandle,
) -> Result<()> {
    let out_file = File::create(output)?;
    let mut writer = sevenz_rust::SevenZWriter::new(out_file)?;

    let entries = collect_entries(input_paths)?;
    let total = entries.len();

    for (idx, (path, name)) in entries.into_iter().enumerate() {
        let entry = sevenz_rust::SevenZArchiveEntry::from_path(&path, name);
        let reader = File::open(&path)?;
        writer.push_archive_entry(entry, Some(reader))?;
        emit_progress(app, idx + 1, total);
    }

    writer.finish()?;
    Ok(())
}

async fn compress_zip(
    input_paths: &[String],
    level: &str,
    output: &str,
    app: &AppHandle,
) -> Result<()> {
    let file = File::create(output)?;
    let mut zip = zip::ZipWriter::new(file);

    let deflate_level: i64 = match level {
        "fast" => 3,
        "normal" => 6,
        "max" => 9,
        _ => 6,
    };

    let entries = collect_entries(input_paths)?;
    let total = entries.len();

    for (idx, (path, name)) in entries.into_iter().enumerate() {
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .compression_level(Some(deflate_level));
        zip.start_file(name, options)?;
        let mut reader = File::open(&path)?;
        std::io::copy(&mut reader, &mut zip)?;
        emit_progress(app, idx + 1, total);
    }

    zip.finish()?;
    Ok(())
}

async fn compress_zstd(
    input_paths: &[String],
    level: &str,
    output: &str,
    app: &AppHandle,
) -> Result<()> {
    let file = File::create(output)?;
    let level_num = match level {
        "fast" => 3,
        "normal" => 9,
        "max" => 19,
        _ => 9,
    };
    let mut encoder = zstd::stream::write::Encoder::new(file, level_num)?;
    {
        let mut tar = tar::Builder::new(&mut encoder);
        let entries = collect_entries(input_paths)?;
        let total = entries.len();

        for (idx, (path, name)) in entries.into_iter().enumerate() {
            let mut file = File::open(&path)?;
            tar.append_file(&name, &mut file)?;
            emit_progress(app, idx + 1, total);
        }
    }
    encoder.finish()?;
    Ok(())
}

fn collect_entries(input_paths: &[String]) -> Result<Vec<(PathBuf, String)>> {
    let mut entries = Vec::new();
    for p in input_paths {
        let path = Path::new(p);
        if path.is_file() {
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            entries.push((path.to_path_buf(), name));
        } else if path.is_dir() {
            let base_name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            for entry in WalkDir::new(path).into_iter().filter_map(|e| e.ok()) {
                if entry.file_type().is_file() {
                    let rel = entry.path().strip_prefix(path)?;
                    let name = format!("{}/{}", base_name, rel.to_string_lossy());
                    entries.push((entry.path().to_path_buf(), name));
                }
            }
        }
    }
    Ok(entries)
}

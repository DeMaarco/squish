use anyhow::{Context, Result};
use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

type ArchiveEntry = (std::path::PathBuf, String, u64);

pub fn compress(
    app: AppHandle,
    input_paths: Vec<String>,
    output: String,
) -> Result<(u64, u64)> {
    if input_paths.is_empty() {
        anyhow::bail!("no input files selected");
    }

    let (entries, original_bytes) = collect_entries(&input_paths)?;

    if entries.is_empty() {
        anyhow::bail!("no files found to compress");
    }

    compress_7z(entries, &output, &app)?;

    let compressed_bytes = std::fs::metadata(&output)
        .with_context(|| format!("metadata {}", output))?
        .len();
    Ok((original_bytes, compressed_bytes))
}

#[derive(Clone, Copy)]
struct MachineProfile {
    threads: u32,
    chunk_size: u64,
    reader_buffer_bytes: usize,
    progress_interval_ms: u64,
}

fn detect_machine_profile() -> MachineProfile {
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .clamp(1, 32);

    let (threads, chunk_size, reader_buffer_bytes, progress_interval_ms) = if cores >= 16 {
        (12, 1024 * 1024, 2 * 1024 * 1024, 200)
    } else if cores >= 8 {
        (cores.saturating_sub(1), 768 * 1024, 1024 * 1024, 170)
    } else if cores >= 4 {
        (cores.saturating_sub(1), 512 * 1024, 512 * 1024, 140)
    } else {
        (1, 256 * 1024, 256 * 1024, 120)
    };

    MachineProfile {
        threads: threads as u32,
        chunk_size: chunk_size as u64,
        reader_buffer_bytes,
        progress_interval_ms,
    }
}

struct ProgressEmitter {
    last_percent: usize,
    last_emit_at: Instant,
    min_interval: Duration,
}

impl ProgressEmitter {
    fn new(min_interval_ms: u64) -> Self {
        Self {
            last_percent: 0,
            last_emit_at: Instant::now() - Duration::from_secs(1),
            min_interval: Duration::from_millis(min_interval_ms),
        }
    }

    fn maybe_emit(
        &mut self,
        app: &AppHandle,
        current: usize,
        total: usize,
        processed_bytes: u64,
        total_bytes: u64,
        file_name: &str,
    ) {
        if total == 0 || total_bytes == 0 {
            return;
        }

        let percent = ((processed_bytes.saturating_mul(100)) / total_bytes).min(100) as usize;
        let elapsed = self.last_emit_at.elapsed();
        let should_emit = current == 1
            || current == total
            || percent != self.last_percent
            || elapsed >= self.min_interval;

        if should_emit {
            let _ = app.emit(
                "compress://progress",
                serde_json::json!({
                    "current": current,
                    "total": total,
                    "processedBytes": processed_bytes,
                    "totalBytes": total_bytes,
                    "percent": percent,
                    "fileName": file_name,
                }),
            );
            self.last_percent = percent;
            self.last_emit_at = Instant::now();
        }
    }
}

fn compress_7z(
    mut entries: Vec<ArchiveEntry>,
    output: &str,
    app: &AppHandle,
) -> Result<()> {
    let profile = detect_machine_profile();
    let total_bytes = entries.iter().map(|(_, _, size)| *size).sum::<u64>();

    // For solid archives, grouping larger files first tends to improve throughput.
    entries.sort_by_key(|b| std::cmp::Reverse(b.2));

    let mut writer = sevenz_rust2::ArchiveWriter::create(output)
        .with_context(|| format!("create archive {}", output))?;
    writer.set_content_methods(vec![
        sevenz_rust2::encoder_options::Lzma2Options::from_level_mt(
            9,
            profile.threads,
            profile.chunk_size,
        )
        .into(),
    ]);

    let total = entries.len();
    let mut progress = ProgressEmitter::new(profile.progress_interval_ms);
    let mut processed_bytes = 0u64;

    for (idx, (path, name, size)) in entries.into_iter().enumerate() {
        let entry = sevenz_rust2::ArchiveEntry::from_path(&path, name.clone());
        let reader = BufReader::with_capacity(profile.reader_buffer_bytes, File::open(&path)?);
        writer.push_archive_entry(entry, Some(reader))?;
        processed_bytes = processed_bytes.saturating_add(size);
        progress.maybe_emit(app, idx + 1, total, processed_bytes, total_bytes, &name);
    }

    writer.finish()?;
    Ok(())
}


fn collect_entries(input_paths: &[String]) -> Result<(Vec<ArchiveEntry>, u64)> {
    let mut entries = Vec::new();
    let mut total_size = 0u64;
    for p in input_paths {
        let path = Path::new(p);
        if path.is_file() {
            let size = std::fs::metadata(path)
                .with_context(|| format!("metadata {}", p))?
                .len();
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            total_size += size;
            entries.push((path.to_path_buf(), name, size));
        } else if path.is_dir() {
            let base_name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            for entry in WalkDir::new(path).into_iter().filter_map(|e| e.ok()) {
                if entry.file_type().is_file() {
                    let meta = entry.metadata()?;
                    let size = meta.len();
                    let rel = entry.path().strip_prefix(path)?;
                    let name = format!("{}/{}", base_name, rel.to_string_lossy());
                    total_size += size;
                    entries.push((entry.path().to_path_buf(), name, size));
                }
            }
        }
    }
    Ok((entries, total_size))
}

#[cfg(test)]
mod tests {
    use super::collect_entries;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_path(name: &str) -> String {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after UNIX epoch")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("squish_test_{name}_{nanos}"))
            .to_string_lossy()
            .to_string()
    }

    #[test]
    fn collect_entries_keeps_file_name_for_single_files() {
        let dir = temp_path("single");
        fs::create_dir_all(&dir).expect("create temp dir");
        let file_path = std::path::Path::new(&dir).join("sample.txt");
        fs::write(&file_path, "hello").expect("write sample file");

        let (entries, total_size) = collect_entries(&[file_path.to_string_lossy().to_string()])
            .expect("collect single file");

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].1, "sample.txt");
        assert_eq!(entries[0].2, 5);
        assert_eq!(total_size, 5);

        fs::remove_dir_all(&dir).expect("remove temp dir");
    }

    #[test]
    fn collect_entries_preserves_directory_root() {
        let dir = temp_path("dir");
        let nested = std::path::Path::new(&dir).join("nested");
        fs::create_dir_all(&nested).expect("create nested dir");
        fs::write(nested.join("sample.txt"), "hello").expect("write nested file");

        let (entries, total_size) = collect_entries(&[dir.clone()]).expect("collect directory");

        assert_eq!(entries.len(), 1);
        assert!(
            entries[0].1.ends_with("/nested/sample.txt"),
            "unexpected archive path: {}",
            entries[0].1
        );
        assert_eq!(entries[0].2, 5);
        assert_eq!(total_size, 5);

        fs::remove_dir_all(&dir).expect("remove temp dir");
    }
}

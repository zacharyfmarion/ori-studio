//! Writing a file the user chose, so that another program holding it does not
//! fail the save for good.
//!
//! A save rewrites the file in place, as `fs::write` does. On Windows that
//! starts by truncating the file, and truncation is refused while any program
//! has it mapped into memory (`ERROR_USER_MAPPED_FILE`): an image viewer showing
//! a picture exported a minute ago, an indexer, a virus scanner. When the file is
//! in use, the new bytes go into a file beside it, which is renamed over it, so
//! the old file is never truncated and whoever holds it keeps the old contents.
//! A holder that lets go quickly is waited for; one that does not is reported
//! as [`FILE_IN_USE`], for the renderer to say so in plain words.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

/// What a save returns when the file stayed in use. The renderer matches on it
/// (`fileService.ts`), as it does on `FILE_TOO_LARGE`.
pub const FILE_IN_USE: &str = "FILE_IN_USE";

/// The waits between tries: under a second in all. Someone is waiting on the
/// save, and a program that keeps the file longer is theirs to close.
const RETRY_DELAYS: [Duration; 4] = [
    Duration::from_millis(50),
    Duration::from_millis(100),
    Duration::from_millis(200),
    Duration::from_millis(400),
];

/// What Windows answers when another program has the file: a sharing
/// violation, a locked range, and a mapped view.
const WINDOWS_IN_USE_CODES: [i32; 3] = [32, 33, 1224];

/// Why a save failed.
#[derive(Debug)]
pub enum WriteError {
    /// Another program kept the file through every try.
    InUse,
    Io(io::Error),
}

impl WriteError {
    /// As a command returns it: the code the renderer matches, or the system's message.
    pub fn into_command_error(self) -> String {
        match self {
            WriteError::InUse => FILE_IN_USE.to_string(),
            WriteError::Io(error) => error.to_string(),
        }
    }
}

/// Writes `bytes` to `path`, creating the file or replacing what it holds.
pub fn write_file(path: &Path, bytes: &[u8]) -> Result<(), WriteError> {
    write_with(&Disk, path, bytes)
}

/// The filesystem calls a save makes: the seam the tests stand a holding program behind.
trait SaveCalls {
    fn write_in_place(&self, path: &Path, bytes: &[u8]) -> io::Result<()>;
    fn write_by_replacing(&self, path: &Path, bytes: &[u8]) -> io::Result<()>;
    fn wait(&self, delay: Duration);
}

struct Disk;

impl SaveCalls for Disk {
    fn write_in_place(&self, path: &Path, bytes: &[u8]) -> io::Result<()> {
        fs::write(path, bytes)
    }

    fn write_by_replacing(&self, path: &Path, bytes: &[u8]) -> io::Result<()> {
        write_by_replacing(path, bytes)
    }

    fn wait(&self, delay: Duration) {
        std::thread::sleep(delay);
    }
}

/// In place first, so an ordinary save keeps the file it saves to (its
/// identity, its links, its access rules). Only a file in use is replaced.
fn write_with(calls: &impl SaveCalls, path: &Path, bytes: &[u8]) -> Result<(), WriteError> {
    let mut delays = RETRY_DELAYS.iter();
    loop {
        match calls.write_in_place(path, bytes) {
            Ok(()) => return Ok(()),
            Err(error) if !is_in_use(&error) => return Err(WriteError::Io(error)),
            Err(_) => {}
        }
        if calls.write_by_replacing(path, bytes).is_ok() {
            return Ok(());
        }
        let Some(&delay) = delays.next() else {
            return Err(WriteError::InUse);
        };
        calls.wait(delay);
    }
}

/// Whether `error` says another program has the file: something that passes
/// when it lets go, unlike a missing folder or a file nobody may write.
fn is_in_use(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::ResourceBusy | io::ErrorKind::ExecutableFileBusy
    ) || (cfg!(windows)
        && error
            .raw_os_error()
            .is_some_and(|code| WINDOWS_IN_USE_CODES.contains(&code)))
}

/// Puts `bytes` in a new file beside `path`, then renames that over `path`.
///
/// On Windows, Rust's rename falls back to POSIX semantics, which replaces a
/// file another program still has open when that program allows it.
fn write_by_replacing(path: &Path, bytes: &[u8]) -> io::Result<()> {
    // Through a symlink, as an in-place write goes: renaming over the link
    // would leave a plain file where the link was.
    let target = match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => fs::canonicalize(path)?,
        _ => path.to_path_buf(),
    };
    let original = fs::metadata(&target)?;
    let (temp, file) = create_sibling(&target)?;
    let replaced = fill(file, bytes)
        .and_then(|()| keep_mode(&temp, &original))
        .and_then(|()| fs::rename(&temp, &target));
    if replaced.is_err() {
        // A stray temporary file is not worth reporting over the failure itself.
        let _ = fs::remove_file(&temp);
    }
    replaced
}

/// Bytes, then flushed to disk, so the name never points at a file still being written.
fn fill(mut file: fs::File, bytes: &[u8]) -> io::Result<()> {
    file.write_all(bytes)?;
    file.sync_all()
}

static NEXT_SIBLING: AtomicU32 = AtomicU32::new(0);

/// A new, empty file in `target`'s folder, named after it so a leftover is recognisable.
fn create_sibling(target: &Path) -> io::Result<(PathBuf, fs::File)> {
    let folder = target.parent().unwrap_or(Path::new(""));
    let name: String = target
        .file_name()
        .map(|name| name.to_string_lossy().chars().take(64).collect())
        .unwrap_or_default();
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut last = io::Error::from(io::ErrorKind::AlreadyExists);
    for _ in 0..8 {
        let n = NEXT_SIBLING.fetch_add(1, Ordering::Relaxed);
        let temp = folder.join(format!(".{name}.{}-{n}.tmp", std::process::id()));
        match options.open(&temp) {
            Ok(file) => return Ok((temp, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => last = error,
            Err(error) => return Err(error),
        }
    }
    Err(last)
}

/// The replaced file's mode on the new one, so a private file stays private.
#[cfg(unix)]
fn keep_mode(temp: &Path, original: &fs::Metadata) -> io::Result<()> {
    fs::set_permissions(temp, original.permissions())
}

/// Nothing to keep on Windows: the new file takes its folder's access rules,
/// and the old one's attributes describe that file (a sync client's placeholder
/// state among them), not the bytes now under its name.
#[cfg(not(unix))]
fn keep_mode(_temp: &Path, _original: &fs::Metadata) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        FILE_IN_USE, RETRY_DELAYS, SaveCalls, WriteError, is_in_use, write_by_replacing,
        write_file, write_with,
    };
    use std::cell::RefCell;
    use std::io;
    use std::path::{Path, PathBuf};
    use std::time::Duration;

    /// A program holding the file: each in-place write takes the next answer,
    /// the last one repeating; each replace takes `replace`.
    struct Held {
        in_place: Vec<fn() -> io::Result<()>>,
        replace: fn() -> io::Result<()>,
        calls: RefCell<Vec<String>>,
    }

    impl Held {
        fn new(in_place: Vec<fn() -> io::Result<()>>, replace: fn() -> io::Result<()>) -> Self {
            Self {
                in_place,
                replace,
                calls: RefCell::new(Vec::new()),
            }
        }

        fn calls(&self) -> Vec<String> {
            self.calls.borrow().clone()
        }
    }

    impl SaveCalls for Held {
        fn write_in_place(&self, _path: &Path, _bytes: &[u8]) -> io::Result<()> {
            let tries = self
                .calls
                .borrow()
                .iter()
                .filter(|call| *call == "in place")
                .count();
            self.calls.borrow_mut().push("in place".into());
            let answer = self.in_place[tries.min(self.in_place.len() - 1)];
            answer()
        }

        fn write_by_replacing(&self, _path: &Path, _bytes: &[u8]) -> io::Result<()> {
            self.calls.borrow_mut().push("replace".into());
            (self.replace)()
        }

        fn wait(&self, delay: Duration) {
            self.calls
                .borrow_mut()
                .push(format!("wait {}ms", delay.as_millis()));
        }
    }

    fn busy() -> io::Result<()> {
        Err(io::Error::from(io::ErrorKind::ResourceBusy))
    }

    fn denied() -> io::Result<()> {
        Err(io::Error::from(io::ErrorKind::PermissionDenied))
    }

    fn written() -> io::Result<()> {
        Ok(())
    }

    fn scratch(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ori-write-{label}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("scratch dir");
        dir
    }

    fn entries(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .expect("list scratch dir")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();
        names
    }

    // ORI-STUDIO-1G: Windows refused to truncate a PNG exported minutes before,
    // because another program had it mapped, and the save failed outright.
    #[test]
    fn replaces_a_file_another_program_holds_instead_of_failing() {
        let held = Held::new(vec![busy], written);
        assert!(write_with(&held, Path::new("picture.png"), b"png").is_ok());
        assert_eq!(held.calls(), ["in place", "replace"]);
    }

    #[test]
    fn waits_for_a_holder_that_lets_go() {
        let held = Held::new(vec![busy, busy, written], busy);
        assert!(write_with(&held, Path::new("picture.png"), b"png").is_ok());
        assert_eq!(
            held.calls(),
            [
                "in place",
                "replace",
                "wait 50ms",
                "in place",
                "replace",
                "wait 100ms",
                "in place"
            ]
        );
    }

    #[test]
    fn gives_up_as_in_use_within_a_second_when_the_file_stays_held() {
        let held = Held::new(vec![busy], busy);
        let result = write_with(&held, Path::new("picture.png"), b"png");
        assert!(matches!(result, Err(WriteError::InUse)));
        let waited: Duration = RETRY_DELAYS.iter().sum();
        assert!(waited < Duration::from_secs(1));
        assert_eq!(
            held.calls()
                .iter()
                .filter(|call| *call == "in place")
                .count(),
            RETRY_DELAYS.len() + 1
        );
        assert_eq!(
            WriteError::InUse.into_command_error(),
            FILE_IN_USE,
            "the code the renderer matches"
        );
    }

    #[test]
    fn reports_any_other_failure_at_once_with_the_system_message() {
        let held = Held::new(vec![denied], written);
        let Err(WriteError::Io(error)) = write_with(&held, Path::new("picture.png"), b"png") else {
            panic!("a refused write is not an in-use file");
        };
        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
        assert_eq!(held.calls(), ["in place"]);
        assert_eq!(
            WriteError::Io(io::Error::from(io::ErrorKind::PermissionDenied)).into_command_error(),
            io::Error::from(io::ErrorKind::PermissionDenied).to_string()
        );
    }

    #[cfg(windows)]
    #[test]
    fn counts_the_windows_sharing_codes_as_in_use() {
        for code in [32, 33, 1224] {
            assert!(is_in_use(&io::Error::from_raw_os_error(code)), "{code}");
        }
        assert!(
            !is_in_use(&io::Error::from_raw_os_error(5)),
            "access denied"
        );
    }

    #[cfg(unix)]
    #[test]
    fn does_not_read_the_windows_codes_as_in_use_elsewhere() {
        // 32 is EPIPE on Unix, and 1224 is nothing at all.
        for code in [32, 33, 1224] {
            assert!(!is_in_use(&io::Error::from_raw_os_error(code)), "{code}");
        }
        assert!(is_in_use(&io::Error::from(io::ErrorKind::ResourceBusy)));
    }

    #[test]
    fn writes_a_new_file_and_overwrites_an_old_one() {
        let dir = scratch("plain");
        let path = dir.join("design.osf");
        write_file(&path, b"first").expect("create");
        write_file(&path, b"second, longer").expect("overwrite");
        assert_eq!(std::fs::read(&path).expect("read"), b"second, longer");
        assert_eq!(entries(&dir), ["design.osf"]);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn replacing_leaves_the_new_bytes_and_no_temporary_file() {
        let dir = scratch("replace");
        let path = dir.join("picture.png");
        std::fs::write(&path, b"an older, longer picture").expect("seed");
        write_by_replacing(&path, b"new").expect("replace");
        assert_eq!(std::fs::read(&path).expect("read"), b"new");
        assert_eq!(entries(&dir), ["picture.png"]);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn replacing_a_file_that_is_not_there_creates_nothing() {
        let dir = scratch("missing");
        assert!(write_by_replacing(&dir.join("gone.png"), b"new").is_err());
        assert!(entries(&dir).is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn replacing_keeps_the_mode_and_writes_through_a_symlink() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch("mode");
        let real = dir.join("real.osf");
        std::fs::write(&real, b"old").expect("seed");
        std::fs::set_permissions(&real, std::fs::Permissions::from_mode(0o640)).expect("chmod");
        let link = dir.join("link.osf");
        std::os::unix::fs::symlink(&real, &link).expect("symlink");

        write_by_replacing(&link, b"new").expect("replace");

        assert!(
            std::fs::symlink_metadata(&link)
                .expect("link")
                .file_type()
                .is_symlink()
        );
        assert_eq!(std::fs::read(&real).expect("read"), b"new");
        let mode = std::fs::metadata(&real).expect("meta").permissions().mode();
        assert_eq!(mode & 0o777, 0o640);
        assert_eq!(entries(&dir), ["link.osf", "real.osf"]);
        std::fs::remove_dir_all(&dir).ok();
    }

    /// The nearest a Unix system comes to the Windows refusal: Linux will not
    /// open a running program's executable for writing (`ETXTBSY`), and lets it
    /// be renamed over. macOS allows the write, so there the save is plain.
    #[cfg(unix)]
    #[test]
    fn saves_over_a_file_a_running_program_has_mapped() {
        let dir = scratch("busy");
        let path = dir.join("held");
        let running = std::fs::copy("/bin/sleep", &path)
            .ok()
            .and_then(|_| std::process::Command::new(&path).arg("30").spawn().ok());
        let Some(mut child) = running else {
            std::fs::remove_dir_all(&dir).ok();
            return;
        };
        // What the save did before: `fs::write`, whose open this is.
        let in_place = std::fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .map(drop);

        let saved = write_file(&path, b"new");

        child.kill().ok();
        child.wait().ok();
        let contents = std::fs::read(&path).expect("read");
        std::fs::remove_dir_all(&dir).ok();
        if let Err(error) = &in_place {
            assert!(is_in_use(error), "{error}");
        }
        assert!(saved.is_ok(), "{saved:?}");
        assert_eq!(contents, b"new");
    }
}

// adapters/driven/auth-session: keeps the signed-in session in a local file on Desktop JVM.
package dev.ignit.session

import dev.ignit.application.port.AuthSession
import dev.ignit.domain.model.UserSession
import java.io.IOException
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.attribute.PosixFilePermission
import java.nio.file.attribute.PosixFilePermissions

private val FILE_PERMISSIONS: Set<PosixFilePermission> = PosixFilePermissions.fromString("rw-------")
private val DIRECTORY_PERMISSIONS: Set<PosixFilePermission> = PosixFilePermissions.fromString("rwx------")

/**
 * Stores the session as JSON in `~/.config/ignit/session.json` (or [file] when supplied).
 *
 * Writes go through a temporary file in the same directory followed by an atomic move, so a
 * crash never leaves a half-written session behind, and both the directory and the file are
 * restricted to the owner (`rwx------` / `rw-------`) whenever the filesystem supports POSIX
 * permissions. Reads never throw: any unreadable or undecodable file reads as "not signed in".
 */
class FileAuthSession(private val file: Path = defaultSessionFile()) : AuthSession {

	override suspend fun load(): UserSession? {
		val target = file.toAbsolutePath()
		val raw = try {
			if (!Files.isRegularFile(target)) return null
			Files.readString(target)
		} catch (unreadable: IOException) {
			return null
		} catch (unreadable: SecurityException) {
			return null
		}
		return SessionCodec.decode(raw)
	}

	override suspend fun save(session: UserSession) {
		val target = file.toAbsolutePath()
		val directory = target.parent ?: Path.of(".")
		Files.createDirectories(directory)
		restrictPermissions(directory, DIRECTORY_PERMISSIONS)

		val temporary = Files.createTempFile(directory, "session", ".tmp")
		try {
			Files.writeString(temporary, SessionCodec.encode(session))
			restrictPermissions(temporary, FILE_PERMISSIONS)
			moveOver(temporary, target)
			restrictPermissions(target, FILE_PERMISSIONS)
		} catch (unwritable: IOException) {
			removeQuietly(temporary)
			throw unwritable
		}
	}

	override suspend fun clear() {
		Files.deleteIfExists(file.toAbsolutePath())
	}

	private fun moveOver(from: Path, to: Path) {
		try {
			Files.move(from, to, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
		} catch (unsupportedAtomic: AtomicMoveNotSupportedException) {
			Files.move(from, to, StandardCopyOption.REPLACE_EXISTING)
		}
	}

	private fun restrictPermissions(target: Path, permissions: Set<PosixFilePermission>) {
		try {
			Files.setPosixFilePermissions(target, permissions)
		} catch (unsupported: UnsupportedOperationException) {
			// Non-POSIX filesystems (Windows, FAT) have no UNIX permissions to tighten.
		}
	}

	private fun removeQuietly(path: Path) {
		try {
			Files.deleteIfExists(path)
		} catch (unremovable: IOException) {
			// Best effort: the session write failure is the error worth reporting.
		}
	}

	companion object {
		/** Default location on Desktop: `~/.config/ignit/session.json`. */
		fun defaultSessionFile(): Path =
			Path.of(System.getProperty("user.home"), ".config", "ignit", "session.json")
	}
}

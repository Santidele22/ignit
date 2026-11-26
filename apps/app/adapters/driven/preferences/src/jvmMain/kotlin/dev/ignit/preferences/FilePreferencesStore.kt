// adapters/driven/preferences: keeps non-secret user preferences in a local file on Desktop JVM.
package dev.ignit.preferences

import dev.ignit.application.port.Preferences
import java.io.IOException
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.attribute.PosixFilePermission
import java.nio.file.attribute.PosixFilePermissions
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

private val FILE_PERMISSIONS: Set<PosixFilePermission> = PosixFilePermissions.fromString("rw-------")
private val DIRECTORY_PERMISSIONS: Set<PosixFilePermission> = PosixFilePermissions.fromString("rwx------")

/**
 * Stores the user's non-secret choices as a flat JSON object of string to string in
 * `~/.config/ignit/preferences.json` (or [file] when supplied).
 *
 * Writes go through a temporary file in the same directory followed by an atomic move, so a crash
 * never leaves a half-written preference file behind, and both the directory and the file are
 * restricted to the owner (`rwx------` / `rw-------`) whenever the filesystem supports POSIX
 * permissions. Existing keys survive a write: only [key] is replaced. Reads never throw: a missing,
 * unreadable, or unparseable file reads as "nothing saved yet".
 */
class FilePreferencesStore(private val file: Path = defaultFile()) : Preferences {

	override suspend fun read(key: String): String? = decode(readOrNull(file.toAbsolutePath()))?.get(key)

	override suspend fun write(key: String, value: String) {
		val target = file.toAbsolutePath()
		val directory = target.parent ?: Path.of(".")
		Files.createDirectories(directory)
		restrictPermissions(directory, DIRECTORY_PERMISSIONS)

		val updated = decode(readOrNull(target)).orEmpty() + (key to value)
		val payload = buildJsonObject {
			updated.toSortedMap().forEach { (name, stored) -> put(name, JsonPrimitive(stored)) }
		}.toString()

		val temporary = Files.createTempFile(directory, "preferences", ".tmp")
		try {
			Files.writeString(temporary, payload)
			restrictPermissions(temporary, FILE_PERMISSIONS)
			moveOver(temporary, target)
			restrictPermissions(target, FILE_PERMISSIONS)
		} catch (unwritable: IOException) {
			removeQuietly(temporary)
			throw unwritable
		}
	}

	/** Reads [target] as text, or null when it is missing or we are not allowed to read it. */
	private fun readOrNull(target: Path): String? = try {
		if (!Files.isRegularFile(target)) null else Files.readString(target)
	} catch (unreadable: IOException) {
		null
	} catch (unreadable: SecurityException) {
		null
	}

	/** Parses the flat JSON object, or null when [raw] is absent or not a JSON object of strings. */
	private fun decode(raw: String?): Map<String, String>? {
		if (raw == null) return null
		return try {
			Json.parseToJsonElement(raw).jsonObject.mapValues { (_, stored) -> stored.jsonPrimitive.content }
		} catch (unparseable: IllegalArgumentException) {
			// Malformed JSON, or a top-level array/number: treat it as an empty preference file.
			null
		}
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
			// Best effort: the preference write failure is the error worth reporting.
		}
	}

	companion object {
		/** Default location on Desktop: `~/.config/ignit/preferences.json`. */
		fun defaultFile(): Path =
			Path.of(System.getProperty("user.home"), ".config", "ignit", "preferences.json")
	}
}

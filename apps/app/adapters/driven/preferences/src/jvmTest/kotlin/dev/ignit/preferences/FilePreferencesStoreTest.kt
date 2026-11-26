// adapters/driven/preferences: desktop file storage contract.
package dev.ignit.preferences

import java.nio.file.FileSystems
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.PosixFilePermission
import kotlin.io.path.createTempDirectory
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest

class FilePreferencesStoreTest {
	private lateinit var dir: Path
	private lateinit var file: Path

	@BeforeTest
	fun setUp() {
		dir = createTempDirectory("ignit-preferences-test")
		file = dir.resolve("preferences.json")
	}

	@AfterTest
	fun tearDown() {
		deleteRecursively(dir)
	}

	@Test
	fun writeThenReadRoundTrips() = runTest {
		val store = FilePreferencesStore(file)

		store.write("palette", "noche-azul")

		assertEquals("noche-azul", store.read("palette"))
	}

	@Test
	fun readWithoutFileReturnsNull() = runTest {
		assertNull(FilePreferencesStore(file).read("palette"))
	}

	@Test
	fun secondWriteOverwritesTheFirstAndKeepsExistingKeys() = runTest {
		val store = FilePreferencesStore(file)

		store.write("reader-font", "serif")
		store.write("palette", "original")
		store.write("palette", "noche-azul")

		assertEquals("noche-azul", store.read("palette"))
		assertEquals("serif", store.read("reader-font"))
	}

	@Test
	fun corruptedFileReturnsNullInsteadOfThrowing() = runTest {
		val store = FilePreferencesStore(file)

		store.write("palette", "noche-azul")
		Files.writeString(file, """

			this is not json {{
		""".trimIndent())

		assertNull(store.read("palette"))
	}

	@Test
	fun savedFileIsOwnerReadWriteOnly() = runTest {
		if (!isPosix()) return@runTest
		val store = FilePreferencesStore(dir.resolve("nested/preferences.json"))

		store.write("palette", "noche-azul")

		val saved = dir.resolve("nested/preferences.json")
		assertTrue(Files.exists(saved))
		assertEquals(
			setOf(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE),
			Files.getPosixFilePermissions(saved),
		)
		assertEquals("noche-azul", store.read("palette"))
	}

	private fun isPosix(): Boolean =
		FileSystems.getDefault().supportedFileAttributeViews().contains("posix")

	private fun deleteRecursively(root: Path) {
		if (!Files.exists(root)) return
		Files.walk(root).use { paths ->
			paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) }
		}
	}
}

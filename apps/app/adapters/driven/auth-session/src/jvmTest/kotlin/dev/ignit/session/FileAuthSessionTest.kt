// adapters/driven/auth-session: desktop file storage contract.
package dev.ignit.session

import dev.ignit.domain.model.UserSession
import java.nio.file.FileSystems
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.PosixFilePermission
import kotlin.io.path.createTempDirectory
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest

class FileAuthSessionTest {
	private lateinit var dir: Path
	private lateinit var file: Path

	private val session = UserSession(
		userId = "usr_123",
		email = "santi@ignit.ar",
		name = "Santi",
		token = "tok_abc",
	)

	@BeforeTest
	fun setUp() {
		dir = createTempDirectory("ignit-session-test")
		file = dir.resolve("session.json")
	}

	@AfterTest
	fun tearDown() {
		deleteRecursively(dir)
	}

	@Test
	fun saveThenLoadReturnsTheSession() = runTest {
		val store = FileAuthSession(file)

		store.save(session)

		assertEquals(session, store.load())
	}

	@Test
	fun loadWithoutFileReturnsNull() = runTest {
		assertNull(FileAuthSession(file).load())
	}

	@Test
	fun saveTwiceOverwritesThePreviousSession() = runTest {
		val store = FileAuthSession(file)
		val second = session.copy(userId = "usr_456", token = "tok_def")

		store.save(session)
		store.save(second)

		assertEquals(second, store.load())
	}

	@Test
	fun clearRemovesFileAndLoadReturnsNull() = runTest {
		val store = FileAuthSession(file)
		store.save(session)

		store.clear()

		assertFalse(Files.exists(file))
		assertNull(store.load())
	}

	@Test
	fun clearWithoutFileIsNotAnError() = runTest {
		FileAuthSession(file).clear()

		assertFalse(Files.exists(file))
	}

	@Test
	fun corruptedFileReturnsNullInsteadOfThrowing() = runTest {
		val store = FileAuthSession(file)

		store.save(session)
		Files.writeString(file, """{"userId":"usr_123",""")

		assertNull(store.load())
	}

	@Test
	fun savedFileIsOwnerReadWriteOnly() = runTest {
		if (!isPosix()) return@runTest
		val store = FileAuthSession(dir.resolve("nested/session.json"))

		store.save(session)

		val saved = dir.resolve("nested/session.json")
		assertTrue(Files.exists(saved))
		assertEquals(
			setOf(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE),
			Files.getPosixFilePermissions(saved),
		)
		assertEquals(
			setOf(
				PosixFilePermission.OWNER_READ,
				PosixFilePermission.OWNER_WRITE,
				PosixFilePermission.OWNER_EXECUTE,
			),
			Files.getPosixFilePermissions(saved.parent),
		)
		assertEquals(session, store.load())
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

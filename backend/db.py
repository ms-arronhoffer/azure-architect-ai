import aiosqlite

DB_PATH = "conversations.db"


async def init_db() -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id         TEXT    PRIMARY KEY,
                mode       TEXT    NOT NULL,
                title      TEXT    NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                messages   TEXT    NOT NULL
            )
        """)
        await db.commit()

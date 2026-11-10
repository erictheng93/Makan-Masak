import shutil
import sqlite3
import tempfile
import unittest
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

spec = spec_from_file_location("d1_snapshot", Path(__file__).with_name("d1_snapshot.py"))
archive = module_from_spec(spec)
spec.loader.exec_module(archive)
spec = spec_from_file_location("d1_import_sql", Path(__file__).with_name("d1_import_sql.py"))
d1_import = module_from_spec(spec)
spec.loader.exec_module(d1_import)


class ArchiveTest(unittest.TestCase):
    def test_restore(self):
        with sqlite3.connect(":memory:") as source, sqlite3.connect(":memory:") as restored:
            source.row_factory = sqlite3.Row
            source.executescript("""
                CREATE TABLE shop(id INTEGER PRIMARY KEY AUTOINCREMENT);
                CREATE TABLE dish_search_index(id INTEGER PRIMARY KEY, name TEXT,
                    shop_id INTEGER REFERENCES shop(id), payload BLOB);
                CREATE VIRTUAL TABLE dish_search_fts USING fts5(name,
                    content='dish_search_index',content_rowid='id');
                INSERT INTO shop VALUES (9223372036854775806);
            """)
            for i in range(205):
                source.execute("INSERT INTO dish_search_index VALUES (?,?,?,?)",
                               (i, "noodles", 9223372036854775806, b"\x00\xff"))
            seen = []
            archive.snapshot(lambda sql: seen.append(sql) or source.execute(sql).fetchall(), restored, page=100)
            self.assertGreater(sum("dish_search_index" in q and "WHERE _rowid_ >" in q for q in seen), 1)  # 205 rows at 100 a page need two continuations
            self.assertEqual(restored.execute("SELECT count(*) FROM dish_search_fts WHERE dish_search_fts MATCH 'noodles'").fetchone(), (205,))
            self.assertEqual(restored.execute("SELECT shop_id,payload FROM dish_search_index WHERE id=204").fetchone(), (9223372036854775806, b"\x00\xff"))
            self.assertEqual(restored.execute("PRAGMA foreign_key_check").fetchall(), [])

    @unittest.skipUnless(shutil.which("sqlite3"), "needs the sqlite3 CLI")
    def test_d1_import_sql(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "recovered.sqlite")
            with sqlite3.connect(path) as db:
                # item sorts before its parent, and the parent key is unique only via an index
                db.executescript("""
                    CREATE TABLE item(id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT REFERENCES shop(code));
                    CREATE TABLE shop(code TEXT);
                    CREATE UNIQUE INDEX shop_code ON shop(code);
                    CREATE TABLE dish_search_index(id INTEGER PRIMARY KEY, name TEXT);
                    CREATE VIRTUAL TABLE dish_search_fts USING fts5(name,
                        content='dish_search_index',content_rowid='id');
                    CREATE TRIGGER dish_ai AFTER INSERT ON dish_search_index BEGIN
                        INSERT INTO dish_search_fts(rowid,name) VALUES (new.id,new.name); END;
                    INSERT INTO shop VALUES ('it''s');
                    INSERT INTO item VALUES (7,'it''s');
                    INSERT INTO dish_search_index VALUES (3,'noodles');
                """)
            sql = d1_import.import_sql(path)
            self.assertNotIn("writable_schema", sql)
            self.assertNotIn("dish_search_fts_data", sql)
            with sqlite3.connect(":memory:") as d1:
                d1.isolation_level = None
                d1.execute("PRAGMA foreign_keys=ON")  # D1 always enforces them
                d1.executescript("BEGIN;" + sql + "COMMIT;")
                self.assertEqual(d1.execute("SELECT count(*) FROM dish_search_fts WHERE dish_search_fts MATCH 'noodles'").fetchone(), (1,))
                self.assertEqual(d1.execute("SELECT * FROM sqlite_sequence").fetchall(), [("item", 7)])
                self.assertEqual(d1.execute("SELECT * FROM item").fetchall(), [(7, "it's")])
                self.assertEqual(d1.execute("PRAGMA foreign_key_check").fetchall(), [])


if __name__ == "__main__":
    unittest.main()

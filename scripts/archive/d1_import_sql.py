"""Turn a recovered archive (d1_snapshot.py output) into SQL that D1 imports.

A plain `sqlite3 .dump` does not import: D1 enforces foreign keys, and refuses
writable_schema and writes to the fts5 shadow tables.
"""

import sqlite3
import subprocess
import sys


def import_sql(src):
    db = sqlite3.connect(src)
    kinds = {r[1]: r[2] for r in db.execute("PRAGMA table_list")}
    objs = db.execute("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY rowid").fetchall()

    def kept(table):
        return not table.startswith(("sqlite_", "_cf_")) and kinds.get(table) != "shadow"

    out = ["PRAGMA defer_foreign_keys=ON;"]
    out += [sql + ";" for kind, _, table, sql in objs if kind == "table" and kept(table)]
    # Before the data: a foreign key may point at a parent key that is unique
    # only through a separate CREATE UNIQUE INDEX.
    out += [sql + ";" for kind, _, table, sql in objs if kind == "index" and kept(table)]
    dump = subprocess.run(["sqlite3", src, ".dump --data-only --nosys --preserve-rowids"],
                          capture_output=True, text=True, check=True).stdout
    # The fts index is rebuilt at the end; D1 refuses writes to its shadow tables.
    fts = tuple(f"INSERT INTO {q}{name}{q}(" for name, kind in kinds.items() if kind in ("shadow", "virtual") for q in ("", "'", '"'))
    out += [line for line in dump.splitlines() if not line.startswith(fts)]
    if "sqlite_sequence" in kinds:
        out.append("DELETE FROM sqlite_sequence;")  # the inserts above already created rows
        out += [f"INSERT INTO sqlite_sequence(name,seq) VALUES({name},{seq});"
                for name, seq in db.execute("SELECT quote(name),seq FROM sqlite_sequence")]
    out += [sql + ";" for kind, _, table, sql in objs if kind not in ("table", "index") and kept(table)]
    out += [f'INSERT INTO "{name}"("{name}") VALUES(\'rebuild\');' for name, kind in kinds.items() if kind == "virtual"]
    return "\n".join(out) + "\n"


if __name__ == "__main__":
    with open(sys.argv[2], "x") as f:
        f.write(import_sql(sys.argv[1]))

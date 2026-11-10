"""Create a restorable SQLite copy of one production D1 on a private runner."""

import json
import os
import sqlite3
import sys
from pathlib import Path
from urllib.request import Request, urlopen


def ident(name):
    return '"' + name.replace('"', '""') + '"'


def snapshot(query, db, page=5000):  # big pages = fewer requests = shorter window for a write to invalidate the copy; capped by D1's 50 MB result limit (hex doubles values)
    schema = query("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY rowid")
    kinds = {r["name"]: r for r in query("PRAGMA table_list")}
    sequences = []
    deferred = []
    for obj in schema:
        name = obj["name"]
        if name.startswith(("sqlite_", "_cf_")):
            continue
        if obj["type"] != "table":
            deferred.append(obj)
            continue
        kind = kinds[name]["type"]
        if kind == "shadow":
            continue
        db.execute(obj["sql"])
        if kind == "virtual":
            if name != "dish_search_fts":
                raise ValueError("Unrecognized virtual table: " + name)
            continue
        if kinds[name]["wr"]:
            raise ValueError("Unsupported WITHOUT ROWID table: " + name)
        table = ident(name)
        cols = [r["name"] for r in query("PRAGMA table_xinfo(" + table + ")") if not r["hidden"]]
        if any(c.lower() == "_rowid_" for c in cols):
            raise ValueError("Shadowed rowid in " + name)
        if len(cols) > 99:  # D1 returns at most 100 result columns, and one is the rowid
            raise ValueError("Too many columns for one D1 query in " + name)
        # JSON numbers lose int64 precision. Transport SQLite values as typed
        # strings, including hex for binary and text containing NUL.
        fields = []
        for col in map(ident, cols):
            fields.append(f"CASE typeof({col}) WHEN 'null' THEN 'n' WHEN 'blob' THEN 'b'||hex({col}) WHEN 'text' THEN 't'||hex({col}) WHEN 'integer' THEN 'i'||{col} ELSE 'r'||printf('%!.17g',{col}) END")
        last = None
        while True:
            where = "" if last is None else f" WHERE _rowid_ > {last}"
            rows = query(f"SELECT CAST(_rowid_ AS TEXT) AS k," + ",".join(f"{f} AS c{i}" for i, f in enumerate(fields)) + f" FROM {table}{where} ORDER BY _rowid_ LIMIT {page}")
            if not rows:
                break
            for row in rows:
                last = int(row["k"])
                values = [decode(row[f"c{i}"]) for i in range(len(cols))]
                db.execute(f"INSERT INTO {table}(_rowid_," + ",".join(map(ident, cols)) + ") VALUES (" + ",".join("?" for _ in range(1 + len(cols))) + ")", [last, *values])
            if len(rows) < page:  # a short page is the last one; skip the empty probe
                break
    if "sqlite_sequence" in kinds:
        sequences = query("SELECT name,CAST(seq AS TEXT) AS seq FROM sqlite_sequence")
        db.execute("DELETE FROM sqlite_sequence")
        db.executemany("INSERT INTO sqlite_sequence VALUES (?,?)", [(r["name"], int(r["seq"])) for r in sequences])
    for obj in deferred:
        db.execute(obj["sql"])
    if "dish_search_fts" in kinds:
        db.execute("INSERT INTO dish_search_fts(dish_search_fts) VALUES ('rebuild')")
        db.execute("INSERT INTO dish_search_fts(dish_search_fts,rank) VALUES ('integrity-check',1)")
    if db.execute("PRAGMA foreign_key_check").fetchone() or db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
        raise ValueError("Archive integrity validation failed")


def decode(value):
    kind, data = value[0], value[1:]
    if kind == "n":
        return None
    if kind == "t":
        return bytes.fromhex(data).decode()
    if kind == "b":
        return bytes.fromhex(data)
    return {"i": int, "r": float}[kind](data)


def main(path, database_id):
    base = "https://api.cloudflare.com/client/v4/accounts/" + os.environ["CF_ACCOUNT"] + "/d1/database/" + database_id

    def request(endpoint, body=None):
        req = Request(base + endpoint, data=json.dumps(body).encode() if body else None,
                      headers={"Authorization": "Bearer " + os.environ["CF_TOKEN"], "Content-Type": "application/json"})
        with urlopen(req, timeout=60) as response:
            result = json.load(response)
        if not result["success"]:
            raise RuntimeError("D1 request failed")
        return result["result"]

    def query(sql):
        return request("/query", {"sql": sql})[0]["results"]

    path.touch(mode=0o600, exist_ok=False)
    try:
        bookmark = request("/time_travel/bookmark")["bookmark"]
        with sqlite3.connect(path) as db:
            snapshot(query, db)
            if request("/time_travel/bookmark")["bookmark"] != bookmark:
                raise RuntimeError("Database changed during archive")
    except BaseException:
        path.unlink(missing_ok=True)
        raise


if __name__ == "__main__":
    main(Path(sys.argv[1]), sys.argv[2])

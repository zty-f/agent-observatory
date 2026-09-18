#!/usr/bin/python3
"""Save and restore one Codex thread's SQLite state alongside its trashed JSONL."""

import os
import sqlite3
import sys
from pathlib import Path


TABLES = {
    "state_5.sqlite": {
        "threads": "id = ?",
        "thread_artifacts": "thread_id = ?",
        "thread_dynamic_tools": "thread_id = ?",
        "thread_spawn_edges": "parent_thread_id = ? OR child_thread_id = ?",
    },
    "thread_history_1.sqlite": {
        "thread_turns": "thread_id = ?",
        "thread_items": "thread_id = ?",
        "thread_history_projection_state": "thread_id = ?",
        "thread_realtime_items": "thread_id = ?",
    },
    "goals_1.sqlite": {
        "thread_goals": "thread_id = ?",
        "thread_goal_continuation_deferrals": "thread_id = ?",
    },
    "memories_1.sqlite": {"stage1_outputs": "thread_id = ?"},
    "sqlite/codex-dev.db": {
        "local_thread_catalog": "host_id = 'local' AND thread_id = ?",
    },
}


def quoted(name):
    return '"' + name.replace('"', '""') + '"'


def params(where, thread_id):
    return (thread_id,) * where.count("?")


def snapshot_table_name(database, table):
    stem = database.replace("/", "__").split(".")[0]
    if stem.lower().startswith("sqlite"):
        stem = "db__" + stem
    return stem + "__" + table


def snapshot(root, thread_id, output, original_path=None, originally_archived=None):
    if output.exists():
        raise RuntimeError("快照文件已存在，未覆盖")
    temporary = Path(str(output) + ".tmp")
    if temporary.exists():
        temporary.unlink()
    output.parent.mkdir(parents=True, exist_ok=True)
    saved = sqlite3.connect(temporary)
    try:
        saved.execute("CREATE TABLE snapshot_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        saved.execute("INSERT INTO snapshot_meta VALUES ('thread_id', ?)", (thread_id,))
        for database, tables in TABLES.items():
            path = root / database
            if not path.exists():
                continue
            source = sqlite3.connect(path, timeout=30)
            try:
                for table, where in tables.items():
                    exists = source.execute(
                        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
                    ).fetchone()
                    if not exists:
                        continue
                    columns = [row[1] for row in source.execute(f"PRAGMA table_info({quoted(table)})")]
                    snapshot_table = snapshot_table_name(database, table)
                    definitions = ", ".join(quoted(column) for column in columns)
                    saved.execute(f"CREATE TABLE {quoted(snapshot_table)} ({definitions})")
                    rows = source.execute(
                        f"SELECT * FROM {quoted(table)} WHERE {where}", params(where, thread_id)
                    )
                    saved.executemany(
                        f"INSERT INTO {quoted(snapshot_table)} VALUES ({','.join('?' for _ in columns)})",
                        rows,
                    )
            finally:
                source.close()
        table = "state_5__threads"
        if original_path is not None and saved.execute(
            "SELECT 1 FROM sqlite_master WHERE name=?", (table,)
        ).fetchone():
            saved.execute(
                f"UPDATE {quoted(table)} SET rollout_path=?, archived=?, archived_at=? WHERE id=?",
                (original_path, int(originally_archived), None, thread_id),
            )
        if not saved.execute(f"SELECT 1 FROM {quoted(table)} WHERE id=?", (thread_id,)).fetchone():
            raise RuntimeError("Codex 索引中没有该会话，无法保存可恢复的状态")
        saved.commit()
        if saved.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("会话状态快照校验失败")
    except Exception:
        saved.close()
        temporary.unlink(missing_ok=True)
        raise
    saved.close()
    os.replace(temporary, output)


def restore(root, thread_id, input_path):
    saved = sqlite3.connect(input_path.as_uri() + "?mode=ro", uri=True)
    saved.row_factory = sqlite3.Row
    try:
        meta = saved.execute("SELECT value FROM snapshot_meta WHERE key='thread_id'").fetchone()
        if not meta or meta[0] != thread_id:
            raise RuntimeError("快照与会话 ID 不匹配")
        for database, tables in TABLES.items():
            path = root / database
            if not path.exists():
                continue
            destination = sqlite3.connect(path, timeout=30)
            try:
                for table in tables:
                    snapshot_table = snapshot_table_name(database, table)
                    exists = saved.execute(
                        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (snapshot_table,)
                    ).fetchone()
                    if not exists:
                        continue
                    current_columns = {
                        row[1] for row in destination.execute(f"PRAGMA table_info({quoted(table)})")
                    }
                    columns = [
                        row[1] for row in saved.execute(f"PRAGMA table_info({quoted(snapshot_table)})")
                        if row[1] in current_columns
                    ]
                    if not columns:
                        continue
                    rows = saved.execute(f"SELECT * FROM {quoted(snapshot_table)}").fetchall()
                    if table == "threads" and rows:
                        row = rows[0]
                        if destination.execute("SELECT 1 FROM threads WHERE id=?", (thread_id,)).fetchone():
                            updates = [column for column in columns if column != "id"]
                            destination.execute(
                                f"UPDATE threads SET {', '.join(quoted(column) + '=?' for column in updates)} WHERE id=?",
                                [row[column] for column in updates] + [thread_id],
                            )
                            continue
                    destination.executemany(
                        f"INSERT OR REPLACE INTO {quoted(table)} ({', '.join(map(quoted, columns))}) "
                        f"VALUES ({', '.join('?' for _ in columns)})",
                        [[row[column] for column in columns] for row in rows],
                    )
                destination.commit()
            finally:
                destination.close()
    finally:
        saved.close()


def remove_catalog(root, thread_id):
    path = root / "sqlite/codex-dev.db"
    if not path.exists():
        return
    connection = sqlite3.connect(path, timeout=30)
    try:
        if connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='local_thread_catalog'"
        ).fetchone():
            connection.execute(
                "DELETE FROM local_thread_catalog WHERE host_id='local' AND thread_id=?",
                (thread_id,),
            )
            connection.commit()
    finally:
        connection.close()


if __name__ == "__main__":
    try:
        operation, home, thread_id, snapshot_path, *extra = sys.argv[1:]
        root = Path(home)
        if operation == "snapshot":
            snapshot(root, thread_id, Path(snapshot_path), *(extra or [None, None]))
        elif operation == "restore":
            restore(root, thread_id, Path(snapshot_path))
        elif operation == "remove-catalog":
            remove_catalog(root, thread_id)
        else:
            raise RuntimeError("未知操作")
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)

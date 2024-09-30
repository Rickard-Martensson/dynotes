# app.py
from flask import Flask, render_template, request, jsonify
import sqlite3
from datetime import datetime
import os
import logging
from werkzeug.security import check_password_hash, generate_password_hash

app = Flask(__name__)
logging.basicConfig(level=logging.DEBUG)

DATABASE = "notes.db"
PASSWORD_HASH = generate_password_hash("1234")  # Initial password


@app.route("/tags", methods=["GET"])
def get_tags():
    db = get_db()
    cursor = db.execute("SELECT tag_id, name, readable_id FROM Tags")
    tags = [dict(row) for row in cursor.fetchall()]
    return jsonify(tags)


@app.route("/tag_relationships", methods=["GET"])
def get_tag_relationships():
    db = get_db()
    cursor = db.execute("SELECT parent_tag_id, child_tag_id FROM TagRelationships")
    relationships = [dict(row) for row in cursor.fetchall()]
    return jsonify(relationships)


@app.route("/rename_tag", methods=["POST"])
def rename_tag():
    db = get_db()
    data = request.json
    cursor = db.cursor()

    try:
        cursor.execute("UPDATE Tags SET name = ? WHERE tag_id = ?", (data["new_name"], data["tag_id"]))
        db.commit()
        return jsonify({"success": True})
    except Exception as e:
        db.rollback()
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/remove_tag_relationship", methods=["POST"])
def remove_tag_relationship():
    db = get_db()
    data = request.json
    cursor = db.cursor()

    try:
        cursor.execute("DELETE FROM TagRelationships WHERE parent_tag_id = ? AND child_tag_id = ?", (data["parent_id"], data["child_id"]))
        db.commit()
        return jsonify({"success": True})
    except Exception as e:
        db.rollback()
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/add_tag", methods=["POST"])
def add_tag():
    db = get_db()
    data = request.json
    cursor = db.cursor()

    try:
        cursor.execute("INSERT INTO Tags (name, readable_id) VALUES (?, ?)", (data["name"], data["readable_id"]))
        tag_id = cursor.lastrowid

        db.commit()
        return jsonify({"success": True, "tag_id": tag_id})
    except Exception as e:
        db.rollback()
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/update_tag_relationships", methods=["POST"])
def update_tag_relationships():
    db = get_db()
    data = request.json
    cursor = db.cursor()

    try:
        # Add new relationship
        cursor.execute("INSERT INTO TagRelationships (parent_tag_id, child_tag_id) VALUES (?, ?)", (data["parent_id"], data["child_id"]))

        db.commit()
        return jsonify({"success": True})
    except Exception as e:
        db.rollback()
        return jsonify({"success": False, "error": str(e)}), 500


def get_db():
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    return db


def init_db():
    if not os.path.exists(DATABASE):
        with app.app_context():
            db = get_db()
            with app.open_resource("schema.sql", mode="r") as f:
                db.cursor().executescript(f.read())
            db.commit()
        app.logger.info("Database initialized.")
    else:
        app.logger.info("Database already exists, skipping initialization.")


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/edit_note", methods=["POST"])
def edit_note():
    db = get_db()
    data = request.json
    cursor = db.cursor()

    try:
        cursor.execute(
            """
        UPDATE Notes
        SET text = ?, author = ?, rating = ?, source = ?, visibility = ?
        WHERE note_id = ?
        """,
            (
                data["text"],
                data["author"],
                data["rating"],
                data["source"],
                data["visibility"],
                data["noteId"],
            ),
        )

        # You'll need to implement tag editing here if you want to allow that

        db.commit()
        return jsonify({"success": True})
    except Exception as e:
        db.rollback()
        app.logger.error(f"Error editing note: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/delete_note", methods=["POST"])
def delete_note():
    db = get_db()
    data = request.json
    cursor = db.cursor()

    try:
        # Delete the note
        cursor.execute("DELETE FROM Notes WHERE note_id = ?", (data["noteId"],))

        # Delete associated tag relationships
        cursor.execute("DELETE FROM NoteTags WHERE note_id = ?", (data["noteId"],))

        db.commit()
        return jsonify({"success": True})
    except Exception as e:
        db.rollback()
        app.logger.error(f"Error deleting note: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/search", methods=["POST"])
def search():
    db = get_db()
    data = request.json
    app.logger.debug(f"Search request data: {data}")
    selected_tags = data.get("tags", [])
    search_text = data.get("text", "")
    password = data.get("password", "")

    visibility_level = 5 if check_password_hash(PASSWORD_HASH, password) else 1

    query = """
    WITH RECURSIVE
    tag_hierarchy(root_id, descendant_id) AS (
        SELECT tag_id, tag_id FROM Tags WHERE tag_id IN ({})
        UNION
        SELECT th.root_id, tr.child_tag_id
        FROM tag_hierarchy th
        JOIN TagRelationships tr ON th.descendant_id = tr.parent_tag_id
    ),
    matching_notes AS (
        SELECT n.note_id
        FROM Notes n
        JOIN NoteTags nt ON n.note_id = nt.note_id
        JOIN tag_hierarchy th ON nt.tag_id = th.descendant_id
        GROUP BY n.note_id
        HAVING COUNT(DISTINCT th.root_id) = ?
    )
    SELECT n.note_id, n.text, n.author, n.date, n.rating, n.source, n.visibility,
           GROUP_CONCAT(DISTINCT t.name) as tags
    FROM Notes n
    JOIN matching_notes mn ON n.note_id = mn.note_id
    JOIN NoteTags nt ON n.note_id = nt.note_id
    JOIN Tags t ON nt.tag_id = t.tag_id
    WHERE n.visibility <= ?
    """

    params = []
    if selected_tags:
        tag_placeholders = ",".join("?" for _ in selected_tags)
        params.extend(selected_tags)
    else:
        tag_placeholders = "SELECT tag_id FROM Tags"

    query = query.format(tag_placeholders)
    params.extend([len(selected_tags), visibility_level])

    if search_text:
        query += " AND n.text LIKE ?"
        params.append(f"%{search_text}%")

    query += " GROUP BY n.note_id"

    app.logger.debug(f"Search query: {query}")
    app.logger.debug(f"Search params: {params}")

    cursor = db.execute(query, params)
    results = cursor.fetchall()

    filtered_results = [dict(row) for row in results if row["visibility"] <= visibility_level]

    app.logger.debug(f"Filtered search results: {filtered_results}")

    return jsonify(filtered_results)


@app.route("/add_note", methods=["POST"])
def add_note():
    db = get_db()
    data = request.json
    cursor = db.cursor()

    try:
        cursor.execute(
            """
        INSERT INTO Notes (author, date, rating, source, visibility, text)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
            (
                data["author"],
                int(datetime.now().timestamp()),
                data["rating"],
                data["source"],
                data["visibility"],  # Add this line to include visibility
                data["text"],
            ),
        )

        note_id = cursor.lastrowid

        for tag_id in data["tags"]:
            cursor.execute("INSERT INTO NoteTags (note_id, tag_id) VALUES (?, ?)", (note_id, tag_id))

        db.commit()
        return jsonify({"success": True, "note_id": note_id})
    except Exception as e:
        db.rollback()
        app.logger.error(f"Error adding note: {str(e)}")  # Add this line for debugging
        return jsonify({"success": False, "error": str(e)}), 500


# ... (rest of the code remains the same)


if __name__ == "__main__":
    init_db()
    app.run(debug=True)

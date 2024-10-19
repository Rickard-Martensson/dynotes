# app.py
import time
from flask import Flask, render_template, request, jsonify, g
import sqlite3
from datetime import datetime
import os
import logging
from werkzeug.security import check_password_hash, generate_password_hash

from functools import lru_cache

app = Flask(__name__)
logging.basicConfig(level=logging.DEBUG)

DATABASE = "notes.db"
PASSWORD_HASH = generate_password_hash("1234")  # Initial password


PASSWORD_HASHES = {
    "vis_1": generate_password_hash("pw1"),
    "vis_2": generate_password_hash("pw2"),
    "vis_3": generate_password_hash("pw3"),
    "vis_4": generate_password_hash("pw4"),
    "vis_5": generate_password_hash("pw5"),
}

import secrets
import string


@app.route("/generate_tag_password", methods=["POST"])
def generate_tag_password_route():
    data = request.json
    tag_id = data.get("tag_id")
    max_visibility = data.get("max_visibility", 3)
    admin_password = data.get("admin_password", "")

    if not tag_id:
        return jsonify({"success": False, "error": "Tag ID is required"}), 400

    if not check_password_hash(PASSWORD_HASHES["vis_5"], admin_password):
        return jsonify({"success": False, "error": "Invalid administrator password"}), 403

    if max_visibility < 1 or max_visibility > 5:
        return jsonify({"success": False, "error": "Invalid visibility level. Please enter a number between 1 and 5."}), 400

    password = generate_tag_password(tag_id, max_visibility)
    if password:
        return jsonify({"success": True, "password": password})
    else:
        return jsonify({"success": False, "error": "Failed to generate password"}), 500


def generate_tag_password(tag_id, max_visibility=3):
    # Generate a random password
    password = "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(12))

    # Store the password hash and associated tag_id and max_visibility
    db = get_db()
    cursor = db.cursor()

    try:
        cursor.execute(
            """
            INSERT INTO TagPasswords (tag_id, password_hash, max_visibility)
            VALUES (?, ?, ?)
        """,
            (tag_id, generate_password_hash(password), max_visibility),
        )
        db.commit()
        return password
    except Exception as e:
        db.rollback()
        app.logger.error(f"Error generating tag password: {str(e)}")
        return None


@app.route("/export_tags_and_relationships", methods=["GET"])
def export_tags_and_relationships():
    db = get_db()

    # Get all tags
    cursor = db.execute("SELECT tag_id, name, readable_id FROM Tags")
    tags = {row["tag_id"]: dict(row) for row in cursor.fetchall()}

    # Get all relationships
    cursor = db.execute("SELECT parent_tag_id, child_tag_id FROM TagRelationships")
    relationships = cursor.fetchall()

    # Build the hierarchy
    for parent_id, child_id in relationships:
        if "children" not in tags[parent_id]:
            tags[parent_id]["children"] = []
        tags[parent_id]["children"].append(tags[child_id])

    # Filter out child tags from the top level
    root_tags = {id: tag for id, tag in tags.items() if not any(id == rel[1] for rel in relationships)}

    return jsonify(list(root_tags.values()))


def get_visibility_level(password, tag_id=None):
    # Check global passwords first
    for level in range(5, 0, -1):
        if check_password_hash(PASSWORD_HASHES[f"vis_{level}"], password):
            return level

    # Check tag-specific password if tag_id is provided
    if tag_id:
        try:
            db = get_db()
            cursor = db.cursor()
            cursor.execute(
                """
                SELECT max_visibility FROM TagPasswords
                WHERE tag_id = ? AND password_hash = ?
            """,
                (tag_id, generate_password_hash(password)),
            )
            result = cursor.fetchone()
            if result:
                return result["max_visibility"]
        except sqlite3.OperationalError as e:
            if "no such table: TagPasswords" in str(e):
                # TagPasswords table doesn't exist, log the error and continue
                app.logger.warning("TagPasswords table does not exist yet.")
            else:
                # Some other SQLite error occurred, re-raise it
                raise

    return 1  # Default visibility level


@app.route("/get_stats", methods=["GET"])
def get_stats():
    db = get_db()
    cursor = db.cursor()

    # Get total number of notes
    cursor.execute("SELECT COUNT(*) FROM Notes")
    note_count = cursor.fetchone()[0]

    # Get total number of tags
    cursor.execute("SELECT COUNT(*) FROM Tags")
    tag_count = cursor.fetchone()[0]

    # Get number of tag relationships
    cursor.execute("SELECT COUNT(*) FROM TagRelationships")
    relationship_count = cursor.fetchone()[0]

    # Get average note rating
    cursor.execute("SELECT AVG(rating) FROM Notes")
    avg_rating = cursor.fetchone()[0]

    # Get number of notes for each visibility level
    cursor.execute("SELECT visibility, COUNT(*) FROM Notes GROUP BY visibility ORDER BY visibility")
    visibility_counts = dict(cursor.fetchall())

    cursor.execute("SELECT COUNT(*) FROM Notes WHERE date >= ?", (int(time.time()) - 7 * 24 * 60 * 60,))
    recent_notes = cursor.fetchone()[0]

    cursor.execute(
        """
        SELECT Tags.name, COUNT(*) as usage_count
        FROM NoteTags
        JOIN Tags ON NoteTags.tag_id = Tags.tag_id
        GROUP BY NoteTags.tag_id
        ORDER BY usage_count DESC
        LIMIT 5
    """
    )
    top_tags = [{"name": row[0], "count": row[1]} for row in cursor.fetchall()]
    # Get top 5 tags by usage

    return jsonify(
        {
            "note_count": note_count,
            "tag_count": tag_count,
            "relationship_count": relationship_count,
            "avg_rating": round(avg_rating, 2) if avg_rating else 0,
            "visibility_counts": visibility_counts,
            "top_tags": top_tags,
            "recent_notes": recent_notes,
        }
    )


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


@app.route("/delete_tag", methods=["POST"])
def delete_tag():
    db = get_db()
    data = request.json
    cursor = db.cursor()

    try:
        # Begin a transaction
        cursor.execute("BEGIN")

        # Delete the tag
        cursor.execute("DELETE FROM Tags WHERE tag_id = ?", (data["tag_id"],))

        # Delete relationships where this tag is a parent or child
        cursor.execute("DELETE FROM TagRelationships WHERE parent_tag_id = ? OR child_tag_id = ?", (data["tag_id"], data["tag_id"]))

        # Delete note-tag associations
        cursor.execute("DELETE FROM NoteTags WHERE tag_id = ?", (data["tag_id"],))

        # Commit the transaction
        db.commit()
        return jsonify({"success": True})
    except Exception as e:
        db.rollback()
        app.logger.error(f"Error deleting tag: {str(e)}")
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
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(error):
    if hasattr(g, "db"):
        g.db.close()


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
        cursor.execute("BEGIN")

        # Fetch the current note data
        cursor.execute("SELECT * FROM Notes WHERE note_id = ?", (data["noteId"],))
        current_note = cursor.fetchone()

        if not current_note:
            raise Exception("Note not found")

        # Prepare the update fields
        update_fields = []
        update_values = []
        for field in ["text", "author", "rating", "source", "visibility"]:
            if field in data:
                update_fields.append(f"{field} = ?")
                update_values.append(data[field])

        # Only proceed with update if there are fields to update
        if update_fields:
            # Construct and execute the update query
            update_query = f"""
            UPDATE Notes
            SET {', '.join(update_fields)}
            WHERE note_id = ?
            """
            update_values.append(data["noteId"])
            cursor.execute(update_query, update_values)

        # Update tags only if they're provided
        if "tags" in data:
            # Delete existing tag associations
            cursor.execute("DELETE FROM NoteTags WHERE note_id = ?", (data["noteId"],))

            # Add new tag associations
            for tag_id in data["tags"]:
                cursor.execute("INSERT INTO NoteTags (note_id, tag_id) VALUES (?, ?)", (data["noteId"], tag_id))

        db.commit()
        return jsonify({"success": True})
    except Exception as e:
        db.rollback()
        app.logger.error(f"Error editing note: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/get_mmr_notes", methods=["POST"])
def get_mmr_notes():
    db = get_db()
    data = request.json
    selected_tags = data.get("tags", [])
    password = data.get("password", "")

    # visibility_level = 5 if check_password_hash(PASSWORD_HASH, password) else 1
    visibility_level = get_visibility_level(password)
    # New base query that doesn't rely on tag selection
    base_query = """
    SELECT n.note_id, n.text, n.author, n.date, n.rating, n.source, n.visibility, n.mmr, n.mmr_matches,
           GROUP_CONCAT(DISTINCT t.name) as tags
    FROM Notes n
    LEFT JOIN NoteTags nt ON n.note_id = nt.note_id
    LEFT JOIN Tags t ON nt.tag_id = t.tag_id
    WHERE n.visibility <= ?
    """

    params = [visibility_level]

    # If tags are selected, add tag filtering
    if selected_tags:
        tag_query = """
        WITH RECURSIVE
        tag_hierarchy(root_id, descendant_id) AS (
            SELECT tag_id, tag_id FROM Tags WHERE tag_id IN ({})
            UNION
            SELECT th.root_id, tr.child_tag_id
            FROM tag_hierarchy th
            JOIN TagRelationships tr ON th.descendant_id = tr.parent_tag_id
        )
        SELECT n.note_id
        FROM Notes n
        JOIN NoteTags nt ON n.note_id = nt.note_id
        JOIN tag_hierarchy th ON nt.tag_id = th.descendant_id
        GROUP BY n.note_id
        HAVING COUNT(DISTINCT th.root_id) = ?
        """
        tag_placeholders = ",".join("?" for _ in selected_tags)
        tag_query = tag_query.format(tag_placeholders)
        base_query = f"{base_query} AND n.note_id IN ({tag_query})"
        params.extend(selected_tags)
        params.append(len(selected_tags))

    # Finalize the query
    query = f"""
    {base_query}
    GROUP BY n.note_id
    ORDER BY RANDOM()
    LIMIT 2
    """

    cursor = db.execute(query, params)
    results = cursor.fetchall()

    return jsonify([dict(row) for row in results])


@app.route("/update_mmr", methods=["POST"])
def update_mmr():
    db = get_db()
    data = request.json
    winner_id = data.get("winner_id")
    loser_id = data.get("loser_id")

    try:
        cursor = db.cursor()

        # Get current MMR values and match counts
        cursor.execute("SELECT note_id, mmr, mmr_matches FROM Notes WHERE note_id IN (?, ?)", (winner_id, loser_id))
        note_data = {row["note_id"]: row for row in cursor.fetchall()}

        winner_data = note_data[winner_id]
        loser_data = note_data[loser_id]

        # Calculate K-factor (higher for notes with fewer matches)
        def calculate_k_factor(matches):
            if matches < 10:
                return 32
            elif matches < 20:
                return 24
            else:
                return 16

        winner_k = calculate_k_factor(winner_data["mmr_matches"])
        loser_k = calculate_k_factor(loser_data["mmr_matches"])

        # Calculate expected scores
        expected_winner = 1 / (1 + 10 ** ((loser_data["mmr"] - winner_data["mmr"]) / 400))
        expected_loser = 1 - expected_winner

        # Calculate MMR changes
        winner_change = int(winner_k * (1 - expected_winner))
        loser_change = int(loser_k * (0 - expected_loser))

        # Ensure minimum change of 1
        winner_change = max(1, winner_change)
        loser_change = min(-1, loser_change)

        # Update MMR values
        cursor.execute("UPDATE Notes SET mmr = mmr + ?, mmr_matches = mmr_matches + 1 WHERE note_id = ?", (winner_change, winner_id))
        cursor.execute("UPDATE Notes SET mmr = mmr + ?, mmr_matches = mmr_matches + 1 WHERE note_id = ?", (loser_change, loser_id))

        db.commit()
        return jsonify({"success": True, "winner_change": winner_change, "loser_change": loser_change, "winner_id": winner_id, "loser_id": loser_id})
    except Exception as e:
        db.rollback()
        app.logger.error(f"Error in update_mmr: {str(e)}")
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


# Optimized search function
@app.route("/search", methods=["POST"])
def search():
    try:
        db = get_db()
        data = request.json

        selected_tags = data.get("tags", [])
        search_text = data.get("text", "")
        password = data.get("password", "")
        sort_criteria = data.get("sortCriteria", "stars-desc")

        visibility_level = (
            max([get_visibility_level(password, tag_id) for tag_id in selected_tags]) if selected_tags else get_visibility_level(password)
        )

        query = """
        WITH RECURSIVE
        tag_hierarchy(root_id, descendant_id) AS (
            SELECT tag_id, tag_id FROM Tags WHERE tag_id IN ({})
            UNION ALL
            SELECT th.root_id, tr.child_tag_id
            FROM tag_hierarchy th
            JOIN TagRelationships tr ON th.descendant_id = tr.parent_tag_id
        )
        SELECT n.note_id, n.text, n.author, n.date, n.rating, n.source, n.visibility, n.mmr, n.mmr_matches,
            GROUP_CONCAT(DISTINCT t.name) as tags
        FROM Notes n
        JOIN NoteTags nt ON n.note_id = nt.note_id
        JOIN Tags t ON nt.tag_id = t.tag_id
        WHERE n.visibility <= ?
        AND (? = 0 OR n.note_id IN (
            SELECT n.note_id
            FROM Notes n
            JOIN NoteTags nt ON n.note_id = nt.note_id
            JOIN tag_hierarchy th ON nt.tag_id = th.descendant_id
            GROUP BY n.note_id
            HAVING COUNT(DISTINCT th.root_id) = ?
        ))
        """

        params = [visibility_level, len(selected_tags), len(selected_tags)]

        if selected_tags:
            tag_placeholders = ",".join("?" for _ in selected_tags)
            query = query.format(tag_placeholders)
            params = selected_tags + params
        else:
            query = query.format("SELECT tag_id FROM Tags")

        if search_text:
            query += " AND n.text LIKE ?"
            params.append(f"%{search_text}%")

        query += " GROUP BY n.note_id"

        sort_field, sort_order = sort_criteria.split("-")
        sort_mapping = {"stars": "n.rating", "date": "n.date", "visibility": "n.visibility", "mmr": "n.mmr"}
        query += f" ORDER BY {sort_mapping[sort_field]} {'DESC' if sort_order == 'desc' else 'ASC'}"

        cursor = db.execute(query, params)
        results = cursor.fetchall()

        return jsonify([dict(row) for row in results])
    except Exception as e:
        app.logger.error(f"Error in search: {str(e)}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route("/search2", methods=["POST"])
def search2():
    try:
        db = get_db()
        data = request.json

        app.logger.debug(f"Search request data: {data}")
        selected_tags = data.get("tags", [])
        search_text = data.get("text", "")
        password = data.get("password", "")
        sort_criteria = data.get("sortCriteria", "stars-desc")

        # Check visibility level for each selected tag
        visibility_levels = [get_visibility_level(password, tag_id) for tag_id in selected_tags]
        visibility_level = max(visibility_levels) if visibility_levels else get_visibility_level(password)

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
        SELECT n.note_id, n.text, n.author, n.date, n.rating, n.source, n.visibility, n.mmr, n.mmr_matches,
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

        sort_field, sort_order = sort_criteria.split("-")
        sort_mapping = {"stars": "n.rating", "date": "n.date", "visibility": "n.visibility", "mmr": "n.mmr"}  # Add this line
        query += f" ORDER BY {sort_mapping[sort_field]} {'DESC' if sort_order == 'desc' else 'ASC'}"

        app.logger.debug(f"Search query: {query}")
        app.logger.debug(f"Search params: {params}")

        cursor = db.execute(query, params)
        results = cursor.fetchall()

        filtered_results = [dict(row) for row in results if row["visibility"] <= visibility_level]

        app.logger.debug(f"Filtered search results: {filtered_results}")

        return jsonify(filtered_results)
    except Exception as e:
        app.logger.error(f"Error in search: {str(e)}", exc_info=True)
        return jsonify({"error": str(e)}), 500


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


if __name__ == "__main__":
    init_db()
    app.run(debug=False)

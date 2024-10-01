import sqlite3
import argparse

"""

example usage:
python reset_mmr.py

python reset_mmr.py notes.db --base_mmr 1600 --star_increment 150

"""


def reset_mmr(db_path="notes.db", base_mmr=1500, star_increment=100):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        # Reset MMR and match count for all notes
        cursor.execute(
            """
            UPDATE Notes
            SET mmr = 
                CASE 
                    WHEN rating = 1 THEN ?
                    WHEN rating = 2 THEN ?
                    WHEN rating = 3 THEN ?
                    WHEN rating = 4 THEN ?
                    WHEN rating = 5 THEN ?
                    ELSE ?
                END,
            mmr_matches = 0
        """,
            [base_mmr - 2 * star_increment, base_mmr - star_increment, base_mmr, base_mmr + star_increment, base_mmr + 2 * star_increment, base_mmr],
        )

        conn.commit()
        print(f"MMR reset complete. Affected {cursor.rowcount} notes.")
    except sqlite3.Error as e:
        print(f"An error occurred: {e}")
        conn.rollback()
    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Reset and initialize MMR based on star ratings.")
    parser.add_argument("db_path", help="Path to the SQLite database file")
    parser.add_argument("--base_mmr", type=int, default=1500, help="Base MMR for 3-star notes (default: 1500)")
    parser.add_argument("--star_increment", type=int, default=100, help="MMR increment per star (default: 100)")

    args = parser.parse_args()

    reset_mmr(args.db_path, args.base_mmr, args.star_increment)

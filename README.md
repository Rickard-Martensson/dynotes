# DyNotes: Dynamic Note-Taking with Tag Visualization

DyNotes is a note-taking application I created to organize thoughts using a dynamic tag system visualized as an interactive graph. I built it because I couldn't find an existing tool that quite fit my needs.

![DyNotes Interface](image-1.png)

## Key Features

1. **Tag-Based Organization**:
   - Organize notes with a hierarchical tag system.
   - Visualize tag relationships in an interactive graph.
   - Search notes by selecting tags, respecting the hierarchy.

2. **Full-Text Search**:
   - Find notes containing specific words or phrases.
   - Combine with tag-based search for more precise queries.

3. **Visibility Levels**:
   - Assign visibility levels to notes for basic access control.
   - Search results are filtered based on user's permission level.

4. **MMR (Match Making Rating) System**:
   - Compare and rank notes using an Elo-like rating system.
   - Helps surface content you've found more useful over time.

5. **Markdown Support**:
   - Write notes using Markdown for basic formatting.
   - Preview formatted notes while editing.

## Getting Started

### You'll Need

- Python 3.7+
- Flask
- SQLite3
- Node.js and npm (for TypeScript compilation)

### Setup

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/dynotes.git
   cd dynotes
   ```

2. Install Python dependencies:
   ```
   pip install -r requirements.txt
   ```

3. Install TypeScript and compile:
   ```
   npm install
   npm run build
   ```

4. Initialize and run:
   ```
   python app.py
   ```

5. Open `http://localhost:5000` in your browser

## Development

1. Make changes to `tagGraph.ts` or other files.
2. Compile TypeScript: `npm run build`
3. Restart the Flask app: `python app.py`
4. Refresh your browser to see changes

## Current State

DyNotes is a personal project that works for my needs, and works on my website. but it's not polished for wide-scale use. If you're interested in using it, you might need to tweak things to fit your setup (especially the password protection parts)

## Contributing

Feel free to submit pull requests if you want to add features or fix bugs. I'm always open to improvements!

## License

This project is under the MIT License. See the [LICENSE](LICENSE) file for details.

---

Created by [Rickard](https://www.ric.ke)
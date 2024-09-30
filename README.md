
# DyNotes: Dynamic Note-Taking with Tag Visualization

DyNotes is a powerful note-taking application that allows users to organize their thoughts using a dynamic tag system visualized as an interactive graph.



![Alt text](image-1.png)
## Features

1. **Tag-Based Search**: 
   - Search notes by selecting one or more tags.
   - The search respects tag hierarchies, automatically including child tags in the results.
   - This allows for both broad and narrow searches based on your tag structure.

2. **Full-Text Search**:
   - Quickly find notes containing specific words or phrases.
   - Combines with tag-based search for highly targeted queries.

3. **Visibility Levels**:
   - Each note has a visibility level, allowing for fine-grained access control.
   - Search results are filtered based on the user's permission level, ensuring sensitive information remains protected.

4. **Efficient Query Execution**:
   - Utilizes SQLite's full-text search capabilities for fast results even with large numbers of notes.
   - Implements recursive common table expressions (CTE) to efficiently traverse tag hierarchies.

5. **Dynamic Result Updates**:
   - Search results update in real-time as you modify your query or select different tags.

This powerful combination allows users to quickly find relevant information across their entire knowledge base, making DyNotes an invaluable tool for organizing and retrieving complex, interconnected ideas.

## Getting Started

### Prerequisites

- Python 3.7+
- Flask
- SQLite3

### Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/dynotes.git
   cd dynotes
   ```

2. Install the required dependencies:
   ```
   pip install -r requirements.txt
   ```

3. Initialize the database:
   ```
   python app.py
   ```

4. Access the application:
   Open your web browser and navigate to `http://localhost:5000`

## Development Workflow

1. Make changes to `tagGraph.ts`
2. Compile TypeScript to JavaScript:
   ```
   tsc
   ```
3. Run the Flask application:
   ```
   python app.py
   ```
4. View changes in your browser at `http://localhost:5000`
5. Repeat steps 1-4 as needed

## Deployment

When deploying the application, make sure to update the API endpoints in `tagGraph.js`:

Replace all instances of:
```javascript
fetch("/some_path")
```
with:
```javascript
fetch("/%entrypoint_for_your_website%/some_path")
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

Created by [Rickard](https://www.ric.ke), except for the readme, that was all Chatgpt!


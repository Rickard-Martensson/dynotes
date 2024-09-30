"use strict";
// tagGraph.ts
// import * as d3 from 'd3';
class TagGraph {
    maxGeneration = 0;
    container;
    svg;
    simulation;
    nodes;
    links;
    draggedNode;
    selectedNodes;
    lastSelectedNode;
    infoText;
    pointerCounts = new Map();
    isDragging = false;
    holdTimer = null;
    isHoldReady = false;
    static COLORS = {
        ARROW: "#2c3e50",
        NODE_STROKE: "#3498db",
        NODE_UNSELECTED: [
            "#2d3436", // Generation 0
            "#636e72", // Generation 1
            "#b2bec3", // Generation 2
            "#dfe6e9", // Generation 3
        ],
        NODE_SELECTED: [
            "#d35400", // Generation 0
            "#e67e22", // Generation 1
            "#f39c12", // Generation 2
            "#f1c40f", // Generation 3
        ],
        // BACKGROUND: "#FFF5E6",  // Sepia whitef7f1e3
        BACKGROUND: "#f7f1e3", // Sepia whitef7f1e3
        // BORDER: "#D4C6B3"       // Slightly darker than background for border
        BORDER: "#84817a" // Slightly darker than background for border
    };
    static NODE_SIZES = [12, 10, 8]; // Sizes for generations 0-4+
    constructor(containerId) {
        this.updateNodeMenu();
        this.container = document.getElementById(containerId);
        // Apply styles to the container
        this.container.style.backgroundColor = TagGraph.COLORS.BACKGROUND;
        this.container.style.border = `2px solid ${TagGraph.COLORS.BORDER}`;
        // this.container.style.borderRadius = '10px';
        // this.container.style.overflow = 'hidden';
        this.svg = d3.select(this.container).append("svg")
            .attr("width", "100%")
            .attr("height", "500px");
        this.simulation = d3.forceSimulation()
            .force("link", d3.forceLink().id(d => d.tag_id.toString()).distance(this.getLinkDistance.bind(this)))
            // .force("link", d3.forceLink<Tag, Link>().id(d => d.tag_id.toString()).distance(100))
            .force("charge", d3.forceManyBody().strength(-300))
            .force("center", d3.forceCenter(this.container.clientWidth / 2, 250))
            .force("collision", d3.forceCollide().radius(20))
            .force("x", d3.forceX(this.container.clientWidth / 2).strength(0.05))
            .force("y", d3.forceY(250).strength(0.05));
        this.nodes = [];
        this.links = [];
        this.draggedNode = null;
        this.selectedNodes = new Set();
        this.lastSelectedNode = null;
        this.infoText = this.svg.append("text")
            .attr("id", "infoText")
            .attr("x", this.container.clientWidth / 2)
            .attr("y", 30)
            .attr("text-anchor", "middle")
            .attr("fill", "#333")
            .style("font-size", "14px")
            .style("font-weight", "bold");
        // Add CSS rule to prevent text selection
        const style = document.createElement('style');
        style.textContent = `
            .node text {
                -webkit-user-select: none;
                -moz-user-select: none;
                -ms-user-select: none;
                user-select: none;
                pointer-events: none;
            }
        `;
        document.head.appendChild(style);
    }
    isOrphan(node) {
        return !this.links.some(link => link.target === node);
    }
    async loadData() {
        const [tagsResponse, relationshipsResponse] = await Promise.all([
            fetch('/tags'),
            fetch('/tag_relationships')
        ]);
        const tags = await tagsResponse.json();
        const relationships = await relationshipsResponse.json();
        this.nodes = tags.map(tag => ({ ...tag, children: [], visible: !relationships.some(r => r.child_tag_id === tag.tag_id) }));
        this.links = relationships.map(rel => ({
            source: this.nodes.find(n => n.tag_id === rel.parent_tag_id),
            target: this.nodes.find(n => n.tag_id === rel.child_tag_id)
        }));
        this.nodes.forEach(node => {
            node.children = this.links.filter(link => link.source === node).map(link => link.target);
        });
        this.nodes.forEach(node => {
            this.pointerCounts.set(node.tag_id, this.isOrphan(node) ? 1 : 0);
        });
        this.calculateGenerations();
        this.updateGraph();
    }
    calculateGenerations() {
        const rootNodes = this.nodes.filter(node => !this.links.some(link => link.target === node));
        rootNodes.forEach(node => this.setGeneration(node, 0));
        this.maxGeneration = Math.max(...this.nodes.map(n => n.generation || 0));
    }
    setGeneration(node, generation) {
        node.generation = generation;
        this.links
            .filter(link => link.source === node)
            .forEach(link => this.setGeneration(link.target, generation + 1));
    }
    getLinkDistance(link) {
        const baseDistance = 100;
        const minDistance = 20;
        const sourceGeneration = link.source.generation || 0;
        return Math.max(baseDistance - sourceGeneration * 40, minDistance);
    }
    getNodeColor(node) {
        const isSelected = this.selectedNodes.has(node);
        if (isSelected) {
            const generation = Math.min(node.generation || 0, TagGraph.COLORS.NODE_SELECTED.length - 1);
            return TagGraph.COLORS.NODE_SELECTED[generation];
        }
        else {
            const generation = Math.min(node.generation || 0, TagGraph.COLORS.NODE_UNSELECTED.length - 1);
            return TagGraph.COLORS.NODE_UNSELECTED[generation];
        }
    }
    startNodeWiggle(element) {
        d3.select(element)
            .transition()
            .duration(75)
            .attr("transform", "translate(2, 2)")
            .transition()
            .duration(75)
            .attr("transform", "translate(-2, -2)")
            .transition()
            .duration(75)
            .attr("transform", "translate(-2, 2)")
            .transition()
            .duration(75)
            .attr("transform", "translate(2, -2)")
            .on("end", () => {
            if (this.isHoldReady) {
                this.startNodeWiggle(element);
            }
        });
    }
    stopNodeWiggle(element) {
        d3.select(element)
            .interrupt()
            .attr("transform", null);
    }
    drag() {
        return d3.drag()
            .on("start", (event, d) => {
            this.isDragging = false;
            this.isHoldReady = false;
            if (!event.active)
                this.simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
            this.draggedNode = d;
            d3.select(event.sourceEvent.target)
                .attr("r", this.getNodeSize(d) * 1.2) // Increase size by 20% when dragging
                .attr("fill", TagGraph.COLORS.NODE_STROKE);
            // Start the hold timer
            this.holdTimer = window.setTimeout(() => {
                this.isHoldReady = true;
                this.startNodeWiggle(event.sourceEvent.target);
                this.freezeAllNodes();
            }, 500);
        })
            .on("drag", (event, d) => {
            if (!this.isHoldReady) {
                // If not held long enough, just move the node
                d.fx = event.x;
                d.fy = event.y;
                if (!event.active)
                    this.simulation.alpha(0.3).restart();
                return;
            }
            this.isDragging = true;
            d.fx = event.x;
            d.fy = event.y;
            if (!event.active)
                this.simulation.alpha(0.3).restart();
            const targetNode = this.getNodeAtPosition(event.x, event.y, d);
            this.svg.selectAll(".node circle")
                .attr("stroke", node => node === targetNode && node !== d ? TagGraph.COLORS.NODE_STROKE : null)
                .attr("stroke-width", node => node === targetNode && node !== d ? 3 : null);
            this.updateInfoText(d, targetNode);
        })
            .on("end", (event, d) => {
            if (this.holdTimer) {
                clearTimeout(this.holdTimer);
                this.holdTimer = null;
            }
            this.stopNodeWiggle(event.sourceEvent.target);
            if (!event.active)
                this.simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
            if (this.isHoldReady) {
                this.handleDragEnd(event, d);
            }
            this.unfreezeAllNodes();
            d3.select(event.sourceEvent.target)
                .attr("r", this.getNodeSize(d))
                .attr("fill", this.getNodeColor(d));
            this.svg.selectAll(".node circle").attr("stroke", null);
            this.infoText.text("");
            this.isDragging = false;
            this.isHoldReady = false;
        });
    }
    freezeAllNodes() {
        this.nodes.forEach(node => {
            if (node !== this.draggedNode) {
                node.fx = node.x;
                node.fy = node.y;
            }
        });
    }
    unfreezeAllNodes() {
        this.nodes.forEach(node => {
            if (node !== this.draggedNode) {
                node.fx = null;
                node.fy = null;
            }
        });
    }
    toggleNodeSelection(node) {
        if (this.selectedNodes.has(node)) {
            this.selectedNodes.delete(node);
            this.updatePointerCounts(node, -1);
        }
        else {
            this.selectedNodes.add(node);
            this.updatePointerCounts(node, 1);
        }
        node.visible = true;
        this.lastSelectedNode = node;
        this.updateGraph();
        this.updateSelectedTagsLists();
        this.performSearch();
        this.updateNodeMenu();
    }
    updatePointerCounts(node, delta) {
        const relatives = new Set();
        this.addAncestors(node, relatives);
        this.addDescendants(node, relatives);
        relatives.forEach(relative => {
            const currentCount = this.pointerCounts.get(relative.tag_id) || 0;
            this.pointerCounts.set(relative.tag_id, currentCount + delta);
            relative.visible = this.pointerCounts.get(relative.tag_id) > 0;
        });
    }
    addAncestors(node, relatives) {
        this.links.forEach(link => {
            if (link.target === node && !relatives.has(link.source)) {
                relatives.add(link.source);
                this.addAncestors(link.source, relatives);
            }
        });
    }
    addDescendants(node, relatives) {
        this.links.forEach(link => {
            if (link.source === node && !relatives.has(link.target)) {
                relatives.add(link.target);
                // this.addDescendants(link.target, relatives);
            }
        });
    }
    updateNodeMenu() {
        if (!this.lastSelectedNode) {
            // document.getElementById('nodeMenu')!.style.display = 'none';
            document.getElementById('nodeMenu').style.display = 'block';
            return;
        }
        document.getElementById('nodeMenu').style.display = 'block';
        document.getElementById('nodeName').value = this.lastSelectedNode.name;
        const parentsList = document.getElementById('nodeParents');
        const childrenList = document.getElementById('nodeChildren');
        parentsList.innerHTML = '';
        childrenList.innerHTML = '';
        this.links.forEach(link => {
            if (link.target === this.lastSelectedNode) {
                const li = document.createElement('li');
                li.textContent = link.source.name;
                const removeBtn = document.createElement('button');
                removeBtn.textContent = 'Remove';
                removeBtn.classList.add('remove');
                removeBtn.onclick = () => this.removeRelationship(link);
                li.appendChild(removeBtn);
                parentsList.appendChild(li);
            }
            else if (link.source === this.lastSelectedNode) {
                const li = document.createElement('li');
                li.textContent = link.target.name;
                const removeBtn = document.createElement('button');
                removeBtn.textContent = 'Remove';
                removeBtn.classList.add('remove');
                removeBtn.onclick = () => this.removeRelationship(link);
                li.appendChild(removeBtn);
                childrenList.appendChild(li);
            }
        });
        const addParentSelect = document.getElementById('addParent');
        const addChildSelect = document.getElementById('addChild');
        addParentSelect.innerHTML = '';
        addChildSelect.innerHTML = '';
        this.nodes.forEach(node => {
            if (node !== this.lastSelectedNode) {
                const parentOption = document.createElement('option');
                parentOption.value = node.tag_id.toString();
                parentOption.textContent = node.name;
                addParentSelect.appendChild(parentOption);
                const childOption = document.createElement('option');
                childOption.value = node.tag_id.toString();
                childOption.textContent = node.name;
                addChildSelect.appendChild(childOption);
            }
        });
    }
    async renameNode() {
        const newName = document.getElementById('nodeName').value;
        if (this.lastSelectedNode && newName !== this.lastSelectedNode.name) {
            const response = await fetch('/rename_tag', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tag_id: this.lastSelectedNode.tag_id, new_name: newName })
            });
            if (response.ok) {
                this.lastSelectedNode.name = newName;
                this.updateGraph();
                this.updateNodeMenu();
            }
            else {
                console.error('Failed to rename tag');
            }
        }
    }
    async addParent() {
        const parentId = document.getElementById('addParent').value;
        const parentNode = this.nodes.find(n => n.tag_id === parseInt(parentId));
        if (parentNode && this.lastSelectedNode) {
            await this.createRelationship(parentNode, this.lastSelectedNode);
        }
    }
    async addChild() {
        const childId = document.getElementById('addChild').value;
        const childNode = this.nodes.find(n => n.tag_id === parseInt(childId));
        if (childNode && this.lastSelectedNode) {
            await this.createRelationship(this.lastSelectedNode, childNode);
        }
    }
    updateGraph() {
        const visibleNodes = this.nodes.filter(n => this.pointerCounts.get(n.tag_id) > 0 || this.selectedNodes.has(n));
        const visibleLinks = this.links.filter(l => visibleNodes.includes(l.source) && visibleNodes.includes(l.target));
        // Remove all existing elements
        this.svg.selectAll(".link").remove();
        this.svg.selectAll(".node").remove();
        // Draw links first
        const link = this.svg.append("g")
            .attr("class", "links")
            .selectAll("line")
            .data(visibleLinks, d => `${d.source.tag_id}-${d.target.tag_id}`)
            .join("line")
            .attr("class", "link")
            .attr("stroke", TagGraph.COLORS.ARROW)
            .attr("stroke-width", 2)
            .attr("marker-end", "url(#arrowhead)");
        // Then draw nodes on top
        const node = this.svg.append("g")
            .attr("class", "nodes")
            .selectAll("g")
            .data(visibleNodes, d => d.tag_id)
            .join("g")
            .attr("class", "node")
            .attr("data-tag-id", d => d.tag_id) // Add this line
            .call(this.drag());
        node.append("circle")
            .attr("r", d => this.getNodeSize(d))
            .attr("fill", d => this.getNodeColor(d));
        node.append("text")
            .text(d => d.name)
            .attr("text-anchor", "middle")
            .attr("dy", d => -this.getNodeSize(d) - 5)
            .style("pointer-events", "none");
        this.simulation.nodes(visibleNodes).on("tick", () => {
            link
                .attr("x1", d => d.source.x)
                .attr("y1", d => d.source.y)
                .attr("x2", d => d.target.x)
                .attr("y2", d => d.target.y);
            node
                .attr("transform", d => `translate(${d.x},${d.y})`);
        });
        this.simulation.force("link").links(visibleLinks);
        this.simulation.alpha(1).restart();
    }
    getNodeSize(node) {
        const generation = Math.min(node.generation || 0, TagGraph.NODE_SIZES.length - 1);
        return TagGraph.NODE_SIZES[generation];
    }
    updateInfoText(draggedNode, targetNode) {
        if (targetNode && targetNode !== draggedNode) {
            const existingRelationship = this.links.find(l => (l.source === draggedNode && l.target === targetNode) ||
                (l.source === targetNode && l.target === draggedNode));
            if (existingRelationship) {
                this.infoText.text(`Release to remove relationship between "${draggedNode.name}" and "${targetNode.name}"`);
            }
            else {
                this.infoText.text(`Release to create relationship: "${draggedNode.name}" → "${targetNode.name}"`);
            }
        }
        else {
            this.infoText.text("");
        }
    }
    async handleDragEnd(event, draggedNode) {
        const targetNode = this.getNodeAtPosition(event.x, event.y, draggedNode);
        if (targetNode && targetNode !== draggedNode) {
            const existingRelationship = this.links.find(l => (l.source === draggedNode && l.target === targetNode) ||
                (l.source === targetNode && l.target === draggedNode));
            if (existingRelationship) {
                await this.removeRelationship(existingRelationship);
            }
            else {
                await this.createRelationship(draggedNode, targetNode);
            }
        }
        this.draggedNode = null;
    }
    getNodeAtPosition(x, y, excludeNode = null) {
        const radius = 20;
        return this.nodes.find(node => node !== excludeNode &&
            node.visible == true &&
            Math.sqrt(Math.pow(node.x - x, 2) + Math.pow(node.y - y, 2)) < radius) || null;
    }
    async createRelationship(parentNode, childNode) {
        const selectedNodesBefore = new Set(this.selectedNodes);
        const response = await fetch('/update_tag_relationships', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parent_id: parentNode.tag_id, child_id: childNode.tag_id })
        });
        if (response.ok) {
            this.links.push({ source: parentNode, target: childNode });
            parentNode.children.push(childNode);
            // Reset pointer counts
            this.nodes.forEach(node => {
                this.pointerCounts.set(node.tag_id, this.isOrphan(node) ? 1 : 0);
            });
            // Re-enable all previously selected nodes
            selectedNodesBefore.forEach(node => {
                this.updatePointerCounts(node, 1);
            });
            this.updateGraph();
        }
        else {
            console.error('Failed to create relationship');
        }
    }
    async removeRelationship(relationship) {
        const selectedNodesBefore = new Set(this.selectedNodes);
        const response = await fetch('/remove_tag_relationship', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parent_id: relationship.source.tag_id, child_id: relationship.target.tag_id })
        });
        if (response.ok) {
            this.links = this.links.filter(l => l !== relationship);
            relationship.source.children = relationship.source.children.filter(c => c !== relationship.target);
            // Reset pointer counts
            this.nodes.forEach(node => {
                this.pointerCounts.set(node.tag_id, this.isOrphan(node) ? 1 : 0);
            });
            // Re-enable all previously selected nodes
            selectedNodesBefore.forEach(node => {
                this.updatePointerCounts(node, 1);
            });
            this.updateGraph();
        }
        else {
            console.error('Failed to remove relationship');
        }
    }
    hideDescendants(node) {
        node.children.forEach(child => {
            if (!this.selectedNodes.has(child)) {
                child.visible = false;
                // this.hideDescendants(child);
            }
        });
    }
    updateSelectedTagsLists() {
        const selectedTags = Array.from(this.selectedNodes).map(n => n.name);
        const uniqueSelectedTags = [...new Set(selectedTags)].join(", ");
        document.getElementById("selectedNoteTags").textContent = uniqueSelectedTags;
        document.getElementById("selectedSearchTags").textContent = uniqueSelectedTags;
    }
    performSearch() {
        const searchText = document.getElementById("searchText").value;
        const password = document.getElementById("searchPassword").value;
        const tags = Array.from(this.selectedNodes).map(n => n.tag_id);
        fetch('/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: searchText, tags, password })
        })
            .then(response => response.json())
            .then(results => displaySearchResults(results))
            .catch(error => console.error('Failed to search notes:', error));
    }
    initialize() {
        this.svg.append("defs").append("marker")
            .attr("id", "arrowhead")
            .attr("viewBox", "0 -5 10 10")
            .attr("refX", 20)
            .attr("refY", 0)
            .attr("markerWidth", 6)
            .attr("markerHeight", 6)
            .attr("orient", "auto")
            .append("path")
            .attr("d", "M0,-5L10,0L0,5")
            .attr("fill", TagGraph.COLORS.ARROW);
        const style = document.createElement('style');
        style.textContent = `
                .node circle {
                    rx: 5;
                    ry: 5;
                }
            `;
        document.head.appendChild(style);
        this.loadData().then(() => {
            console.log("Nodes:", this.nodes);
            console.log("Links:", this.links);
            console.log("Pointer Counts:", this.pointerCounts);
        });
        this.svg.on("click", (event) => {
            if (!this.isDragging && event.target.tagName === "circle") {
                const node = d3.select(event.target.parentNode).datum();
                this.toggleNodeSelection(node);
            }
        });
    }
}
function generateReadableId(name) {
    let base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    let id = base;
    let counter = 1;
    while (document.querySelector(`[data-readable-id="${id}"]`)) {
        id = `${base}-${counter}`;
        counter++;
    }
    return id;
}
async function addTag() {
    const nameInput = document.getElementById("tagName");
    const name = nameInput.value.trim();
    if (!name)
        return;
    const readable_id = generateReadableId(name);
    const response = await fetch('/add_tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, readable_id })
    });
    if (response.ok) {
        nameInput.value = "";
        window.tagGraph.loadData();
    }
    else {
        console.error('Failed to add tag');
    }
}
async function addNote2() {
    const text = document.getElementById("noteText").value;
    const author = document.getElementById("noteAuthor").value;
    const rating = document.getElementById("noteRating").value;
    const source = document.getElementById("noteSource").value;
    const tags = Array.from(window.tagGraph.selectedNodes).map((n) => n.tag_id);
    const response = await fetch('/add_note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, author, rating, source, tags })
    });
    if (response.ok) {
        document.getElementById("noteText").value = "";
        document.getElementById("noteAuthor").value = "";
        document.getElementById("noteRating").value = "";
        document.getElementById("noteSource").value = "";
        window.tagGraph.selectedNodes.clear();
        window.tagGraph.updateGraph();
        window.tagGraph.updateSelectedTagsLists();
    }
    else {
        console.error('Failed to add note');
    }
}
async function searchNotes() {
    const searchText = document.getElementById("searchText").value;
    const password = document.getElementById("searchPassword").value;
    const tags = Array.from(window.tagGraph.selectedNodes).map((n) => n.tag_id);
    const response = await fetch('/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: searchText, tags, password })
    });
    if (response.ok) {
        const results = await response.json();
        displaySearchResults(results);
    }
    else {
        console.error('Failed to search notes');
    }
}
async function updatePassword() {
    const oldPassword = prompt("Enter old password:");
    if (!oldPassword)
        return;
    const newPassword = prompt("Enter new password:");
    if (!newPassword)
        return;
    const response = await fetch('/change_password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_password: oldPassword, new_password: newPassword })
    });
    const result = await response.json();
    alert(result.message);
}
function displaySearchResults(results) {
    const resultsContainer = document.getElementById("results");
    resultsContainer.innerHTML = "";
    const notesContainer = document.createElement("div");
    notesContainer.className = "notes-container";
    results.forEach(note => {
        const noteElement = document.createElement("div");
        noteElement.className = "note";
        const textContainer = document.createElement("div");
        textContainer.className = "note-text";
        textContainer.textContent = note.text;
        const metaContainer = document.createElement("div");
        metaContainer.className = "note-meta";
        const ratingElement = document.createElement("span");
        ratingElement.className = "note-rating";
        ratingElement.textContent = `${note.rating}⭐`;
        const tagsElement = document.createElement("div");
        tagsElement.className = "note-tags";
        tagsElement.textContent = `Tags: ${note.tags}`;
        metaContainer.appendChild(ratingElement);
        metaContainer.appendChild(tagsElement);
        noteElement.appendChild(textContainer);
        noteElement.appendChild(metaContainer);
        notesContainer.appendChild(noteElement);
    });
    resultsContainer.appendChild(notesContainer);
}
function displaySearchResults4(results) {
    const resultsContainer = document.getElementById("results");
    resultsContainer.innerHTML = "";
    const notesContainer = document.createElement("div");
    notesContainer.className = "notes-container";
    results.forEach(note => {
        const noteElement = document.createElement("div");
        noteElement.className = "note";
        const textContainer = document.createElement("div");
        textContainer.className = "note-text";
        textContainer.textContent = note.text;
        const metaContainer = document.createElement("div");
        metaContainer.className = "note-meta";
        const ratingElement = document.createElement("span");
        ratingElement.className = "note-rating";
        ratingElement.textContent = `${note.rating}⭐`; // Display rating as number followed by a single star
        const tagsElement = document.createElement("div");
        tagsElement.className = "note-tags";
        tagsElement.textContent = "Tags: Placeholder";
        metaContainer.appendChild(ratingElement);
        metaContainer.appendChild(tagsElement);
        noteElement.appendChild(textContainer);
        noteElement.appendChild(metaContainer);
        notesContainer.appendChild(noteElement);
    });
    resultsContainer.appendChild(notesContainer);
}
function displaySearchResults2(results) {
    const resultsContainer = document.getElementById("results");
    resultsContainer.innerHTML = "";
    results.forEach(note => {
        const noteElement = document.createElement("div");
        noteElement.className = "note";
        noteElement.innerHTML = `
        <p><strong>Text:</strong> ${note.text}</p>
        <p><strong>Author:</strong> ${note.author}</p>
        <p><strong>Date:</strong> ${new Date(note.date * 1000).toLocaleString()}</p>
        <p><strong>Rating:</strong> ${note.rating}</p>
        <p><strong>Source:</strong> ${note.source}</p>
      `;
        resultsContainer.appendChild(noteElement);
    });
}
function initRating(containerId) {
    const container = document.getElementById(containerId);
    if (!container)
        return;
    const items = container.getElementsByClassName(containerId === 'noteRating' ? 'star' : 'visibility');
    container.addEventListener('click', (e) => {
        const target = e.target;
        if (target.classList.contains('star') || target.classList.contains('visibility')) {
            const value = target.getAttribute('data-value') ?? '';
            Array.from(items).forEach((item) => {
                if (item instanceof HTMLElement) {
                    const itemValue = item.getAttribute('data-value') ?? '';
                    item.classList.toggle('active', itemValue <= value);
                }
            });
        }
    });
}
// Initialize star ratings
initRating('noteRating');
initRating('noteVisibility');
// Function to convert markdown to HTML
function markdownToHtml(markdown) {
    return markdown
        .replace(/^(#{1,6})\s+(.+)$/gm, (match, hashes, content) => {
        const level = hashes.length;
        return `<h${level}>${content}</h${level}>`;
    })
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
}
// Function to update preview
function updatePreview() {
    const noteText = document.getElementById('noteText').value;
    const notePreview = document.getElementById('notePreview');
    if (notePreview) {
        notePreview.innerHTML = markdownToHtml(noteText);
    }
}
// Add event listener to noteText
const noteTextArea = document.getElementById('noteText');
if (noteTextArea) {
    noteTextArea.addEventListener('input', updatePreview);
}
function saveFormData() {
    const text = document.getElementById("noteText").value;
    const author = document.getElementById("noteAuthor").value;
    const source = document.getElementById("noteSource").value;
    const rating = document.querySelectorAll("#noteRating .star.active").length;
    const visibility = document.querySelectorAll("#noteVisibility .visibility.active").length;
    // Get selected tags
    const selectedTags = Array.from(window.tagGraph.selectedNodes)
        .map((tag) => tag.tag_id);
    localStorage.setItem('noteFormData', JSON.stringify({
        text, author, source, rating, visibility, selectedTags
    }));
    // localStorage.setItem('noteFormData', JSON.stringify({ text, author, source, rating, visibility }));
}
// Function to load form data from localStorage
function loadFormData() {
    const savedData = localStorage.getItem('noteFormData');
    if (savedData) {
        const { text, author, source, rating, visibility, selectedTags } = JSON.parse(savedData);
        document.getElementById("noteText").value = text;
        document.getElementById("noteAuthor").value = author;
        document.getElementById("noteSource").value = source;
        // Set rating
        document.querySelectorAll("#noteRating .star").forEach((star, index) => {
            star.classList.toggle('active', index < rating);
        });
        // Set visibility
        document.querySelectorAll("#noteVisibility .visibility").forEach((vis, index) => {
            vis.classList.toggle('active', index < visibility);
        });
        // Restore selected tags
        if (selectedTags && Array.isArray(selectedTags)) {
            // Clear existing selections
            window.tagGraph.selectedNodes.clear();
            window.tagGraph.updateGraph();
            // Find and simulate click on each saved tag
            selectedTags.forEach((tagId) => {
                const tagElement = document.querySelector(`.node[data-tag-id="${tagId}"] circle`);
                if (tagElement) {
                    tagElement.dispatchEvent(new MouseEvent('click', {
                        view: window,
                        bubbles: true,
                        cancelable: true
                    }));
                }
            });
        }
        // Update preview
        updatePreview();
    }
}
// Function to clear form data
function clearFormData() {
    document.getElementById("noteText").value = "";
    localStorage.removeItem('noteFormData');
    updatePreview();
}
// Add event listeners to form fields
document.getElementById("noteText")?.addEventListener('input', saveFormData);
document.getElementById("noteAuthor")?.addEventListener('input', saveFormData);
document.getElementById("noteSource")?.addEventListener('input', saveFormData);
document.getElementById("noteRating")?.addEventListener('click', saveFormData);
document.getElementById("noteVisibility")?.addEventListener('click', saveFormData);
// Load saved form data when the page loads
window.addEventListener('load', loadFormData);
window.addEventListener('beforeunload', saveFormData);
async function addNote() {
    const text = document.getElementById("noteText").value;
    const author = document.getElementById("noteAuthor").value;
    const ratingElements = document.querySelectorAll("#noteRating .star.active");
    const rating = ratingElements.length; // This will give us the correct rating based on the number of active stars
    const source = document.getElementById("noteSource").value;
    const visibilityElement = document.querySelector("#noteVisibility .visibility.active:last-of-type");
    const visibility = visibilityElement ? parseInt(visibilityElement.getAttribute('data-value') || '1', 10) : 1;
    const tags = Array.from(window.tagGraph.selectedNodes).map((n) => n.tag_id);
    // Validation checks
    if (text.trim() === '') {
        alert('Please enter some text for the note.');
        return;
    }
    if (tags.length === 0) {
        alert('Please select at least one tag for the note.');
        return;
    }
    if (rating === 0) {
        alert('Please select a rating for the note.');
        return;
    }
    console.log("Sending note data:", { text, author, rating, source, visibility, tags });
    try {
        const response = await fetch('/add_note', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, author, rating, source, visibility, tags })
        });
        if (response.ok) {
            const result = await response.json();
            if (result.success) {
                clearFormData(); // Clear only the text and localStorage
                // (window as any).tagGraph.selectedNodes.clear();
                // (window as any).tagGraph.updateGraph();
                // (window as any).tagGraph.updateSelectedTagsLists();
                console.log("Note added successfully");
                alert('Note added successfully!');
            }
            else {
                console.error('Failed to add note:', result.error);
                alert('Failed to add note: ' + result.error);
            }
        }
        else {
            const errorData = await response.json();
            console.error('Failed to add note:', errorData.error);
            alert('Failed to add note: ' + errorData.error);
        }
    }
    catch (error) {
        console.error('Error adding note:', error);
        alert('Error adding note: ' + error);
    }
}
// Update the addNote function
async function addNote3() {
    const text = document.getElementById("noteText").value;
    const author = document.getElementById("noteAuthor").value;
    const ratingElement = document.querySelector("#noteRating .star.active:last-of-type");
    const rating = ratingElement ? parseInt(ratingElement.getAttribute('data-value') || '0', 10) : 0;
    const source = document.getElementById("noteSource").value;
    const visibilityElement = document.querySelector("#noteVisibility .visibility.active:last-of-type");
    const visibility = visibilityElement ? parseInt(visibilityElement.getAttribute('data-value') || '0', 10) : 0;
    const tags = Array.from(window.tagGraph.selectedNodes).map((n) => n.tag_id);
    const response = await fetch('/add_note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, author, rating, source, visibility, tags })
    });
    if (response.ok) {
        clearFormData(); // Clear only the text and localStorage
        window.tagGraph.selectedNodes.clear();
        window.tagGraph.updateGraph();
        window.tagGraph.updateSelectedTagsLists();
    }
    else {
        console.error('Failed to add note');
    }
}
// Initialize the graph when the DOM is ready
document.addEventListener("DOMContentLoaded", () => {
    window.tagGraph = new TagGraph("tagGraph");
    window.tagGraph.initialize();
});

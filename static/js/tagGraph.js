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
    nodeMenu;
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
    static GRAPH_HEIGHT = 800;
    static NODE_SIZES = [12, 10, 8]; // Sizes for generations 0-4+
    constructor(containerId) {
        this.updateNodeMenu();
        this.container = document.getElementById(containerId);
        // Apply styles to the container
        this.container.style.backgroundColor = TagGraph.COLORS.BACKGROUND;
        this.container.style.border = `2px solid ${TagGraph.COLORS.BORDER}`;
        // this.container.style.borderRadius = '10px';
        // this.container.style.overflow = 'hidden';
        this.nodeMenu = document.getElementById('nodeMenu');
        document.getElementById('closeNodeMenu').addEventListener('click', () => this.hideNodeMenu());
        this.svg = d3.select(this.container).append("svg")
            .attr("width", "100%")
            .attr("height", TagGraph.GRAPH_HEIGHT + "px");
        this.simulation = d3.forceSimulation()
            .force("link", d3.forceLink().id(d => d.tag_id.toString()).distance(this.getLinkDistance.bind(this)))
            // .force("link", d3.forceLink<Tag, Link>().id(d => d.tag_id.toString()).distance(100))
            .force("charge", d3.forceManyBody().strength(-200))
            .force("center", d3.forceCenter(this.container.clientWidth / 2, TagGraph.GRAPH_HEIGHT / 2))
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
        window.addEventListener('resize', () => {
            requestAnimationFrame(() => {
                this.updateSimulationForces();
            });
        });
        this.updateSimulationForces();
    }
    updateSimulationForces() {
        const centerX = this.container.clientWidth / 2;
        const centerY = TagGraph.GRAPH_HEIGHT / 2;
        this.simulation
            .force("center", d3.forceCenter(centerX, centerY))
            .force("x", d3.forceX(centerX).strength(0.075))
            .force("y", d3.forceY(centerY).strength(0.075));
        // Restart the simulation with a higher alpha to make the changes more apparent
        this.simulation.alpha(0.3).restart();
    }
    hideNodeMenu() {
        this.nodeMenu.style.display = 'none';
        this.lastSelectedNode = null;
        requestAnimationFrame(() => {
            this.updateSimulationForces();
        });
    }
    isOrphan(node) {
        return !this.links.some(link => link.target === node);
    }
    async deleteTag(tagId) {
        if (!confirm("Are you sure you want to delete this tag? This action cannot be undone.")) {
            return;
        }
        try {
            const response = await fetch('/delete_tag', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tag_id: tagId })
            });
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    // Remove the tag from the nodes array
                    this.nodes = this.nodes.filter(node => node.tag_id !== tagId);
                    // Remove any links associated with this tag
                    this.links = this.links.filter(link => link.source.tag_id !== tagId && link.target.tag_id !== tagId);
                    // Clear the selected node if it was the deleted tag
                    if (this.lastSelectedNode && this.lastSelectedNode.tag_id === tagId) {
                        this.lastSelectedNode = null;
                    }
                    // Remove the tag from selectedNodes if present
                    this.selectedNodes.delete(this.nodes.find(node => node.tag_id === tagId));
                    this.updateGraph();
                    this.updateNodeMenu();
                    this.updateSelectedTagsLists();
                    alert('Tag deleted successfully!');
                }
                else {
                    alert('Failed to delete tag: ' + result.error);
                }
            }
            else {
                const errorData = await response.json();
                alert('Failed to delete tag: ' + errorData.error);
            }
        }
        catch (error) {
            console.error('Error deleting tag:', error);
            alert('Error deleting tag: ' + error);
        }
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
        const timeToWiggle = 750;
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
                // select node if you hold it for .5 sec
                this.freezeAllNodes();
            }, timeToWiggle);
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
        // this.lastSelectedNode = node;
        this.updateGraph();
        this.updateSelectedTagsLists();
        this.performSearch();
        // this.updateNodeMenu();
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
    addmeme() {
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
            document.getElementById('nodeMenu').style.display = 'none';
            // document.getElementById('nodeMenu')!.style.display = 'block';
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
        const deleteTagBtn = document.getElementById('deleteTagBtn');
        if (deleteTagBtn) {
            deleteTagBtn.onclick = () => {
                if (this.lastSelectedNode) {
                    this.deleteTag(this.lastSelectedNode.tag_id);
                }
            };
        }
        requestAnimationFrame(() => {
            this.updateSimulationForces();
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
                toastManager.showToast(`Release to remove relationship`, {
                    details: `"${targetNode.name}" and "${draggedNode.name}"`,
                    duration: 1000
                });
                // this.infoText.text(`Release to remove relationship between "${targetNode.name}" and "${draggedNode.name}"`);
            }
            else {
                toastManager.showToast(`Release to create relationship`, {
                    details: `"${targetNode.name}" → "${draggedNode.name}"`,
                    duration: 1000
                });
                // this.infoText.text(`Release to create relationship: "${targetNode.name}" → "${draggedNode.name}"`);
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
                await this.createRelationship(targetNode, draggedNode);
            }
        }
        else {
            // If you dragged till wiggle, and didnt merge, we open the menu
            this.lastSelectedNode = draggedNode;
            this.updateNodeMenu();
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
        // document.getElementById("selectedSearchTags")!.textContent = uniqueSelectedTags;
    }
    performSearch() {
        toggleLoadingAnimation(true);
        const searchText = document.getElementById("searchText").value;
        const password = document.getElementById("searchPassword").value;
        const tags = Array.from(this.selectedNodes).map(n => n.tag_id);
        fetch('/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: searchText, tags, password })
        })
            .then(response => {
            if (!response.ok) {
                return response.text().then(text => {
                    throw new Error(`HTTP error! status: ${response.status}, body: ${text}`);
                });
            }
            return response.json();
        })
            .then(results => displaySearchResults(results))
            .catch(error => {
            console.error('Failed to search notes:', error);
            toastManager.showToast('Search failed', { isError: true, details: error.message, duration: 5000 });
            toggleLoadingAnimation(false);
        });
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
async function searchNotes() {
    const searchText = document.getElementById("searchText").value;
    const password = document.getElementById("searchPassword").value;
    const tags = Array.from(window.tagGraph.selectedNodes).map((n) => n.tag_id);
    const sortCriteria = document.getElementById("sortCriteria").value;
    const response = await fetch('/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: searchText, tags, password, sortCriteria })
    });
    if (response.ok) {
        const results = await response.json();
        displaySearchResults(results);
    }
    else {
        console.error('Failed to search notes');
    }
}
function initializeSettingsMenu() {
    const updateGlobalPasswordsBtn = document.getElementById('updateGlobalPasswords');
    const generateTagPasswordBtn = document.getElementById('generateTagPassword');
    if (updateGlobalPasswordsBtn) {
        updateGlobalPasswordsBtn.addEventListener('click', updateGlobalPasswords);
    }
    if (generateTagPasswordBtn) {
        generateTagPasswordBtn.addEventListener('click', handleGenerateTagPassword);
    }
}
async function updateGlobalPasswords() {
    const vis1Password = prompt("Enter new password for visibility 1:");
    const vis3Password = prompt("Enter new password for visibility 3:");
    const vis5Password = prompt("Enter new password for visibility 5:");
    if (!vis1Password || !vis3Password || !vis5Password) {
        alert("All passwords must be provided.");
        return;
    }
    try {
        const response = await fetch('/update_global_passwords', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vis1: vis1Password, vis3: vis3Password, vis5: vis5Password })
        });
        const result = await response.json();
        if (result.success) {
            alert("Global passwords updated successfully.");
        }
        else {
            alert("Failed to update global passwords: " + result.error);
        }
    }
    catch (error) {
        console.error('Error updating global passwords:', error);
        alert("An error occurred while updating global passwords.");
    }
}
async function handleGenerateTagPassword() {
    const tagName = prompt("Enter the name of the tag for which you want to generate a password:");
    if (!tagName)
        return;
    const tag = window.tagGraph.nodes.find((n) => n.name === tagName);
    if (!tag) {
        alert("Tag not found.");
        return;
    }
    const maxVisibility = parseInt(prompt("Enter the maximum visibility level for this password (1-5):", "3") || "3", 10);
    if (maxVisibility < 1 || maxVisibility > 5) {
        alert("Invalid visibility level. Please enter a number between 1 and 5.");
        return;
    }
    const adminPassword = prompt("Enter the administrator password (visibility 5 password):");
    if (!adminPassword) {
        alert("Administrator password is required.");
        return;
    }
    try {
        const response = await fetch('/generate_tag_password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tag_id: tag.tag_id,
                max_visibility: maxVisibility,
                admin_password: adminPassword
            })
        });
        const result = await response.json();
        if (result.success) {
            alert(`Generated password for tag "${tagName}" (max visibility ${maxVisibility}): ${result.password}`);
        }
        else {
            alert(`Failed to generate password: ${result.error}`);
        }
    }
    catch (error) {
        console.error('Error generating tag password:', error);
        alert("An error occurred while generating the password. Please check the console for more details.");
    }
}
function toggleLoadingAnimation(isSerarching) {
    const loadingIndicator = document.getElementById("loadingIndicator");
    if (loadingIndicator)
        loadingIndicator.style.display = isSerarching ? 'block' : 'none';
}
function displaySearchResults(results) {
    const resultsContainer = document.getElementById("results");
    resultsContainer.innerHTML = "";
    // Sort the results based on the selected criteria
    const [criteria, order] = document.getElementById("sortCriteria").value.split('-');
    results.sort((a, b) => {
        let comparison = 0;
        switch (criteria) {
            case 'stars':
                comparison = a.rating - b.rating;
                break;
            case 'date':
                comparison = a.date - b.date;
                break;
            case 'visibility':
                comparison = a.visibility - b.visibility;
                break;
            case 'mmr':
                comparison = a.mmr - b.mmr;
                break;
        }
        return order === 'desc' ? -comparison : comparison;
    });
    const notesContainer = document.createElement("div");
    notesContainer.className = "notes-container";
    results.forEach(note => {
        const noteElement = document.createElement("div");
        noteElement.className = "note";
        const textContainer = document.createElement("div");
        textContainer.className = "note-text";
        textContainer.innerHTML = parseMarkdown(note.text); // Use innerHTML with parsed Markdown
        const metaContainer = document.createElement("div");
        metaContainer.className = "note-meta";
        const ratingAndControlsElement = document.createElement("div");
        ratingAndControlsElement.className = "note-rating-controls";
        const ratingElement = document.createElement("span");
        ratingElement.className = "note-rating";
        ratingElement.textContent = `${note.rating}⭐`;
        const visibilityIcon = document.createElement("span");
        visibilityIcon.className = "note-visibility";
        visibilityIcon.textContent = getVisibilityEmoji(note.visibility);
        const mmrElement = document.createElement("span");
        mmrElement.className = "note-mmr";
        mmrElement.textContent = `(${note.mmr})`;
        const editButton = document.createElement("button");
        editButton.className = "edit-note-btn";
        editButton.innerHTML = "✏️"; // Pencil emoji
        editButton.onclick = () => openEditNoteModal(note);
        ratingAndControlsElement.appendChild(ratingElement);
        ratingAndControlsElement.appendChild(visibilityIcon);
        ratingAndControlsElement.appendChild(mmrElement);
        ratingAndControlsElement.appendChild(editButton);
        const tagsElement = document.createElement("div");
        tagsElement.className = "note-tags";
        const wrappedTags = wrapTags(note.tags);
        tagsElement.innerHTML = `${wrappedTags.join('<br>')}`;
        metaContainer.appendChild(ratingAndControlsElement);
        metaContainer.appendChild(tagsElement);
        noteElement.appendChild(textContainer);
        noteElement.appendChild(metaContainer);
        notesContainer.appendChild(noteElement);
    });
    resultsContainer.appendChild(notesContainer);
    toggleLoadingAnimation(false);
}
function getVisibilityEmoji(visibility) {
    switch (visibility) {
        case 1: return "🔓";
        case 2: return "🔒";
        case 3: return "🔐";
        case 4: return "🔏";
        default: return "🔓";
    }
}
function isTallMode() {
    return window.innerHeight > window.innerWidth;
}
async function generateTagPassword(tagId, maxVisibility = 3) {
    try {
        const response = await fetch('/generate_tag_password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tag_id: tagId, max_visibility: maxVisibility })
        });
        if (response.ok) {
            const result = await response.json();
            if (result.success) {
                return result.password;
            }
        }
        return null;
    }
    catch (error) {
        console.error('Error generating tag password:', error);
        return null;
    }
}
function wrapTags(tags, maxLineLength = 30) {
    if (isTallMode())
        maxLineLength = 1;
    const tagArray = tags.split(',');
    let lines = [];
    let currentLine = '';
    tagArray.forEach(tag => {
        tag = tag.trim();
        if (currentLine.length === 0) {
            currentLine = tag;
        }
        else if (currentLine.length + tag.length + 2 <= maxLineLength) {
            currentLine += ', ' + tag;
        }
        else {
            lines.push(currentLine);
            currentLine = tag;
        }
    });
    if (currentLine.length > 0) {
        lines.push(currentLine);
    }
    return lines;
}
function parseMarkdown(text) {
    if (typeof marked !== 'undefined') {
        // Use marked.parse directly without setOptions
        // marked.Parser.parse()
        return marked.marked.parse(text, {
            breaks: true,
            gfm: true,
            sanitize: false // Set to false to allow HTML in markdown
        });
    }
    else {
        console.warn('Marked library not loaded. Falling back to basic parsing.');
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>');
    }
}
function parseMarkdown_better(text) {
    // Headers
    text = text.replace(/^(#{1,6})\s+(.+)$/gm, (match, hashes, content) => {
        const level = hashes.length;
        return `<h${level}>${content}</h${level}>`;
    });
    // Bold and Italic
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>'); // Strikethrough
    // Links
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    // Images
    text = text.replace(/!\[([^\]]+)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');
    // Code blocks
    text = text.replace(/```([^`]+)```/g, '<pre><code>$1</code></pre>');
    // Inline code
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Blockquotes
    text = text.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>');
    // Unordered lists
    text = text.replace(/(?:^|\n)(?:- (\[[ x]\])?\s*(.+)(?:\n|$))+/gm, (match) => {
        const items = match.trim().split('\n');
        const listItems = items.map(item => {
            const checkboxMatch = item.match(/- (\[[ x]\])\s*(.+)/);
            if (checkboxMatch) {
                const checked = checkboxMatch[1] === '[x]' ? 'checked' : '';
                return `<li><input type="checkbox" ${checked} disabled> ${checkboxMatch[2]}</li>`;
            }
            return `<li>${item.substring(2)}</li>`;
        }).join('');
        return `<ul>${listItems}</ul>`;
    });
    // Ordered lists
    text = text.replace(/(?:^|\n)(?:\d+\.\s+(.+)(?:\n|$))+/gm, (match) => {
        const items = match.trim().split('\n');
        const listItems = items.map(item => `<li>${item.replace(/^\d+\.\s+/, '')}</li>`).join('');
        return `<ol>${listItems}</ol>`;
    });
    // Horizontal rules
    text = text.replace(/^---+$/gm, '<hr>');
    // Tables
    text = text.replace(/\|(.+)\|/gm, (match, content) => {
        const cells = content.split('|').map((cell) => cell.trim());
        const row = cells.map((cell) => `<td>${cell}</td>`).join('');
        return `<tr>${row}</tr>`;
    });
    text = text.replace(/<tr>(.+)<\/tr>\n<tr>[-|]+<\/tr>/gm, '<table><thead>$1</thead><tbody>');
    text = text.replace(/<\/tbody>\n<tr>/gm, '<tr>');
    text = text.replace(/<\/tr>(?![\n\s]*<tr>)/gm, '</tr></tbody></table>');
    // Preserve line breaks (but not within lists)
    text = text.replace(/(?<!\>)\n(?!\<)/g, '<br>');
    return text;
}
// Add these functions at the end of the file
// Modify the openEditNoteModal function
function openEditNoteModal(note) {
    const modal = document.getElementById('editNoteModal');
    const closeBtn = modal.querySelector('.close');
    const saveBtn = document.getElementById('saveEditNoteBtn');
    const revertBtn = document.getElementById('revertEditNoteBtn');
    const deleteBtn = document.getElementById('deleteNoteBtn');
    // Store the original note data
    const originalNoteData = { ...note };
    function populateForm(data) {
        document.getElementById('editNoteText').value = data.text;
        document.getElementById('editNoteAuthor').value = data.author;
        document.getElementById('editNoteSource').value = data.source;
        // Set rating
        const ratingStars = document.querySelectorAll("#editNoteRating .star");
        ratingStars.forEach((star, index) => {
            star.classList.toggle('active', index < data.rating);
        });
        // Set visibility
        const visibilityIcons = document.querySelectorAll("#editNoteVisibility .visibility");
        visibilityIcons.forEach((vis, index) => {
            vis.classList.toggle('active', index < data.visibility);
        });
        // Set tags
        const editNoteTags = document.getElementById('editNoteTags');
        editNoteTags.innerHTML = ''; // Clear existing tags
        // Create a new div for tag text display
        const tagTextDiv = document.createElement('div');
        tagTextDiv.id = 'editNoteTagText';
        editNoteTags.appendChild(tagTextDiv);
        // Create a new div for tag selection
        const tagSelectionDiv = document.createElement('div');
        tagSelectionDiv.id = 'editNoteTagSelection';
        editNoteTags.appendChild(tagSelectionDiv);
        // Function to update tag text
        function updateTagText() {
            const selectedTags = Array.from(document.querySelectorAll('#editNoteTagSelection input:checked'))
                .map(checkbox => checkbox.nextSibling?.textContent || '')
                .filter(Boolean);
            tagTextDiv.textContent = `Tags: ${selectedTags.join(', ')}`;
        }
        // Add all available tags as checkboxes
        window.tagGraph.nodes.forEach((tag) => {
            const tagLabel = document.createElement('label');
            const tagCheckbox = document.createElement('input');
            tagCheckbox.type = 'checkbox';
            tagCheckbox.value = tag.tag_id.toString();
            tagCheckbox.checked = data.tags.includes(tag.name);
            tagCheckbox.addEventListener('change', updateTagText);
            tagLabel.appendChild(tagCheckbox);
            tagLabel.appendChild(document.createTextNode(tag.name));
            tagSelectionDiv.appendChild(tagLabel);
        });
        // Initial update of tag text
        updateTagText();
        // Add event listeners for rating stars
        ratingStars.forEach((star) => {
            star.addEventListener('click', (event) => {
                const clickedStar = event.currentTarget;
                const value = parseInt(clickedStar.getAttribute('data-value') || '1', 10);
                ratingStars.forEach((s, i) => {
                    s.classList.toggle('active', i < value);
                });
            });
        });
        // Add event listeners for visibility icons
        visibilityIcons.forEach((icon) => {
            icon.addEventListener('click', (event) => {
                const clickedIcon = event.currentTarget;
                const value = parseInt(clickedIcon.getAttribute('data-value') || '1', 10);
                visibilityIcons.forEach((i, index) => {
                    i.classList.toggle('active', index < value);
                });
            });
        });
    }
    populateForm(note);
    modal.style.display = "block";
    closeBtn.onclick = () => {
        modal.style.display = "none";
    };
    saveBtn.onclick = () => {
        saveEditedNote(note.note_id);
    };
    revertBtn.onclick = () => {
        populateForm(originalNoteData);
    };
    deleteBtn.onclick = () => {
        if (confirm("Are you sure you want to delete this note? This action cannot be undone.")) {
            deleteNote(note.note_id);
        }
    };
    window.onclick = (event) => {
        if (event.target == modal) {
            modal.style.display = "none";
        }
    };
}
async function deleteNote(noteId) {
    try {
        const response = await fetch('/delete_note', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ noteId })
        });
        if (response.ok) {
            const result = await response.json();
            if (result.success) {
                alert('Note deleted successfully!');
                document.getElementById('editNoteModal').style.display = "none";
                // Refresh the search results
                searchNotes();
            }
            else {
                alert('Failed to delete note: ' + result.error);
            }
        }
        else {
            const errorData = await response.json();
            alert('Failed to delete note: ' + errorData.error);
        }
    }
    catch (error) {
        console.error('Error deleting note:', error);
        alert('Error deleting note: ' + error);
    }
}
async function saveEditedNote(noteId) {
    const text = document.getElementById("editNoteText").value;
    const author = document.getElementById("editNoteAuthor").value;
    const source = document.getElementById("editNoteSource").value;
    const rating = document.querySelectorAll("#editNoteRating .star.active").length;
    const visibility = document.querySelectorAll("#editNoteVisibility .visibility.active").length;
    // Get selected tags with correct type assertion
    const selectedTags = Array.from(document.querySelectorAll('#editNoteTagSelection input[type="checkbox"]:checked'))
        .map((checkbox) => parseInt(checkbox.value, 10));
    try {
        const response = await fetch('/edit_note', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ noteId, text, author, rating, source, visibility, tags: selectedTags })
        });
        if (response.ok) {
            const result = await response.json();
            if (result.success) {
                alert('Note updated successfully!');
                document.getElementById('editNoteModal').style.display = "none";
                // Refresh the search results
                searchNotes();
            }
            else {
                alert('Failed to update note: ' + result.error);
            }
        }
        else {
            const errorData = await response.json();
            alert('Failed to update note: ' + errorData.error);
        }
    }
    catch (error) {
        console.error('Error updating note:', error);
        alert('Error updating note: ' + error);
    }
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
// Function to update preview
function updatePreview() {
    const noteText = document.getElementById('noteText').value;
    const notePreview = document.getElementById('notePreview');
    if (notePreview) {
        notePreview.innerHTML = parseMarkdown(noteText);
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
                toastManager.showToast('Note added successfully!', { duration: 3000 });
                // alert('Note added successfully!');
            }
            else {
                console.error('Failed to add note:', result.error);
                // alert('Failed to add note: ' + result.error);
                toastManager.showToast('Failed to add note', { isError: true, details: result.error, duration: 5000 });
            }
        }
        else {
            const errorData = await response.json();
            console.error('Failed to add note:', errorData.error);
            toastManager.showToast('Failed to add note', { isError: true, details: errorData.error, duration: 5000 });
            // alert('Failed to add note: ' + errorData.error);
        }
    }
    catch (error) {
        console.error('Error adding note:', error);
        toastManager.showToast('Error adding note', { isError: true, details: String(error), duration: 5000 });
        // alert('Error adding note: ' + error);
    }
}
class ToastManager {
    container;
    activeToasts = new Map();
    constructor() {
        this.container = document.getElementById('toastContainer');
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'toastContainer';
            this.container.className = 'toast-container';
            document.body.appendChild(this.container);
        }
    }
    showToast(message, options = {}) {
        const { duration = 3000, isError = false, details } = options;
        const key = `${message}-${details || ''}`;
        if (this.activeToasts.has(key)) {
            const existingToast = this.activeToasts.get(key);
            clearTimeout(existingToast.timer);
            existingToast.timer = this.setToastTimer(existingToast.element, key, duration);
            return;
        }
        const toast = this.createToastElement(message, isError, details);
        this.container.appendChild(toast);
        // Trigger reflow to enable transition
        toast.offsetHeight;
        toast.classList.add('show');
        const timer = this.setToastTimer(toast, key, duration);
        this.activeToasts.set(key, { element: toast, timer });
    }
    createToastElement(message, isError, details) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        const messageElement = document.createElement('div');
        messageElement.className = 'toast-message';
        messageElement.textContent = message;
        toast.appendChild(messageElement);
        if (details) {
            const detailsElement = document.createElement('div');
            detailsElement.className = 'toast-details';
            detailsElement.textContent = details;
            toast.appendChild(detailsElement);
        }
        if (isError) {
            toast.classList.add('error');
        }
        return toast;
    }
    setToastTimer(toast, key, duration) {
        return window.setTimeout(() => {
            toast.classList.add('remove');
            toast.addEventListener('transitionend', () => {
                if (toast.parentNode === this.container) {
                    this.container.removeChild(toast);
                }
                this.activeToasts.delete(key);
            }, { once: true });
        }, duration);
    }
}
// Initialize the ToastManager
const toastManager = new ToastManager();
// Example usage:
toastManager.showToast('Welcome to DyNotes! :)');
let currentMMRNotes = [];
let areRatingsVisible = false;
let isComparisonInProgress = false;
class MMRComparison {
    toast;
    notes;
    toastTimeout = null;
    isToastVisible = false;
    pendingComparison = false;
    comparisonQueue = [];
    isLoadingComparisons = false;
    fastModeCheckbox;
    constructor() {
        this.toast = document.getElementById('mmrToast');
        this.notes = document.querySelectorAll('.mmr-note');
        this.fastModeCheckbox = document.getElementById('fastModeCheckbox');
        this.initializeEventListeners();
    }
    initializeEventListeners() {
        const startMMRComparisonBtn = document.getElementById('startMMRComparison');
        const mmrModal = document.getElementById('mmrModal');
        const closeMMRModal = mmrModal?.querySelector('.close');
        const toggleMMRRatingsBtn = document.getElementById('toggleMMRRatings');
        const skipMMRComparisonBtn = document.getElementById('skipMMRComparison');
        if (skipMMRComparisonBtn) {
            skipMMRComparisonBtn.addEventListener('click', () => this.showNextComparison());
        }
        startMMRComparisonBtn?.addEventListener('click', this.startComparison.bind(this));
        closeMMRModal?.addEventListener('click', () => {
            if (mmrModal)
                mmrModal.style.display = 'none';
        });
        toggleMMRRatingsBtn?.addEventListener('click', this.toggleRatings.bind(this));
        document.querySelectorAll('.mmr-note').forEach((noteElement, index) => {
            noteElement.addEventListener('click', () => this.updateMMR(index));
        });
        window.addEventListener('click', (event) => {
            if (event.target === mmrModal && mmrModal != null) {
                mmrModal.style.display = 'none';
            }
        });
        // Add a global click listener for managing toast visibility
        document.addEventListener('click', this.handleGlobalClick.bind(this));
    }
    handleGlobalClick(event) {
        if (this.isToastVisible && !this.toast.contains(event.target)) {
            this.hideToastAndContinue();
        }
    }
    async startComparison() {
        if (this.comparisonQueue.length === 0) {
            await this.loadMoreComparisons();
        }
        this.showNextComparison();
    }
    showNextComparison() {
        if (this.comparisonQueue.length > 0) {
            const notes = this.comparisonQueue.shift();
            currentMMRNotes = notes;
            this.displayNotes(notes);
            document.getElementById('mmrModal').style.display = 'block';
        }
        else {
            this.loadMoreComparisons().then(() => {
                if (this.comparisonQueue.length > 0) {
                    this.showNextComparison();
                }
                else {
                    alert('No more comparisons available. Try selecting different tags.');
                }
            });
        }
    }
    async loadMoreComparisons() {
        if (this.isLoadingComparisons)
            return;
        this.isLoadingComparisons = true;
        const tags = Array.from(window.tagGraph.selectedNodes).map((n) => n.tag_id);
        const password = document.getElementById("searchPassword").value;
        try {
            const response = await fetch('/get_mmr_notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tags, password })
            });
            const notes = await response.json();
            if (notes.length === 2) {
                this.comparisonQueue.push(notes);
            }
            else {
                console.warn('Not enough notes found for comparison.');
            }
        }
        catch (error) {
            console.error('Error fetching MMR notes:', error);
        }
        finally {
            this.isLoadingComparisons = false;
        }
    }
    startComparisonOld() {
        if (isComparisonInProgress)
            return;
        isComparisonInProgress = true;
        this.clearComparison();
        const tags = Array.from(window.tagGraph.selectedNodes).map((n) => n.tag_id);
        const password = document.getElementById("searchPassword").value;
        fetch('/get_mmr_notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tags, password })
        })
            .then(response => response.json())
            .then(notes => {
            if (notes.length === 2) {
                currentMMRNotes = notes;
                this.displayNotes(notes);
                document.getElementById('mmrModal').style.display = 'block';
            }
            else {
                alert('Not enough notes found for comparison. Try selecting different tags.');
            }
            isComparisonInProgress = false;
        })
            .catch(error => {
            console.error('Error fetching MMR notes:', error);
            isComparisonInProgress = false;
        });
    }
    displayNotes(notes) {
        notes.forEach((note, index) => {
            const noteElement = document.getElementById(`mmrNote${index + 1}`);
            if (noteElement) {
                noteElement.querySelector('.mmr-note-text').textContent = note.text;
                noteElement.querySelector('.mmr-note-meta').textContent = `Author: ${note.author}, Source: ${note.source}, Visibility: ${getVisibilityEmoji(note.visibility)}`;
                noteElement.querySelector('.mmr-note-tags').textContent = `Tags: ${note.tags}`;
                const ratingElement = noteElement.querySelector('.mmr-note-rating');
                ratingElement.textContent = `Rating: ${'⭐'.repeat(note.rating)}`;
                ratingElement.style.display = areRatingsVisible ? 'block' : 'none';
            }
        });
    }
    updateMMR(winnerIndex) {
        if (this.pendingComparison)
            return;
        this.pendingComparison = true;
        const winnerId = currentMMRNotes[winnerIndex].note_id;
        const loserId = currentMMRNotes[1 - winnerIndex].note_id;
        fetch('/update_mmr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ winner_id: winnerId, loser_id: loserId })
        })
            .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
            .then(result => {
            if (result.success) {
                this.showComparisonResult(winnerIndex, result.winner_change, result.loser_change, result.winner_id, result.loser_id);
                // Preemptively load more comparisons if the queue is getting low
                if (this.fastModeCheckbox.checked) {
                    this.hideToastAndContinue();
                }
                if (this.comparisonQueue.length < 3) {
                    this.loadMoreComparisons();
                }
            }
            else {
                console.error('Failed to update MMR:', result.error);
                alert('Failed to update MMR. Please try again.');
                this.pendingComparison = false;
            }
        })
            .catch(error => {
            console.error('Error updating MMR:', error);
            alert('An error occurred while updating MMR. Please try again.');
            this.pendingComparison = false;
        });
    }
    updateMMR_old(winnerIndex) {
        if (isComparisonInProgress)
            return;
        isComparisonInProgress = true;
        const winnerId = currentMMRNotes[winnerIndex].note_id;
        const loserId = currentMMRNotes[1 - winnerIndex].note_id;
        fetch('/update_mmr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ winner_id: winnerId, loser_id: loserId })
        })
            .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
            .then(result => {
            if (result.success) {
                this.showComparisonResult(winnerIndex, result.winner_change, result.loser_change, result.winner_id, result.loser_id);
            }
            else {
                console.error('Failed to update MMR:', result.error);
                alert('Failed to update MMR. Please try again.');
            }
            isComparisonInProgress = false;
        })
            .catch(error => {
            console.error('Error updating MMR:', error);
            alert('An error occurred while updating MMR. Please try again.');
            isComparisonInProgress = false;
        });
    }
    showComparisonResult(winnerIndex, winnerChange, loserChange, winnerId, loserId) {
        if (this.toastTimeout !== null) {
            clearTimeout(this.toastTimeout);
        }
        this.notes.forEach(note => note.classList.add('darken'));
        const toastNotes = this.toast.querySelectorAll('.mmr-toast-note');
        currentMMRNotes.forEach((note, index) => {
            const toastNote = toastNotes[index];
            const isWinner = note.note_id === winnerId;
            const change = isWinner ? winnerChange : loserChange;
            toastNote.querySelector('p').textContent = `Note ${index + 1} (${isWinner ? 'Winner' : 'Loser'})`;
            toastNote.querySelector('.mmr-toast-rating').textContent = `Rating: ${'⭐'.repeat(note.rating)}`;
            toastNote.querySelector('.mmr-toast-mmr').innerHTML = `
                MMR: ${note.mmr} 
                <span class="change ${change >= 0 ? 'positive' : 'negative'}">
                    (${change >= 0 ? '+' : ''}${change})
                </span>
            `;
        });
        this.toast.style.display = 'block';
        this.toast.classList.remove('fade-out');
        this.toast.classList.add('fade-in');
        this.isToastVisible = true;
        // Set a flag to indicate a pending comparison
        this.pendingComparison = true;
        this.toastTimeout = window.setTimeout(() => {
            this.hideToastAndContinue();
        }, 2000);
    }
    hideToastAndContinue() {
        if (!this.isToastVisible)
            return;
        if (this.toastTimeout !== null) {
            clearTimeout(this.toastTimeout);
            this.toastTimeout = null;
        }
        this.isToastVisible = false;
        this.toast.classList.remove('fade-in');
        this.toast.classList.add('fade-out');
        this.pendingComparison = false;
        this.showNextComparison(); // Immediately show the next comparison
        setTimeout(() => {
            this.toast.style.display = 'none';
            this.notes.forEach(note => note.classList.remove('darken'));
        }, 300);
    }
    clearComparison() {
        this.toast.style.display = 'none';
        this.toast.classList.remove('fade-in', 'fade-out');
        this.notes.forEach(note => note.classList.remove('darken'));
        this.isToastVisible = false;
        if (this.toastTimeout !== null) {
            clearTimeout(this.toastTimeout);
            this.toastTimeout = null;
        }
    }
    toggleRatings() {
        areRatingsVisible = !areRatingsVisible;
        const ratingElements = document.querySelectorAll('.mmr-note-rating');
        ratingElements.forEach(el => {
            el.style.display = areRatingsVisible ? 'block' : 'none';
        });
        document.getElementById('toggleMMRRatings').textContent =
            areRatingsVisible ? 'Hide Ratings' : 'Show Ratings';
    }
}
function initializeFullscreenToggle() {
    const toggleFullscreenBtn = document.getElementById('toggleFullscreen');
    if (toggleFullscreenBtn) {
        toggleFullscreenBtn.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(err => {
                    console.error(`Error attempting to enable fullscreen: ${err.message}`);
                });
            }
            else {
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                }
            }
        });
    }
}
// Initialize the graph when the DOM is ready
document.addEventListener("DOMContentLoaded", () => {
    window.tagGraph = new TagGraph("tagGraph");
    window.tagGraph.initialize();
    // Add event listener for the "Add Note" button
    const showAddNoteBtn = document.getElementById('showAddNoteBtn');
    const addNoteSection = document.getElementById('addNoteSection');
    initializeFullscreenToggle();
    initializeSettingsMenu();
    if (showAddNoteBtn && addNoteSection) {
        showAddNoteBtn.addEventListener('click', () => {
            addNoteSection.style.display = addNoteSection.style.display === 'none' ? 'block' : 'none';
            showAddNoteBtn.textContent = addNoteSection.style.display === 'none' ? 'Add Note ▼' : 'Hide Add Note ▲';
        });
    }
    const closeAddNoteBtn = document.getElementById('closeAddNoteBtn');
    if (closeAddNoteBtn) {
        closeAddNoteBtn.addEventListener('click', () => {
            const addNoteSection = document.getElementById('addNoteSection');
            const showAddNoteBtn = document.getElementById('showAddNoteBtn');
            if (addNoteSection && showAddNoteBtn) {
                addNoteSection.style.display = 'none';
                showAddNoteBtn.textContent = 'Add Note ▼';
            }
        });
    }
    // Initialize preview functionality
    const noteText = document.getElementById('noteText');
    const notePreview = document.getElementById('notePreview');
    if (noteText && notePreview) {
        noteText.addEventListener('input', () => {
            notePreview.innerHTML = parseMarkdown(noteText.value);
        });
    }
    new MMRComparison();
});
